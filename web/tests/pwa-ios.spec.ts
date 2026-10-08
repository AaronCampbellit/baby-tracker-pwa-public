import { test, expect, type Page } from "@playwright/test";

type Device = {
  persistence?: "granted" | "denied" | "unavailable";
  share?: "shared" | "cancelled" | "failed" | "unavailable";
  alert?: boolean;
};
async function household(page: Page, device: Device = {}) {
  await page.addInitScript((options: Device) => {
    const writes: number[] = [],
      shares: any[] = [],
      copied: string[] = [];
    Object.assign(window, {
      badgeWrites: writes,
      invitationShares: shares,
      copiedInvitations: copied,
    });
    Object.defineProperty(window, "Notification", {
      configurable: true,
      value: { permission: "granted" },
    });
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      get: () => sessionStorage.getItem("fixture-offline") !== "1",
    });
    Object.defineProperty(navigator, "setAppBadge", {
      configurable: true,
      value: async (count: number) => {
        writes.push(count);
      },
    });
    Object.defineProperty(navigator, "clearAppBadge", {
      configurable: true,
      value: async () => {
        writes.push(0);
      },
    });
    Object.defineProperty(navigator, "storage", {
      configurable: true,
      value:
        options.persistence === "unavailable"
          ? undefined
          : {
              persisted: async () => false,
              persist: async () => options.persistence !== "denied",
              estimate: async () => ({
                usage: 2 * 1024 * 1024,
                quota: 100 * 1024 * 1024,
              }),
            },
    });
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value:
        options.share === "unavailable"
          ? undefined
          : async (data: ShareData) => {
              shares.push({
                data,
                activated: navigator.userActivation.isActive,
              });
              if (options.share === "cancelled")
                throw new DOMException("Cancelled", "AbortError");
              if (options.share === "failed")
                throw new DOMException("Failed", "NotAllowedError");
            },
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          copied.push(text);
        },
      },
    });
  }, device);
  let accepted = false,
    loggedOut = false;
  let connected = true,
    count = 2,
    revision = 1,
    reject: number | null = null;
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
  const uploads: any[] = [];
  const reads: string[] = [];
  let uploadDelay: Promise<void> | undefined;
  await page.route("**/api/**", async (route) => {
    if (!connected) return route.abort("internetdisconnected");
    const path = new URL(route.request().url()).pathname;
    reads.push(path);
    let json: unknown = {};
    if (path === "/api/me" && loggedOut)
      return route.fulfill({ status: 401, json: { error: "Please sign in" } });
    if (path === "/api/logout") {
      loggedOut = true;
      json = { ok: true };
    } else if (path === "/api/me")
      json = {
        user: { id: "owner", name: "Caregiver", email: "fixture@example.test" },
        families: [{ id: "family", name: "Family", role: "owner" }],
        pushEnabled: false,
        reminderMinutes: 5,
      };
    else if (path === "/api/families/family")
      json = { revision, snapshot, members: [] };
    else if (path === "/api/families/family/sync") {
      uploads.push(route.request().postDataJSON());
      const upload = uploads.at(-1);
      if (uploadDelay) await uploadDelay;
      if (reject)
        return route.fulfill({
          status: reject,
          json: {
            error:
              reject === 401
                ? "Please sign in"
                : "Another caregiver changed the records",
          },
        });
      snapshot = upload.snapshot;
      revision++;
      json = { revision, snapshot };
    } else if (path === "/api/families/family/invite")
      json = {
        url: `${new URL(route.request().url()).origin}/?invite=one-time-fixture`,
        expiresDays: 7,
      };
    else if (path === "/api/push/badge") json = { count };
    else if (path === "/api/owlet/active-alerts")
      json = {
        events:
          device.alert && !accepted
            ? [
                {
                  id: "42",
                  child_id: "baby",
                  child_name: "Baby",
                  kind: "oxygen_below",
                  measured_value: 90,
                  threshold_value: 95,
                  measured_at: new Date().toISOString(),
                  created_at: new Date().toISOString(),
                },
              ]
            : [],
      };
    else if (path === "/api/owlet/accept-alert") {
      accepted = true;
      count = 1;
      json = { ok: true, badgeCount: 1 };
    } else if (path === "/api/owlet")
      json = { configured: false, connections: [] };
    await route.fulfill({ json });
  });
  await page.goto("/pwa.html");
  if (device.alert)
    await expect(
      page.getByRole("button", { name: "Accept", exact: true }),
    ).toBeVisible();
  else
    await expect(
      page.getByRole("heading", { name: "Quick actions", exact: true }),
    ).toBeVisible();
  return {
    uploads,
    reads,
    setCount: (value: number) => {
      count = value;
    },
    rejectSync: (value: number | null) => {
      reject = value;
    },
    holdUploads: () => {
      let release!: () => void;
      uploadDelay = new Promise<void>((resolve) => {
        release = resolve;
      });
      return () => {
        uploadDelay = undefined;
        release();
      };
    },
    connection: async (value: boolean) => {
      connected = value;
      await page.evaluate((online) => {
        sessionStorage.setItem("fixture-offline", online ? "0" : "1");
        window.dispatchEvent(new Event(online ? "online" : "offline"));
      }, value);
    },
  };
}

