import { test, expect } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";

let server: Server, origin: string;
test.beforeAll(async () => {
  const root = resolve(import.meta.dirname, "../dist/pwa");
  const types: Record<string, string> = {
    ".html": "text/html",
    ".js": "text/javascript",
    ".css": "text/css",
    ".webmanifest": "application/manifest+json",
    ".png": "image/png",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
  };
  server = createServer(async (req, res) => {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    const file = resolve(root, "." + (path === "/" ? "/index.html" : path));
    try {
      if (!file.startsWith(root + sep)) throw new Error("Invalid path");
      const content = await readFile(file);
      res.writeHead(200, {
        "Content-Type": types[extname(file)] ?? "application/octet-stream",
      });
      res.end(content);
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
test.afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

test("production PWA starts offline from its service worker and uploads a queued entry on reconnect", async ({
  browser,
}) => {
  test.setTimeout(40000);
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    serviceWorkers: "allow",
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let offline = false,
    uploads = 0,
    revision = 1;
  let snapshot: any = {
    children: [
      {
        id: "baby",
        name: "Baby",
        birthDate: "2026-01-01",
        sex: "Not specified",
      },
    ],
    activities: [],
    naraImports: [],
  };
  await context.route("**/api/**", async (route) => {
    if (offline) return route.abort("internetdisconnected");
    const path = new URL(route.request().url()).pathname;
    let json: unknown = {};
    if (path === "/api/me")
      json = {
        user: { id: "owner", name: "Caregiver", email: "fixture@example.test" },
        families: [{ id: "family", name: "Family", role: "owner" }],
        pushEnabled: false,
        reminderMinutes: 5,
      };
    else if (path === "/api/families/family")
      json = { revision, snapshot, members: [] };
    else if (path === "/api/families/family/sync") {
      uploads++;
      snapshot = route.request().postDataJSON().snapshot;
      json = { revision: ++revision, snapshot };
    } else if (path === "/api/owlet/active-alerts") json = { events: [] };
    else if (path === "/api/owlet")
      json = { configured: false, connections: [] };
    await route.fulfill({ json });
  });
  try {
    await page.goto(origin);
    await expect(
      page.getByRole("heading", { name: "Quick actions", exact: true }),
    ).toBeVisible();
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await expect
      .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller))
      .toBe(true);
    // No online reload is needed to populate the cache after initial installation.
    offline = true;
    await context.setOffline(true);
    await page.getByRole("button", { name: /^Diaper/ }).click();
    await page.getByRole("button", { name: "Save entry", exact: true }).click();
    await expect(page.locator(".cloud-info")).toContainText("offline");
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Quick actions", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".recent")).toContainText("Diaper");
    offline = false;
    await context.setOffline(false);
    await expect(page.locator(".cloud-info")).toContainText("Synced");
    expect(uploads).toBe(1);
    expect(snapshot.activities[0].kind).toBe("Diaper");
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});
