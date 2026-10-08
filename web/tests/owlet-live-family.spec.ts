import { test,expect,type Page } from '@playwright/test';

const children=[
  {id:'first',name:'First child',birthDate:'2026-01-01',sex:'Not specified'},
  {id:'second',name:'Second child',birthDate:'2026-02-01',sex:'Not specified'},
];
async function household(page:Page,user:string,live:()=>{heart_rate:number;oxygen_percent:number},counts:{reads:number;writes:number}){
  await page.route('**/api/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    let json:unknown={};
    if(path==='/api/me')json={user:{id:user,name:'Caregiver',email:`${user}@example.test`},families:[{id:'family',name:'Family',role:user==='owner'?'owner':'caregiver'}],pushEnabled:false,reminderMinutes:120};
    else if(path==='/api/families/family'){counts.reads++;json={revision:1,snapshot:{children,activities:[],naraImports:[]},members:[]};}
    else if(path==='/api/families/family/sync'){counts.writes++;return route.fulfill({status:409,json:{error:'Another caregiver changed the records'}});}
    else if(path==='/api/owlet')json={configured:true,connections:[{child_id:'first',device_name:'Dream Sock',...live(),battery_percent:85.5,measured_at:new Date().toISOString(),alerts:{}}]};
    else if(path==='/api/owlet/history'){
      const url=new URL(route.request().url()),to=url.searchParams.get('to')!;
      json={from:url.searchParams.get('from'),to,readings:[{measured_at:to,first_at:to,last_at:to,samples:1,heart_rate:120,heart_min:120,heart_max:120,oxygen_percent:100,oxygen_min:100,oxygen_max:100}],bucketSeconds:5,alerts:[],settings:null,gaps:[],archive:{polls:'1',errors:'0'},files:[],attempts:[]};
    } else if(path==='/api/owlet/active-alerts')json={events:[]};
    await route.fulfill({json});
  });
  await page.goto('/pwa.html');
  await expect(page.getByRole('heading',{name:'Quick actions',exact:true})).toBeVisible();
}
async function chooseSecond(page:Page){
  await page.locator('.child-selector').filter({hasText:'First child'}).click();
  await page.getByRole('button',{name:'Second child',exact:true}).click();
  await expect(page.locator('.child-selector').filter({hasText:'Second child'})).toBeVisible();
}
test.use({viewport:{width:390,height:844},hasTouch:true,isMobile:true});

test('an invited caregiver selects a child locally without submitting shared records',async({page})=>{
  const counts={reads:0,writes:0};
  await household(page,'new-caregiver',()=>({heart_rate:120,oxygen_percent:100}),counts);
  const reads=counts.reads;
  await chooseSecond(page);
  const saved=await page.evaluate(async()=>{
    const store=await import('/src/domain/store.ts');
    return store.load();
  });
  expect(saved.selected).toBe('second');
  expect(counts.reads).toBe(reads);
  expect(counts.writes).toBe(0);
  await page.reload();
  await expect(page.locator('.child-selector').filter({hasText:'Second child'})).toBeVisible();
});

test('child selection preserves pending records when the rendered view is older than local storage',async({page})=>{
  const counts={reads:0,writes:0};
  await household(page,'new-caregiver',()=>({heart_rate:120,oxygen_percent:100}),counts);
  await page.evaluate(async()=>{
    const store=await import('/src/domain/store.ts');
    const state=await store.load();
    await store.persist({...state,activities:[{id:'pending-feed',childId:'first',kind:'Feed',start:Date.now(),detail:'Milk',notes:'',author:'Caregiver',amount:60}]});
  });
  await expect(page.getByText('Another caregiver updated this household.',{exact:true})).toBeVisible();
  await chooseSecond(page);
  const saved=await page.evaluate(async()=>{const store=await import('/src/domain/store.ts');return store.load();});
  expect(saved.selected).toBe('second');
  expect(saved.activities.map(a=>a.id)).toEqual(['pending-feed']);
  expect(counts.writes).toBe(1);
});

test('landscape readings refresh within a second for accounts opened at different times',async({browser})=>{
  let live={heart_rate:120,oxygen_percent:100};
  const contexts=await Promise.all(['owner','caregiver'].map(()=>browser.newContext({viewport:{width:844,height:390},hasTouch:true,isMobile:true})));
  try{
    const pages=await Promise.all(contexts.map(context=>context.newPage()));
    for(let i=0;i<pages.length;i++){
      const page=pages[i];
      await household(page,i===0?'owner':'caregiver',()=>live,{reads:0,writes:0});
      await page.locator('.owlet-card').tap();
      await page.getByRole('button',{name:/Landscape standby/}).tap();
      await expect(page.locator('.standby-readings').getByRole('button',{name:'Open oxygen details'}).locator('strong')).toHaveText('100');
    }
    live={heart_rate:130,oxygen_percent:97};
    await Promise.all(pages.map(async page=>{
      await expect(page.locator('.standby-readings').getByRole('button',{name:'Open oxygen details'}).locator('strong')).toHaveText('97',{timeout:1800});
      await expect(page.locator('.standby-readings').getByRole('button',{name:'Open heart rate details'}).locator('strong')).toHaveText('130');
    }));
  }finally{await Promise.all(contexts.map(context=>context.close()));}
});

test('landscape resumes immediately after visibility changes and avoids overlapping requests',async({page})=>{
  await household(page,'caregiver',()=>({heart_rate:120,oxygen_percent:100}),{reads:0,writes:0});
  let oxygen=100,requests=0,hold:Promise<void>|undefined;
  await page.route('**/api/owlet?**',async route=>{
    requests++;
    if(hold)await hold;
    await route.fulfill({json:{configured:true,connections:[{child_id:'first',heart_rate:120,oxygen_percent:oxygen,measured_at:new Date().toISOString(),alerts:{}}]}});
  });
  await page.locator('.owlet-card').tap();
  await page.getByRole('button',{name:/Landscape standby/}).tap();
  await expect.poll(()=>requests).toBeGreaterThan(0);
  const value=page.locator('.standby-readings').getByRole('button',{name:'Open oxygen details'}).locator('strong');
  await expect(value).toHaveText('100');
  await page.evaluate(()=>{
    Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const before=requests;
  oxygen=96;
  await page.waitForTimeout(1100);
  expect(requests).toBe(before);
  await page.evaluate(()=>{
    Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(value).toHaveText('96',{timeout:800});
  let release!:()=>void;
  hold=new Promise(resolve=>{release=resolve;});
  const started=requests;
  oxygen=97;
  await page.evaluate(()=>window.dispatchEvent(new Event('online')));
  await expect.poll(()=>requests).toBe(started+1);
  await page.evaluate(()=>{
    for(let i=0;i<4;i++)window.dispatchEvent(new Event('focus'));
  });
  expect(requests).toBe(started+1);
  release();hold=undefined;
  await expect(value).toHaveText('97');
});