async function invitation(page: Page) {
  await page.getByRole("button", { name: "Family", exact: true }).click();
  await page.getByRole("button", { name: /Invite caregiver/ }).click();
  await expect(
    page.getByRole("button", { name: "Share invitation", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Create invitation link", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Copy link", exact: true }),
  ).toBeVisible();
}

test.use({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
});

test("invitation sharing uses the tap and retains a working copy fallback", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await household(page);
  await invitation(page);
  await page
    .getByRole("button", { name: "Share invitation", exact: true })
    .tap();
  await expect(
    page.getByText("Invitation shared.", { exact: true }),
  ).toBeVisible();
  const shares = await page.evaluate(() => (window as any).invitationShares);
  expect(shares).toHaveLength(1);
  expect(shares[0].activated).toBe(true);
  expect(shares[0].data.url).toContain("?invite=one-time-fixture");
  await page.getByRole("button", { name: "Copy link", exact: true }).tap();
  await expect(
    page.getByText("Invitation copied.", { exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => (window as any).copiedInvitations)).toEqual([
    shares[0].data.url,
  ]);
  expect(await page.title()).toBe("Did I Feed My Baby?");
  expect(page.url()).toContain("/pwa.html");
  await expect(page.locator("vite-error-overlay")).toHaveCount(0);
  expect(errors).toEqual([]);
  await page.screenshot({ path: "/tmp/baby-ios-invitation.png" });
  await page.setViewportSize({ width: 1024, height: 768 });
  await expect(
    page.getByRole("button", { name: "Share invitation", exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: "/tmp/baby-ios-invitation-ipad.png" });
});

for (const share of ["cancelled", "failed", "unavailable"] as const) {
  test(`invitation ${share} leaves the generated link usable`, async ({
    page,
  }) => {
    await household(page, { share });
    await invitation(page);
    if (share === "unavailable")
      await expect(
        page.getByRole("button", { name: "Share invitation", exact: true }),
      ).toHaveCount(0);
    else {
      await page
        .getByRole("button", { name: "Share invitation", exact: true })
        .tap();
      if (share === "cancelled")
        await expect(page.locator(".toast")).toHaveCount(0);
      else await expect(page.getByText(/Could not open sharing/)).toBeVisible();
    }
    await page.getByRole("button", { name: "Copy link", exact: true }).tap();
    await expect(
      page.getByText("Invitation copied.", { exact: true }),
    ).toBeVisible();
  });
}

test("badges reconcile on resume, clear zero and preserve their value during network failure", async ({
  page,
}) => {
  const fixture = await household(page);
  await expect
    .poll(() => page.evaluate(() => (window as any).badgeWrites.at(-1)))
    .toBe(2);
  fixture.setCount(0);
  await page.evaluate(() => window.dispatchEvent(new Event("pageshow")));
  await expect
    .poll(() => page.evaluate(() => (window as any).badgeWrites.at(-1)))
    .toBe(0);
  // Simulate a later push setting the icon while this foreground module still remembers zero.
  await page.evaluate(() => navigator.setAppBadge(4));
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect
    .poll(() => page.evaluate(() => (window as any).badgeWrites.at(-1)))
    .toBe(0);
  await fixture.connection(false);
  fixture.setCount(5);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  expect(await page.evaluate(() => (window as any).badgeWrites.at(-1))).toBe(0);
  await fixture.connection(true);
  await expect
    .poll(() => page.evaluate(() => (window as any).badgeWrites.at(-1)))
    .toBe(5);
});

for (const persistence of ["granted", "denied", "unavailable"] as const) {
  test(`offline storage ${persistence} still saves, survives reload and uploads on reconnect`, async ({
    page,
  }) => {
    const fixture = await household(page, { persistence });
    await page.getByRole("button", { name: "Family", exact: true }).click();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    const storage = page.getByRole("region", {
      name: "Offline storage",
      exact: true,
    });
    await expect(storage).toContainText(
      persistence === "granted"
        ? "protected from automatic browser cleanup"
        : persistence === "denied"
          ? "has not granted storage protection"
          : "Storage protection is unavailable",
    );
    if (persistence !== "unavailable")
      await expect(storage).toContainText("2 MB");
    if (persistence === "granted") {
      await storage.scrollIntoViewIfNeeded();
      await page.screenshot({ path: "/tmp/baby-ios-storage.png" });
    }
    await page
      .getByRole("button", { name: "Close sheet", exact: true })
      .click();
    await page.getByRole("button", { name: "Today", exact: true }).click();
    await fixture.connection(false);
    await page.evaluate(async () => {
      const store = await import("/src/domain/store.ts");
      const state = await store.load();
      await store.persist({
        ...state,
        activities: [
          {
            id: "offline-feed",
            childId: "baby",
            kind: "Feed",
            start: Date.now(),
            detail: "Milk",
            notes: "Offline",
            author: "Caregiver",
          },
        ],
      });
    });
    await expect(page.locator(".cloud-info")).toContainText("offline");
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Quick actions", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        async () =>
          (await (await import("/src/domain/store.ts")).load()).activities[0]
            .id,
      ),
    ).toBe("offline-feed");
    await fixture.connection(true);
    await expect(page.locator(".cloud-info")).toContainText("Synced");
    expect(fixture.uploads.at(-1).snapshot.activities[0].id).toBe(
      "offline-feed",
    );
  });
}

