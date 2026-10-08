import { test, expect, type Page } from "@playwright/test";

type Device = {
  installed?: boolean;
  permission?: NotificationPermission;
  supported?: boolean;
  pushManager?: boolean;
  subscribed?: boolean;
  declarative?: boolean;
  expired?: boolean;
  savedOff?: boolean;
  alertAtOpen?: boolean;
  openSettings?: boolean;
  vapidChanged?: boolean;
};
async function notificationDevice(
  page: Page,
  device: Device = {},
  registered = false,
) {
  await page.addInitScript((options: Device) => {
    Object.defineProperty(navigator, "platform", {
      configurable: true,
      value: "MacIntel",
    });
    Object.defineProperty(navigator, "maxTouchPoints", {
      configurable: true,
      value: 5,
    });
    Object.defineProperty(navigator, "standalone", {
      configurable: true,
      value: options.installed ?? true,
    });
    if (options.savedOff)
      localStorage.setItem(
        "baby-notifications-v1:caregiver",
        JSON.stringify({ push: false, inApp: false, sound: false }),
      );
    let renewed = false;
    let permission = options.permission ?? "default";
    let subscription: unknown = options.subscribed ? makeSubscription() : null;
    const events: string[] = [];
    Object.assign(window, { notificationEvents: events });
    function makeSubscription() {
      const json = {
        endpoint: `https://web.push.apple.com/fixture/${renewed ? "ipad-renewed" : "ipad"}`,
        keys: { p256dh: "x".repeat(87), auth: "x".repeat(22) },
      };
      return {
        ...json,
        options: {
          applicationServerKey: Uint8Array.of(
            options.vapidChanged && !renewed ? 121 : 120,
          ).buffer,
        },
        toJSON: () => json,
        unsubscribe: async () => {
          subscription = null;
          renewed = true;
          events.push("unsubscribe");
          return true;
        },
      };
    }
    if (options.supported === false)
      Reflect.deleteProperty(window, "Notification");
    else
      Object.defineProperty(window, "Notification", {
        configurable: true,
        value: {
          get permission() {
            return permission;
          },
          requestPermission: () => {
            events.push(
              navigator.userActivation.isActive
                ? "permission-from-tap"
                : "permission-without-tap",
            );
            permission = "granted";
            return Promise.resolve(permission);
          },
        },
      });
    // Model an iPad whose registration supports push without a global constructor.
    Reflect.deleteProperty(window, "PushManager");
    const registration = {
      pushManager:
        options.pushManager === false
          ? undefined
          : {
              getSubscription: async () => subscription,
              subscribe: async () => {
                events.push("subscribe");
                subscription = makeSubscription();
                return subscription;
              },
            },
    };
    if (options.declarative)
      Object.defineProperty(window, "pushManager", {
        configurable: true,
        value: registration.pushManager,
      });
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: {
        getRegistration: async () => {
          events.push("registration");
          return registration;
        },
        ready: options.declarative
          ? new Promise(() => {})
          : Promise.resolve(registration),
      },
    });
  }, device);
  const calls: { path: string; body: any }[] = [];
  let testStatus = 200;
  let expired = device.expired ?? false;
  let offline = false;
  let activeAlerts: any[] = [];
  let history: any[] = [];
  if (expired) registered = false;
  if (device.alertAtOpen) {
    const stamp = new Date(Date.now() - 120000).toISOString();
    activeAlerts = [
      {
        id: "123",
        child_id: "child",
        child_name: "Baby",
        kind: "oxygen_below",
        measured_value: 89,
        threshold_value: 92,
        measured_at: stamp,
        created_at: stamp,
      },
    ];
  }

  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (offline && path === "/api/owlet/active-alerts")
      return route.fulfill({
        status: 503,
        json: { error: "Fixture unavailable" },
      });
    let json: unknown = {};
    if (path === "/api/me")
      json = {
        user: {
          id: "caregiver",
          name: "Caregiver",
          email: "fixture@example.test",
        },
        families: [{ id: "family", name: "Family", role: "caregiver" }],
        pushEnabled: true,
        vapidPublicKey: "eA",
        reminderMinutes: 5,
      };
    else if (path === "/api/families/family")
      json = {
        revision: 1,
        snapshot: {
          children: [
            {
              id: "child",
              name: "Baby",
              birthDate: "2026-01-01",
              sex: "Not specified",
            },
          ],
          activities: [],
          naraImports: [],
        },
        members: [],
      };
    else if (path === "/api/owlet")
      json = { configured: true, connections: [] };
    else if (path === "/api/owlet/active-alerts")
      json = { events: activeAlerts };
    else if (path === "/api/notifications") json = { events: history };
    else if (path === "/api/owlet/accept-alert") {
      const id = route.request().postDataJSON().eventId;
      const stamp = new Date().toISOString();
      activeAlerts = activeAlerts.filter((event) => event.id !== id);
      history = history.map((event) =>
        event.alert_id === id
          ? { ...event, status: "accepted", acknowledged_at: stamp }
          : event,
      );
      json = { ok: true, acknowledged_at: stamp, badgeCount: 0 };
    } else if (path === "/api/owlet/alerts")
      json = { settings: null, events: [] };
    else if (path.startsWith("/api/push")) {
      calls.push({ path, body: route.request().postDataJSON() });
      if (path === "/api/push/status")
        json = {
          registered,
          expired:
            expired &&
            route.request().postDataJSON().endpoint.endsWith("/ipad"),
        };
      if (path === "/api/push") {
        registered = route.request().method() !== "DELETE";
        if (registered) {
          expired = false;
          testStatus = 200;
        }
      }
      if (path === "/api/push/test")
        return route.fulfill({
          status: testStatus,
          json:
            testStatus === 200
              ? { accepted: true }
              : {
                  error:
                    "This device’s notification registration expired. Enable notifications again, then retry the test.",
                },
        });
    }
    await route.fulfill({ json });
  });
  await page.goto("/pwa.html");
  await expect(page.locator(".baby-app")).toBeVisible({ timeout: 10000 });
  if (device.openSettings !== false) {
    await page.getByRole("button", { name: "Family", exact: true }).click();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page
      .getByRole("button", { name: "Notifications", exact: true })
      .click();
  }
  return {
    calls,
    expire: () => {
      testStatus = 410;
      registered = false;
      expired = true;
    },
    forget: () => {
      registered = false;
    },
    disconnect: () => {
      offline = true;
    },
    reconnect: () => {
      offline = false;
    },
    alert: (ids = ["123"]) => {
      const stamp = new Date(Date.now() - 120000).toISOString();
      const event = {
        id: "123",
        child_id: "child",
        child_name: "Baby",
        kind: "oxygen_below",
        measured_value: 89,
        threshold_value: 92,
        measured_at: stamp,
        created_at: stamp,
      };
      activeAlerts = ids.map((id) => ({ ...event, id }));
      history = activeAlerts.map((alert) => ({
        ...alert,
        id: `owlet-${alert.id}`,
        alert_id: alert.id,
        source: "owlet",
        status: "active",
        url: "/",
      }));
    },
  };
}
test.use({ viewport: { width: 1024, height: 768 }, hasTouch: true });

