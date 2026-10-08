import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../../", import.meta.url));
test.use({ viewport: { width: 390, height: 844 }, serviceWorkers: "allow" });
// Historical installed-stack test: obsolete selectors still need reconciliation.
// Keep it opt-in; ordinary browser QA must not mutate a local household stack.
test.skip(process.env.BABY_INSTALLED_FLOW_TEST !== "1", "Requires an explicitly configured disposable installed stack; see README.");
test("installed app flow: activation, records, timer recovery, offline queue and screens", async ({
  page,
  context,
}) => {
  test.setTimeout(60000);
  const installedOrigin = process.env.BABY_INSTALLED_TEST_ORIGIN;
  if (!installedOrigin || new URL(installedOrigin).origin !== "http://localhost:4174")
    throw new Error("BABY_INSTALLED_TEST_ORIGIN must explicitly select the documented disposable stack at http://localhost:4174");
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const f = JSON.parse(
    execFileSync(
      "docker",
      [
        "compose",
        "--env-file",
        ".env.local",
        "exec",
        "-T",
        "app",
        "node",
        "api/src/admin.ts",
        "create-family",
        "Browser QA",
      ],
      { cwd: root, encoding: "utf8" },
    ),
  );
  await page.goto(f.activationUrl);
  await page.getByLabel("Your name").fill("Alex");
  await page
    .getByLabel("Email", { exact: true })
    .fill(`ui-${randomBytes(4).toString("hex")}@example.test`);
  await page
    .getByLabel("Password", { exact: true })
    .fill("test-only-password-1234");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await page.getByRole("button", { name: "Log a feed", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Oliver");
  await page.getByLabel("Birth date").fill("2026-05-16");
  await page.getByRole("button", { name: "Add child", exact: true }).click();
  await page.getByRole("button", { name: "Log a feed", exact: true }).click();
  await page.getByLabel("Amount (ml)").fill("120");
  await page.getByRole("button", { name: "Save entry", exact: true }).click();
  await expect(page.locator(".cloud-info")).toContainText("Synced");
  await page.getByRole("button", { name: "Sleep Start a nap" }).click();
  await page
    .getByRole("button", { name: "Start sleep timer", exact: true })
    .click();
  await expect(page.locator(".cloud-info")).toContainText("Synced");
  const timerId = await page.evaluate(async (familyId) => {
    const data = await (await fetch(`/api/families/${familyId}`)).json();
    return data.snapshot.activities.find((a: {kind: string; end?: number}) => a.kind === "Sleep" && !a.end).id;
  }, f.familyId);
  await page.goto(`${installedOrigin}/?family=${f.familyId}&timer=${timerId}`);
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", {name: "Close sheet"}).click();
  await page.getByRole("button", { name: "Stop", exact: true }).waitFor();
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await page.getByRole("button", { name: "Save entry", exact: true }).click();
  await expect(page.locator(".cloud-info")).toContainText("Synced");
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Log a feed", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Stop", exact: true }),
  ).toHaveCount(0);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await context.setOffline(true);
  await page.getByRole("button", { name: "Diaper Log a change" }).click();
  await page.getByRole("button", { name: "Save entry", exact: true }).click();
  await expect(page.locator(".cloud-info")).toContainText("offline");
  await page.reload();
  await expect(page.locator(".recent")).toContainText("Diaper");
  await context.setOffline(false);
  await expect(page.locator(".cloud-info")).toContainText("Synced", {
    timeout: 15000,
  });
  for (const tab of ["Today", "History", "Trends", "Family"]) {
    await page.getByRole("button", { name: tab, exact: true }).click();
    await page.screenshot({
      path: `/tmp/baby-verified-${tab.toLowerCase()}.png`,
    });
  }
  await page.getByRole("button", { name: "Pregnancy & postpartum" }).click();
  await page.getByRole("button", { name: "Pregnancy", exact: true }).click();
  await page.getByLabel("Category", { exact: true }).selectOption("Mood");
  await page.getByLabel("Value / observation").fill("Feeling good");
  await page.getByRole("button", { name: "Save entry", exact: true }).click();
  await expect(page.locator(".cloud-info")).toContainText("Synced");
  expect(errors).toEqual([]);
  expect(await page.title()).toBe("Did I Feed My Baby?");
});