test("expired login preserves the durable outbox and conflicts stop automatic uploads", async ({
  page,
}) => {
  const fixture = await household(page);
  fixture.rejectSync(401);
  await page.evaluate(async () => {
    const store = await import("/src/domain/store.ts");
    await store.persist({
      ...(await store.load()),
      activities: [
        {
          id: "expired-feed",
          childId: "baby",
          kind: "Feed",
          start: Date.now(),
          detail: "Milk",
          notes: "",
          author: "Caregiver",
        },
      ],
    });
  });
  await expect(
    page.getByText("Please sign in again to verify household access."),
  ).toBeVisible();
  const pending = await page.evaluate(
    () =>
      new Promise<any>((resolve, reject) => {
        const request = indexedDB.open("did-i-feed-my-baby", 1);
        request.onsuccess = () => {
          const data = request.result
            .transaction("state")
            .objectStore("state")
            .get("family:owner");
          data.onsuccess = () => resolve(data.result);
          data.onerror = () => reject(data.error);
        };
      }),
  );
  expect(pending.activities[0].id).toBe("expired-feed");
  fixture.rejectSync(null);
  await page.reload();
  await expect(page.locator(".cloud-info")).toContainText("Synced");
  expect(fixture.uploads[0].operationId).toBe(fixture.uploads[1].operationId);
  fixture.rejectSync(409);
  await page.evaluate(async () => {
    const store = await import("/src/domain/store.ts");
    const state = await store.load();
    await store.persist({
      ...state,
      activities: [
        ...state.activities,
        { ...state.activities[0], id: "conflict-feed" },
      ],
    });
  });
  await expect(page.locator(".cloud-info")).toContainText("Needs review");
  const before = fixture.uploads.length;
  await page.evaluate(() => {
    window.dispatchEvent(new Event("online"));
    window.dispatchEvent(new Event("pageshow"));
  });
  await expect(page.locator(".cloud-info")).toContainText("Needs review");
  expect(fixture.uploads).toHaveLength(before);
});