async function recordAlertSound(page: Page) {
  await page.addInitScript(() => {
    const sounds: string[] = [];
    Object.assign(window, { alertSounds: sounds });
    const noop = () => {};
    class Audio extends EventTarget {
      state = "suspended";
      currentTime = 0;
      destination = {};
      async resume() {
        this.state = "running";
        this.dispatchEvent(new Event("statechange"));
      }
      async suspend() {
        this.state = "suspended";
        this.dispatchEvent(new Event("statechange"));
      }
      createOscillator() {
        return {
          frequency: { setValueAtTime: noop },
          connect: noop,
          disconnect: noop,
          onended: null as (() => void) | null,
          start() {
            sounds.push("beep");
          },
          stop(at?: number) {
            if (at === undefined) {
              sounds.push("cancel");
              this.onended?.();
            }
          },
        };
      }
      createGain() {
        return {
          gain: { setValueAtTime: noop, linearRampToValueAtTime: noop },
          connect: noop,
          disconnect: noop,
        };
      }
    }
    Object.defineProperty(window, "AudioContext", {
      configurable: true,
      value: Audio,
    });
    Object.defineProperty(navigator, "vibrate", {
      configurable: true,
      value: (pattern: number | number[]) => {
        if (pattern === 0) sounds.push("vibration-cancel");
        return true;
      },
    });
  });
}

