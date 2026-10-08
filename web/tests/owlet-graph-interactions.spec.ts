import { test, expect, type Page, type Route } from "@playwright/test";

const kinds = ["Feed", "Diaper", "Sleep", "Nursing", "Pumping", "Solids", "Growth", "Medication", "Milestone", "Routine", "Pregnancy", "Postpartum", "Spasm"];
async function mockHousehold(page: Page, history: (route: Route) => Promise<void>) {
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/owlet/history") return history(route);
    let body: unknown = {};
    if (path === "/api/me") body = {
      user: { id: "qa", name: "Alex", email: "qa@example.test" },
      families: [{ id: "qa-family", name: "QA", role: "owner" }],
      quickActions: kinds, pushEnabled: false, reminderMinutes: 120,
    };
    else if (path === "/api/families/qa-family") body = { revision: 1, snapshot: {
      children: [{ id: "oliver", name: "Oliver", birthDate: "2026-06-01", sex: "Not specified" }],
      activities: [], naraImports: [],
    } };
    else if (path === "/api/owlet") body = { configured: true, connections: [{
      child_id: "oliver", device_serial: "qa", device_name: "Dream Sock",
      heart_rate: 120, oxygen_percent: 98, measured_at: new Date().toISOString(), alerts: {},
    }] };
    else if (path.includes("pending")) body = { events: [] };
    await route.fulfill({ json: body });
  });
  await page.goto("/pwa.html");
  await expect(page.getByRole("heading", { name: "Quick actions", exact: true })).toBeVisible();
}
function historyData(route: Route) {
  const url = new URL(route.request().url());
  const to = url.searchParams.get("to")!;
  const readings = Array.from({ length: 20 }, (_, i) => {
    const t = new Date(Date.parse(to) - (19 - i) * 5000).toISOString();
    return {
      measured_at: t, first_at: t, last_at: t, samples: 1,
      heart_rate: 120 + i % 12, heart_min: 118, heart_max: 132,
      oxygen_percent: 98, oxygen_min: 97, oxygen_max: 99,
      movement: 1, movement_min: 0, movement_max: 2,
      sleep_state: 1, sock_connection: 1, charging: false,
      battery_percent: 85, signal: -40, alerts: {},
    };
  });
  return {
    from: url.searchParams.get("from"), to, readings, bucketSeconds: 5,
    alerts: [], settings: null, gaps: [], archive: { polls: "20", errors: "0" }, files: [], attempts: [],
  };
}

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

test("a single 100% oxygen reading stays visible in overview and detail", async ({ page }) => {
  let sample: Record<string,unknown>|null=null;
  await mockHousehold(page, route => {
    const data=historyData(route);
    data.readings=[{...data.readings.at(-1)!,oxygen_percent:100,oxygen_min:100,oxygen_max:100}];
    sample={...data.readings[0],oxygen_percent:"100.0"};
    return route.fulfill({json:data});
  });
  await page.route("**/api/owlet/sample?**",route=>route.fulfill({json:{reading:sample,previous:null,next:null}}));
  await page.locator(".owlet-card").tap();
  const overview=page.locator('.owlet-overview-chart [data-metric="oxygen_percent"]');
  await expect(overview.locator('[data-point="isolated"]')).toHaveCount(1);
  await page.getByRole("button",{name:"Open oxygen details"}).tap();
  const detail=page.locator('.owlet-scrubbable [data-metric="oxygen_percent"]');
  const point=detail.locator('[data-point="isolated"]');
  await expect(point).toHaveAttribute("cy","35");
  await expect(point).toHaveAttribute("r","4");
  await expect(page.locator(".owlet-sample-value")).toHaveText("100.0 %");
  await page.getByRole("button",{name:/Graph overview/}).tap();
  await page.getByRole("button",{name:/Landscape standby/}).tap();
  await page.setViewportSize({width:844,height:390});
  await expect(page.locator('.standby-chart [data-metric="oxygen_percent"] [data-point="isolated"]')).toHaveCount(1);
});

