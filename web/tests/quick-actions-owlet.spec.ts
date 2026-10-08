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

test.use({ viewport: { width: 390, height: 844 } });

test("More activities opens from the plus beside settings and still opens activity forms", async ({ page }) => {
  await mockHousehold(page, route => route.fulfill({ json: historyData(route) }));
  const tools = page.locator(".timer-hub-tools");
  await expect(tools.getByRole("button").nth(0)).toHaveAttribute("aria-label", "Customize quick actions");
  await expect(tools.getByRole("button").nth(1)).toHaveAttribute("aria-label", "More activities");
  await expect(page.getByRole("button", { name: "More activities", exact: true })).toHaveCount(1);
  await tools.getByRole("button", { name: "More activities" }).click();
  await expect(page.getByRole("heading", { name: "More activities", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Solids", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Log solids", exact: true })).toBeVisible();
});

test("Owlet retains its position during delayed history and cached reopening", async ({ page }) => {
  let release!: () => void;
  const delayed = new Promise<void>(resolve => { release = resolve; });
  await mockHousehold(page, async route => {
    await delayed;
    await route.fulfill({ json: historyData(route) });
  });
  await page.locator(".owlet-card").click();
  await expect(page.getByRole("status").filter({ hasText: "Loading graph history" })).toBeVisible();
  const before = await page.locator(".native-sheet").boundingBox();
  release();
  await expect(page.getByRole("img", { name: /Heart rate graph/ })).toBeVisible();
  const after = await page.locator(".native-sheet").boundingBox();
  expect(after!.y).toBeCloseTo(before!.y, 0);
  expect(after!.height).toBeCloseTo(before!.height, 0);
  await page.getByRole("button", { name: "Close sheet" }).click();
  await page.locator(".owlet-card").click();
  await expect(page.getByRole("img", { name: /Heart rate graph/ })).toBeVisible();
  await expect(page.locator(".owlet-graph-loading")).toHaveCount(0);
  let releaseRange!: () => void;
  const rangeDelayed = new Promise<void>(resolve => { releaseRange = resolve; });
  await page.route("**/api/owlet/history?**", async route => {
    await rangeDelayed;
    await route.fulfill({ json: historyData(route) });
  });
  await page.getByRole("combobox", { name: "Graph range" }).click();
  await page.getByRole("option", { name: "10 min", exact: true }).click();
  await expect(page.locator(".owlet-graph-loading")).toBeVisible();
  await expect(page.getByRole("img", { name: /Heart rate graph/ })).toHaveCount(0);
  releaseRange();
  await expect(page.getByRole("img", { name: /Heart rate graph/ })).toBeVisible();
});

test("Owlet reports history failure without leaving a loading message", async ({ page }) => {
  await mockHousehold(page, route => route.fulfill({ status: 503, json: { error: "Graph history unavailable" } }));
  await page.locator(".owlet-card").click();
  await expect(page.getByText("Graph history unavailable", { exact: true })).toBeVisible();
  await expect(page.locator(".owlet-graph-loading")).toHaveCount(0);
});
