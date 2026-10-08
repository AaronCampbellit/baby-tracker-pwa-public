import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const script = readFileSync(
  new URL("../../public/sw.js", import.meta.url),
  "utf8",
);
test("installation caches the first-launch scripts/styles without caching private API links", async () => {
  const handlers = new Map<string, (event: any) => void>();
  const cached: string[] = [];
  let activated = false;
  runInNewContext(script, {
    URL,
    caches: {
      open: async () => ({
        addAll: async (urls: string[]) => {
          cached.push(...urls);
        },
        match: async () => ({
          text: async () =>
            '<script src="/assets/app-hash.js"></script><link href="/assets/app-hash.css"><link href="/api/private"><script src="https://elsewhere.example/assets/external.js"></script>',
        }),
      }),
    },
    self: {
      location: { origin: "https://baby.example" },
      addEventListener: (name: string, handler: (event: any) => void) =>
        handlers.set(name, handler),
      skipWaiting: async () => {
        activated = true;
      },
    },
  });
  let done = Promise.resolve();
  handlers.get("install")!({
    waitUntil: (value: Promise<void>) => {
      done = value;
    },
  });
  await done;
  assert.equal(activated, true);
  assert.ok(cached.includes("https://baby.example/assets/app-hash.js"));
  assert.ok(cached.includes("https://baby.example/assets/app-hash.css"));
  assert.equal(
    cached.some((url) => url.includes("/api/") || url.includes("elsewhere")),
    false,
  );
});
function worker(badgeFails = false) {
  const handlers = new Map<string, (event: any) => void>();
  const notifications: any[] = [],
    badges: number[] = [],
    links: string[] = [];
  runInNewContext(script, {
    URL,
    self: {
      location: { origin: "https://baby.example" },
      addEventListener: (name: string, handler: (event: any) => void) =>
        handlers.set(name, handler),
      navigator: {
        setAppBadge: async (count: number) => {
          if (badgeFails) throw new Error("Denied");
          badges.push(count);
        },
        clearAppBadge: async () => {
          badges.push(0);
        },
      },
      registration: {
        showNotification: async (title: string, options: any) => {
          notifications.push({ title, ...options });
        },
      },
      clients: {
        matchAll: async () => [],
        openWindow: async (url: string) => {
          links.push(url);
        },
      },
    },
  });
  const dispatch = async (name: string, event: any) => {
    let done = Promise.resolve();
    handlers.get(name)!({
      ...event,
      waitUntil: (promise: Promise<void>) => {
        done = promise;
      },
    });
    await done;
  };
  return { notifications, badges, links, dispatch };
}

test("legacy and declarative pushes display once and repeated pushes do not inflate badges", async () => {
  const app = worker();
  await app.dispatch("push", {
    data: { json: () => ({ title: "Legacy timer", url: "/?timer=1" }) },
  });
  const data = {
    web_push: 8030,
    notification: {
      title: "Alert",
      navigate: "https://baby.example/?owletAlert=42",
      tag: "owlet-event-42",
      app_badge: "2",
      data: { alertId: "42" },
      renotify: true,
    },
  };
  await app.dispatch("push", { data: { json: () => data } });
  await app.dispatch("push", { data: { json: () => data } });
  assert.equal(app.notifications.length, 3);
  assert.equal(app.notifications[1].data.alertId, "42");
  assert.deepEqual(app.badges, [2, 2]);
  await app.dispatch("notificationclick", {
    notification: { ...app.notifications[1], close() {} },
  });
  assert.deepEqual(app.links, ["https://baby.example/?owletAlert=42"]);
});

test("badge failures and malformed payloads still show notifications; links stay in the app", async () => {
  const app = worker(true);
  await app.dispatch("push", {
    data: {
      json: () => ({
        title: "Alert",
        badgeCount: 1,
        url: "https://evil.example",
      }),
    },
  });
  await app.dispatch("push", {
    data: {
      json: () => {
        throw new Error("Invalid JSON");
      },
    },
  });
  assert.equal(app.notifications.length, 2);
  assert.equal(app.notifications[0].data.url, "https://baby.example/");
  await app.dispatch("push", {
    data: {
      json: () => ({
        web_push: 8030,
        notification: { title: "Cleared", app_badge: "0" },
      }),
    },
  });
  assert.deepEqual(app.badges, [0]);
});
