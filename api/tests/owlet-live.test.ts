import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { pool, migrate } from "../src/db.ts";
import { hash, token } from "../src/auth.ts";

test("owner and invited caregiver receive the same numeric live Owlet readings and children", { skip: process.env.OWLET_LIVE_TEST !== "1" }, async () => {
  const family=randomUUID(),children=[randomUUID(),randomUUID()],users=[randomUUID(),randomUUID()];
  const cookies=[token(),token()];
  const reservation=createServer().listen(0,"127.0.0.1");
  await once(reservation,"listening");
  const port=(reservation.address() as {port:number}).port;
  await new Promise<void>(resolve=>reservation.close(()=>resolve()));
  const origin=`http://127.0.0.1:${port}`;
  let server: ReturnType<typeof spawn>|undefined;
  try {
    await migrate();
    await pool.query("INSERT INTO families(id,name,snapshot) VALUES($1,'Live regression',$2)",[family,JSON.stringify({
      children:children.map((id,i)=>({id,name:`Child ${i+1}`,birthDate:"2026-01-01",sex:"Not specified"})),activities:[],naraImports:[],
    })]);
    for(let i=0;i<users.length;i++){
      await pool.query("INSERT INTO users(id,email,password_hash,name) VALUES($1,$2,'fixture','Test caregiver')",[users[i],`${users[i]}@example.test`]);
      await pool.query("INSERT INTO memberships VALUES($1,$2,$3)",[family,users[i],i===0?'owner':'caregiver']);
      await pool.query("INSERT INTO sessions VALUES($1,$2,now()+interval '1 hour')",[hash(cookies[i]),users[i]]);
    }
    for(const child of children)await pool.query("INSERT INTO children(id,family_id,name,birth_date) VALUES($1,$2,'Test child','2026-01-01')",[child,family]);
    await pool.query("INSERT INTO owlet_connections(id,family_id,child_id,connected_by,account_email,device_serial,device_name,encrypted_tokens,next_poll_at) VALUES($1,$2,$3,$4,'fixture@example.test','TESTLIVE','Dream Sock','fixture',now()+interval '1 day')",[randomUUID(),family,children[0],users[0]]);
    await pool.query("INSERT INTO owlet_readings(family_id,child_id,device_serial,measured_at,heart_rate,oxygen_percent,battery_percent) VALUES($1,$2,'TESTLIVE',now(),120,100,85.5)",[family,children[0]]);
    server=spawn(process.execPath,[new URL('../src/server.ts',import.meta.url).pathname],{
      env:{...process.env,PORT:String(port),HOST:'127.0.0.1',APP_ORIGIN:origin,SESSION_SECURE:'false'},stdio:'ignore',
    });
    for(let i=0;i<100;i++){
      if(server.exitCode!==null)throw Error('Test API exited before becoming ready');
      if(await fetch(origin+'/api/health').then(r=>r.ok).catch(()=>false))break;
      await new Promise(resolve=>setTimeout(resolve,30));
    }
    const get=async(path:string,cookie:string)=>{
      const response=await fetch(origin+'/api'+path,{headers:{Cookie:`baby_session=${cookie}`}});
      assert.equal(response.status,200);
      return response.json();
    };
    const statuses=await Promise.all(cookies.map(cookie=>get(`/owlet?family=${family}`,cookie)));
    assert.deepEqual(statuses[0].connections,statuses[1].connections);
    assert.equal(statuses[0].connections[0].oxygen_percent,100);
    assert.equal(statuses[0].connections[0].battery_percent,85.5);
    for(const cookie of cookies){
      const household=await get(`/families/${family}`,cookie);
      assert.deepEqual(household.snapshot.children.map((c:{id:string})=>c.id),children);
    }
  } finally {
    if(server && server.exitCode===null){server.kill('SIGTERM');await once(server,'exit');}
    await pool.end();
  }
});