test("oxygen keeps fractional values and shows isolated readings without bridging missing data", async ({ page }) => {
  await mockHousehold(page, route => {
    const data=historyData(route),end=Date.parse(data.to);
    const template=data.readings[0];
    const samples: [number,number|null][]=[[-300,100],[-295,null],[-250,99.5],[-245,0],[-140,99],[-20,98],[-15,100]];
    data.readings=samples.map(([offset,value])=>{
      const t=new Date(end+offset*1000).toISOString();
      return {...template,measured_at:t,first_at:t,last_at:t,oxygen_percent:value,oxygen_min:value,oxygen_max:value};
    }) as typeof data.readings;
    return route.fulfill({json:data});
  });
  await page.locator(".owlet-card").tap();
  await page.getByRole("button",{name:"Open oxygen details"}).tap();
  const oxygen=page.locator('.owlet-scrubbable [data-metric="oxygen_percent"]');
  await expect(oxygen.locator('path[data-segment="reading"]')).toHaveCount(4);
  await expect(oxygen.locator('[data-point="isolated"]')).toHaveCount(3);
  const paths=await oxygen.locator('path[data-segment="reading"]').evaluateAll(elements=>elements.map(el=>el.getAttribute("d")!));
  expect(paths.filter(d=>d.includes("L"))).toHaveLength(1);
  expect(paths.some(d=>d.includes(",55.5"))).toBe(true);
  expect(paths.every(d=>!d.includes("NaN"))).toBe(true);
});

test("Owlet overlays default heart and oxygen, toggles metrics, and preserves selection", async ({ page }) => {
  await mockHousehold(page, route => route.fulfill({ json: historyData(route) }));
  await page.locator(".owlet-card").tap();
  const picker=page.getByRole("group",{name:"Graph metric"});
  await expect(picker.getByRole("button",{name:"Heart rate",exact:true})).toHaveAttribute("aria-pressed","true");
  await expect(picker.getByRole("button",{name:"Oxygen",exact:true})).toHaveAttribute("aria-pressed","true");
  await expect(page.locator(".owlet-overview-chart > g[data-metric]")).toHaveCount(2);
  await expect(page.locator('[data-metric="heart_rate"]')).toContainText("bpm");
  await expect(page.locator('[data-metric="oxygen_percent"]')).toContainText("O₂ %");
  for(const label of ["Heart rate","Oxygen","Movement","Sock battery","Signal strength"]){
    const toggle=picker.getByRole("button",{name:label,exact:true});
    if(await toggle.getAttribute("aria-pressed")==="false")await toggle.tap();
    await expect(picker.getByRole("button",{name:label,exact:true})).toHaveAttribute("aria-pressed","true");
    await expect(page.locator(".owlet-plot > svg")).toHaveCount(1);
    const chart=page.getByRole("img",{name:new RegExp(`${label} graph`)});
    await chart.tap();
    await expect(page.locator(".owlet-inspector")).toHaveCount(0);
    await expect(chart).toBeVisible();
  }
  await expect(page.locator(".owlet-overview-chart > g[data-metric]")).toHaveCount(5);
  for(const label of ["Heart rate","Oxygen","Movement","Sock battery"]){
    await picker.getByRole("button",{name:label,exact:true}).tap();
    await expect(picker.getByRole("button",{name:label,exact:true})).toHaveAttribute("aria-pressed","false");
  }
  await expect(page.locator(".owlet-overview-chart > g[data-metric]")).toHaveCount(1);
  // Retain one visible metric instead of leaving an empty chart.
  await picker.getByRole("button",{name:"Signal strength",exact:true}).tap();
  await expect(picker.getByRole("button",{name:"Signal strength",exact:true})).toHaveAttribute("aria-pressed","true");
  await page.getByRole("combobox",{name:"Graph range"}).tap();
  await page.getByRole("option",{name:"10 min",exact:true}).tap();
  await expect(page.getByRole("img",{name:/Signal strength graph/})).toBeVisible();
  await expect(picker.getByRole("button",{name:"Signal strength",exact:true})).toHaveAttribute("aria-pressed","true");
  await page.getByRole("button",{name:"Open signal strength details"}).tap();
  await expect(page.locator(".owlet-inspector")).toBeVisible();
  const slider=page.getByRole("slider",{name:"Inspect graph time"});
  const before=await slider.inputValue();
  const detail=page.getByRole("img",{name:/Signal strength graph/});
  const box=(await detail.boundingBox())!;
  await page.touchscreen.tap(box.x+box.width*.4,box.y+box.height*.5);
  await expect.poll(()=>slider.inputValue()).not.toBe(before);
  await page.getByRole("button",{name:/Graph overview/}).tap();
  await expect(picker.getByRole("button",{name:"Signal strength",exact:true})).toHaveAttribute("aria-pressed","true");
  await expect(page.locator(".owlet-inspector")).toHaveCount(0);
});