test("Accept cancels sound and a stale in-flight refresh cannot restart the alert", async ({
  page,
}) => {
  await recordAlertSound(page);
  await notificationDevice(page, { alertAtOpen: true, openSettings: false });
  await page
    .getByRole("heading", {
      name: "Owlet · Accept to stop repeats",
      exact: true,
    })
    .click();
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).alertSounds.includes("beep")),
    )
    .toBe(true);
  let release: (() => void) | undefined;
  const arrived = new Promise<void>((resolve) => {
    void page.route(
      "**/api/owlet/active-alerts?*",
      async (route) => {
        await new Promise<void>((resume) => {
          release = resume;
          resolve();
        });
        await route.fulfill({
          json: {
            events: [
              {
                id: "123",
                child_id: "child",
                child_name: "Baby",
                kind: "oxygen_below",
                measured_value: 89,
                threshold_value: 92,
                measured_at: new Date().toISOString(),
                created_at: new Date().toISOString(),
              },
            ],
          },
        });
      },
      { times: 1 },
    );
  });
  await arrived;
  try {
    await page.getByRole("button", { name: "Accept", exact: true }).click();
    await expect(page.locator(".owlet-urgent")).toHaveCount(0);
    const sounds: string[] = await page.evaluate(
      () => (window as any).alertSounds,
    );
    expect(sounds).toContain("cancel");
    expect(sounds).toContain("vibration-cancel");
    release!();
    await page.waitForTimeout(2200);
    await expect(page.locator(".owlet-urgent")).toHaveCount(0);
    expect(
      await page.evaluate(() =>
        JSON.parse(localStorage.getItem("baby-owlet-pending-family") || "[]"),
      ),
    ).toEqual([]);
    expect(
      await page.evaluate(
        () =>
          (window as any).alertSounds.filter(
            (sound: string) => sound === "beep",
          ).length,
      ),
    ).toBe(sounds.filter((sound) => sound === "beep").length);
  } finally {
    release?.();
  }
});

test("failed acceptance keeps sounding, and accepting one alert preserves the other", async ({
  page,
}) => {
  await recordAlertSound(page);
  const fixture = await notificationDevice(page, { openSettings: false });
  fixture.alert(["123", "124"]);
  await page
    .getByRole("heading", {
      name: "Owlet · Accept to stop repeats",
      exact: true,
    })
    .click();
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).alertSounds.includes("beep")),
    )
    .toBe(true);
  await page.route(
    "**/api/owlet/accept-alert",
    (route) =>
      route.fulfill({ status: 503, json: { error: "Acceptance unavailable" } }),
    { times: 1 },
  );
  await page
    .getByRole("button", { name: "Accept", exact: true })
    .first()
    .click();
  await expect(page.getByText(/Acceptance unavailable/)).toBeVisible();
  await expect(page.locator(".owlet-urgent-event")).toHaveCount(2);
  let count = await page.evaluate(
    () =>
      (window as any).alertSounds.filter((sound: string) => sound === "beep")
        .length,
  );
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).alertSounds.filter(
            (sound: string) => sound === "beep",
          ).length,
      ),
    )
    .toBeGreaterThan(count);
  await page
    .getByRole("button", { name: "Accept", exact: true })
    .first()
    .click();
  await expect(page.locator(".owlet-urgent-event")).toHaveCount(1);
  count = await page.evaluate(
    () =>
      (window as any).alertSounds.filter((sound: string) => sound === "beep")
        .length,
  );
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).alertSounds.filter(
            (sound: string) => sound === "beep",
          ).length,
      ),
    )
    .toBeGreaterThan(count);
  await page
    .getByRole("button", { name: "Notification settings", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Recent notifications", exact: true })
    .click();
  await page.getByRole("button", { name: "Accept", exact: true }).click();
  await expect(page.locator(".notification-status.active")).toHaveCount(0);
  count = await page.evaluate(
    () =>
      (window as any).alertSounds.filter((sound: string) => sound === "beep")
        .length,
  );
  expect(await page.evaluate(() => (window as any).alertSounds)).toContain(
    "cancel",
  );
  await page.waitForTimeout(1200);
  expect(
    await page.evaluate(
      () =>
        (window as any).alertSounds.filter((sound: string) => sound === "beep")
          .length,
    ),
  ).toBe(count);
});