test("acceptance clears this household's alert while retaining the other household's badge", async ({
  page,
}) => {
  const fixture = await household(page, { alert: true });
  await expect(
    page.getByRole("dialog", { name: "Owlet · Accept to stop repeats" }),
  ).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => (window as any).badgeWrites.at(-1)))
    .toBe(2);
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Accept", exact: true }),
  ).toBeVisible();
  await fixture.connection(false);
  await page.getByRole("button", { name: "Accept", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Accept", exact: true }),
  ).toBeEnabled();
  expect(await page.evaluate(() => (window as any).badgeWrites.at(-1))).toBe(2);
  await fixture.connection(true);
  await page.getByRole("button", { name: "Accept", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Owlet · Accept to stop repeats" }),
  ).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => (window as any).badgeWrites.at(-1)))
    .toBe(1);
});

test("sign-out clears the Home Screen badge", async ({ page }) => {
  await household(page);
  await page.evaluate(async () => {
    await (await import("/src/domain/store.ts")).sync();
  });
  await expect(page.locator(".cloud-info")).toContainText("Synced");
  await expect
    .poll(() => page.evaluate(() => (window as any).badgeWrites.at(-1)))
    .toBe(2);
  await page.getByRole("button", { name: "Family", exact: true }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  // Capture the OS call before the subsequent page reload resets fixture arrays.
  await page.evaluate(() =>
    Object.defineProperty(navigator, "clearAppBadge", {
      configurable: true,
      value: async () => {
        sessionStorage.setItem("fixture-cleared", "1");
      },
    }),
  );
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Welcome back", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => sessionStorage.getItem("fixture-cleared")),
  ).toBe("1");
});

test("reconnection requests coalesce and edits made during upload drain afterwards", async ({
  page,
}) => {
  const fixture = await household(page);
  const release = fixture.holdUploads();
  const log = (id: string) =>
    page.evaluate(async (id) => {
      const store = await import("/src/domain/store.ts");
      const state = await store.load();
      await store.persist({
        ...state,
        activities: [
          ...state.activities,
          {
            id,
            childId: "baby",
            kind: "Feed",
            start: Date.now(),
            detail: "Milk",
            notes: "",
            author: "Caregiver",
          },
        ],
      });
    }, id);
  await log("first-feed");
  await expect.poll(() => fixture.uploads.length).toBe(1);
  await log("second-feed");
  await page.evaluate(() => {
    for (let i = 0; i < 3; i++) window.dispatchEvent(new Event("online"));
  });
  expect(fixture.uploads).toHaveLength(1);
  release();
  await expect(page.locator(".cloud-info")).toContainText("Synced");
  expect(fixture.uploads).toHaveLength(2);
  expect(
    fixture.uploads[1].snapshot.activities.map((activity: any) => activity.id),
  ).toEqual(["first-feed", "second-feed"]);
});