test("touch swipe starting on the overview chart scrolls without opening details", async ({ page }) => {
  await mockHousehold(page, route => route.fulfill({ json: historyData(route) }));
  await page.locator(".owlet-card").tap();
  const chart=page.getByRole("img",{name:/Heart rate graph/});
  await chart.scrollIntoViewIfNeeded();
  const sheet=page.locator(".native-sheet > .sheet-body");
  const before=await sheet.evaluate(el=>el.scrollTop);
  const box=(await chart.boundingBox())!;
  const x=box.x+box.width*.5,y=Math.min(box.y+box.height*.7,750);
  const touch=await page.context().newCDPSession(page);
  await touch.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[{x,y}]});
  for(let i=1;i<=6;i++){
    await touch.send("Input.dispatchTouchEvent",{type:"touchMove",touchPoints:[{x,y:y-i*20}]});
    await page.waitForTimeout(20);
  }
  await touch.send("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});
  await expect.poll(()=>sheet.evaluate(el=>el.scrollTop)).toBeGreaterThan(before+30);
  await expect(page.locator(".owlet-inspector")).toHaveCount(0);
  await expect(chart).toHaveCount(1);
  await expect(page.getByRole("button",{name:"Heart rate",exact:true})).toHaveAttribute("aria-pressed","true");
});

test("landscape standby keeps live values separate and urgent alerts require explicit acceptance", async ({ page }) => {
  await mockHousehold(page, route => route.fulfill({ json: historyData(route) }));
  let pending = false, accepted = 0;
  const stamp = new Date().toISOString();
  await page.route("**/api/owlet/active-alerts?**", route => route.fulfill({ json: { events: pending ? [{
    id: "123", child_id: "oliver", child_name: "Oliver", kind: "oxygen_below",
    measured_value: 85, threshold_value: 90, measured_at: stamp, created_at: stamp,
  }] : [] } }));
  await page.route("**/api/owlet/accept-alert", async route => {
    expect(route.request().postDataJSON()).toEqual({ family: "qa-family", eventId: "123" });
    accepted++; pending = false;
    await route.fulfill({ json: { ok: true } });
  });
  await page.locator(".owlet-card").tap();
  await page.getByRole("button", { name: /Landscape standby/ }).tap();
  await page.setViewportSize({ width: 844, height: 390 });
  const standby = page.locator(".owlet-standby");
  await expect(standby.locator(".standby-footer")).toBeInViewport();
  const live = await standby.locator(".standby-readings").innerText();
  await standby.locator(".standby-chart").tap();
  await expect(page.getByRole("button", { name: "Inspect saved reading" })).toBeVisible();
  await expect.poll(()=>standby.locator(".standby-readings").innerText()).toBe(live);
  pending = true;
  await expect(page.getByRole("heading", { name: "Owlet · Accept to stop repeats" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Accept", exact: true })).toBeVisible();
  expect(accepted).toBe(0);
  await page.getByRole("button", { name: "Accept", exact: true }).tap();
  await expect(page.locator(".owlet-urgent")).toHaveCount(0);
  expect(accepted).toBe(1);
  await page.getByRole("button", { name: "Exit", exact: true }).tap();
  await expect(page.getByRole("group", { name: "Graph metric" })).toBeVisible();
});