test("installed iPad enables via registration capability and sends a test only to its endpoint", async ({
  page,
}) => {
  const { calls } = await notificationDevice(page);
  await expect(
    page.getByText(
      "Phone notifications are on, but this device still needs your permission.",
      {
        exact: true,
      },
    ),
  ).toBeVisible();
  await page.evaluate(() => {
    (window as any).notificationEvents.length = 0;
  });
  await page
    .getByRole("button", {
      name: "Enable notifications on this device",
      exact: true,
    })
    .tap();
  await expect(
    page.getByText("Notifications enabled on this device for your account.", {
      exact: true,
    }),
  ).toBeVisible();
  const events = await page.evaluate(() => (window as any).notificationEvents);
  expect(events[0]).toBe("permission-from-tap");
  expect(events).toContain("subscribe");
  await page
    .getByRole("button", { name: "Send test notification", exact: true })
    .tap();
  await expect(
    page.getByText(
      /Test notification sent\. Check this device’s Notification Center/,
    ),
  ).toBeVisible();
  expect(calls.filter((c) => c.path === "/api/push/test")).toEqual([
    {
      path: "/api/push/test",
      body: { endpoint: "https://web.push.apple.com/fixture/ipad" },
    },
  ]);
  expect(calls.filter((c) => c.path === "/api/push")).toHaveLength(1);
});

test("an existing local subscription is registered for the current account automatically", async ({
  page,
}) => {
  const { calls } = await notificationDevice(page, {
    permission: "granted",
    subscribed: true,
  });
  await expect(
    page.getByRole("button", { name: "Send test notification", exact: true }),
  ).toBeEnabled();
  expect(calls.filter((c) => c.path === "/api/push")).toHaveLength(1);
  expect(
    await page.evaluate(() => (window as any).notificationEvents),
  ).not.toContain("subscribe");
});

test("iOS declarative push enables and tests without waiting for an unavailable worker", async ({
  page,
}) => {
  const { calls } = await notificationDevice(page, { declarative: true });
  await expect(
    page.getByText(
      "Phone notifications are on, but this device still needs your permission.",
      {
        exact: true,
      },
    ),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: "Enable notifications on this device",
      exact: true,
    })
    .tap();
  await expect(
    page.getByText("Notifications enabled on this device for your account.", {
      exact: true,
    }),
  ).toBeVisible();
  const events = await page.evaluate(() => (window as any).notificationEvents);
  expect(events).toContain("permission-from-tap");
  expect(events).not.toContain("registration");
  await page
    .getByRole("button", { name: "Send test notification", exact: true })
    .tap();
  await expect(page.getByText(/Test notification sent/)).toBeVisible();
  expect(calls.filter((call) => call.path === "/api/push/test")).toHaveLength(
    1,
  );
});

test("browser iPad shows installation guidance while an installed unsupported app does not", async ({
  page,
  browser,
}) => {
  await notificationDevice(page, { installed: false });
  await expect(
    page.getByText(/On iPhone or iPad, add this app to the Home Screen/),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Enable notifications on this device",
      exact: true,
    }),
  ).toBeDisabled();
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
  });
  try {
    const installed = await context.newPage();
    await notificationDevice(installed, { supported: false });
    await expect(
      installed.getByText(
        /Notifications are unavailable in this app on this device/,
      ),
    ).toBeVisible();
    await expect(
      installed.getByText(/add this app to the Home Screen/),
    ).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test("denied permission directs the caregiver to settings without prompting or sending", async ({
  page,
}) => {
  const { calls } = await notificationDevice(page, { permission: "denied" });
  await expect(
    page.getByText(/Notifications are blocked\. Allow them for this app/),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Enable notifications on this device",
      exact: true,
    }),
  ).toBeDisabled();
  expect(
    calls.filter(
      (call) => call.path === "/api/push" || call.path === "/api/push/test",
    ),
  ).toHaveLength(0);
});

test("an installed app without registration push support explains availability without installation advice", async ({
  page,
}) => {
  await notificationDevice(page, { pushManager: false });
  await expect(
    page.getByText(
      /Push notifications are unavailable in this app on this device/,
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Enable notifications on this device",
      exact: true,
    }),
  ).toBeDisabled();
  await expect(page.getByText(/add this app to the Home Screen/)).toHaveCount(
    0,
  );
});

test("expired registration renews automatically after the test reports expiration", async ({
  page,
}) => {
  const fixture = await notificationDevice(
    page,
    { permission: "granted", subscribed: true },
    true,
  );
  await expect(
    page.getByRole("button", { name: "Send test notification", exact: true }),
  ).toBeEnabled();
  fixture.expire();
  await page
    .getByRole("button", { name: "Send test notification", exact: true })
    .tap();
  await expect(
    page.getByText(/This device’s notification registration expired/),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Send test notification", exact: true }),
  ).toBeEnabled();
  expect(
    await page.evaluate(() => (window as any).notificationEvents),
  ).toContain("unsubscribe");
});

test("notification controls are centralized and preserve dark mode", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await notificationDevice(
    page,
    { permission: "granted", subscribed: true },
    true,
  );
  await expect(page).toHaveTitle(/Did I Feed My Baby/);
  await expect(page.locator("vite-error-overlay")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Send test notification", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "← Your settings", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Send test notification", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "dark", exact: true }).tap();
  await page.getByRole("button", { name: "Notifications", exact: true }).tap();
  await expect(
    page.getByRole("checkbox", { name: /^In-app alert panels/ }),
  ).toBeChecked();
  await expect(
    page.getByRole("checkbox", { name: /^Alert sound/ }),
  ).toBeChecked();
  await expect(page.locator(".baby-app.dark")).toBeVisible();
  await page.screenshot({ path: "/tmp/baby-notifications-settings-dark.png" });
  expect(errors).toEqual([]);
});

test("reopening repairs a missing server registration without resetting a valid one", async ({
  page,
}) => {
  const fixture = await notificationDevice(
    page,
    { permission: "granted", subscribed: true },
    true,
  );
  await expect(
    page.getByRole("button", { name: "Send test notification", exact: true }),
  ).toBeEnabled();
  expect(
    fixture.calls.filter((call) => call.path === "/api/push"),
  ).toHaveLength(0);
  fixture.forget();
  await page.evaluate(() => {
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("online"));
  });
  await expect
    .poll(
      () => fixture.calls.filter((call) => call.path === "/api/push").length,
    )
    .toBe(1);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect
    .poll(
      () =>
        fixture.calls.filter((call) => call.path === "/api/push/status").length,
    )
    .toBeGreaterThan(1);
  expect(
    fixture.calls.filter((call) => call.path === "/api/push"),
  ).toHaveLength(1);
  expect(
    await page.evaluate(() => (window as any).notificationEvents),
  ).not.toContain("permission-from-tap");
});

test("opening renews a provider-expired subscription and registers its new endpoint", async ({
  page,
}) => {
  const fixture = await notificationDevice(page, {
    permission: "granted",
    subscribed: true,
    expired: true,
  });
  await expect(
    page.getByRole("button", { name: "Send test notification", exact: true }),
  ).toBeEnabled();
  const events = await page.evaluate(() => (window as any).notificationEvents);
  expect(events).toContain("unsubscribe");
  expect(events).toContain("subscribe");
  expect(
    fixture.calls.filter((call) => call.path === "/api/push")[0].body.endpoint,
  ).toBe("https://web.push.apple.com/fixture/ipad-renewed");
});

test("saved Off preferences survive opening and do not enroll the device", async ({
  page,
}) => {
  const fixture = await notificationDevice(page, {
    permission: "granted",
    savedOff: true,
  });
  await expect(
    page.getByRole("checkbox", { name: /^Phone notifications/ }),
  ).not.toBeChecked();
  await expect(
    page.getByRole("checkbox", { name: /^In-app alert panels/ }),
  ).not.toBeChecked();
  await expect(
    page.getByRole("checkbox", { name: /^Alert sound/ }),
  ).not.toBeChecked();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  expect(
    fixture.calls.filter((call) => call.path === "/api/push"),
  ).toHaveLength(0);
  expect(
    await page.evaluate(() => (window as any).notificationEvents),
  ).not.toContain("subscribe");
});

test("empty-device alert connection failures are visible and recover on return", async ({
  page,
}) => {
  const fixture = await notificationDevice(page);
  fixture.disconnect();
  await expect(
    page
      .getByText(
        "Owlet alert connection unavailable. Retrying automatically.",
        { exact: true },
      )
      .first(),
  ).toBeVisible();
  fixture.reconnect();
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(
    page.getByText("Owlet alert connection is up to date.", { exact: true }),
  ).toBeVisible();
});

test("the bell keeps one original event and changes it from Active to Accepted", async ({
  page,
}) => {
  const fixture = await notificationDevice(page);
  fixture.alert();
  await page
    .getByRole("button", { name: "Recent notifications", exact: true })
    .click();
  await expect(page.locator(".notification-history-item")).toHaveCount(1);
  await expect(page.locator(".notification-status")).toHaveText("Active");
  const start = await page
    .locator(".notification-history-item time")
    .first()
    .getAttribute("datetime");
  for (let i = 0; i < 3; i++)
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.locator(".notification-history-item")).toHaveCount(1);
  await page.getByRole("button", { name: "Accept", exact: true }).click();
  await expect(page.locator(".notification-status")).toHaveText("Accepted");
  await expect(page.locator(".notification-history-item time")).toHaveCount(2);
  await expect(
    page.locator(".notification-history-item time").first(),
  ).toHaveAttribute("datetime", start!);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const history = JSON.parse(
          localStorage.getItem("baby-notification-history-v1:caregiver:family") ||
            "[]",
        );
        const event = history.find((item: any) => item.id === "owlet-123");
        return event?.status === "accepted" && Boolean(event.acknowledged_at);
      }),
    )
    .toBe(true);
  await page.screenshot({ path: "/tmp/baby-notifications-history.png" });
});

test("a fresh second session shows an already-active alert and reconnects push", async ({
  page,
  browser,
}) => {
  const first = await notificationDevice(page, {
    permission: "granted",
    subscribed: true,
    openSettings: false,
  });
  first.alert();
  await expect(
    page.getByRole("heading", {
      name: "Owlet · Accept to stop repeats",
      exact: true,
    }),
  ).toBeVisible();
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
  });
  try {
    const second = await context.newPage();
    const late = await notificationDevice(second, {
      permission: "granted",
      subscribed: true,
      alertAtOpen: true,
      openSettings: false,
    });
    await expect(
      second.getByRole("heading", {
        name: "Owlet · Accept to stop repeats",
        exact: true,
      }),
    ).toBeVisible();
    await expect
      .poll(() => late.calls.filter((call) => call.path === "/api/push").length)
      .toBe(1);
    await expect(
      second.getByRole("button", { name: "Accept", exact: true }),
    ).toBeVisible();
  } finally {
    await context.close();
  }
});

test("server key rotation renews a subscription made with the previous key", async ({
  page,
}) => {
  const fixture = await notificationDevice(
    page,
    { permission: "granted", subscribed: true, vapidChanged: true },
    true,
  );
  await expect(
    page.getByRole("button", { name: "Send test notification", exact: true }),
  ).toBeEnabled();
  const events = await page.evaluate(() => (window as any).notificationEvents);
  expect(events).toContain("unsubscribe");
  expect(events).toContain("subscribe");
  expect(
    fixture.calls.filter((call) => call.path === "/api/push")[0].body.endpoint,
  ).toBe("https://web.push.apple.com/fixture/ipad-renewed");
});
