import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID, randomBytes } from "node:crypto";
const origin = "http://localhost:4174";
const cwd = new URL("../../", import.meta.url);
function admin(name: string) {
  const value = execFileSync(
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
      name,
    ],
    { cwd, encoding: "utf8" },
  );
  return JSON.parse(value);
}
function client() {
  let cookie = "";
  return async (path: string, data?: any, expected = 200) => {
    const res = await fetch(origin + "/api" + path, {
      method: data === undefined ? "GET" : "POST",
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        Cookie: cookie,
      },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    const b = await res.json();
    assert.equal(res.status, expected, JSON.stringify(b));
    return b;
  };
}
test("account activation, household isolation, idempotent sync, conflicts, five-child cap and reminder cancellation", async () => {
  const suffix = randomBytes(4).toString("hex");
  const f = admin("Integration " + suffix),
    g = admin("Other " + suffix);
  const a = client(),
    b = client(),
    outsider = client();
  await a(
    "/activate",
    {
      invite: new URL(f.activationUrl).searchParams.get("invite"),
      email: `a-${suffix}@example.test`,
      name: "Alex",
      password: "test-only-password-1234",
    },
    201,
  );
  const invitation = await a(`/families/${f.familyId}/invite`, {}, 201);
  await b(
    "/activate",
    {
      invite: invitation.invite,
      email: `b-${suffix}@example.test`,
      name: "Jamie",
      password: "test-only-password-1234",
    },
    201,
  );
  await outsider(
    "/activate",
    {
      invite: new URL(g.activationUrl).searchParams.get("invite"),
      email: `c-${suffix}@example.test`,
      name: "Other",
      password: "test-only-password-1234",
    },
    201,
  );
  await outsider(`/families/${f.familyId}`, undefined, 403);
  await b(`/families/${f.familyId}/invite`, {}, 400);
  const me = await a("/me");
  assert.equal(me.families.length, 1);
  const child = {
    id: randomUUID(),
    name: "Baby",
    birthDate: "2026-05-01",
    sex: "Not specified",
  };
  const activity = {
    id: randomUUID(),
    childId: child.id,
    kind: "Sleep",
    start: Date.now() - 60000,
    detail: "",
    notes: "",
    author: "spoofed",
  };
  const op = {
    operationId: randomUUID(),
    revision: 0,
    snapshot: { children: [child], activities: [activity] },
  };
  const saved = await a(`/families/${f.familyId}/sync`, op);
  assert.equal(saved.revision, 1);
  assert.equal(saved.snapshot.activities[0].author, "Alex");
  const retry = await a(`/families/${f.familyId}/sync`, op);
  assert.equal(retry.revision, 1);
  const fromOther = await b(`/families/${f.familyId}`);
  assert.equal(fromOther.snapshot.activities.length, 1);
  await b(
    `/families/${f.familyId}/sync`,
    { ...op, operationId: randomUUID() },
    409,
  );
  const tooMany = {
    ...op,
    operationId: randomUUID(),
    revision: 1,
    snapshot: {
      children: Array.from({ length: 6 }, () => ({
        ...child,
        id: randomUUID(),
      })),
      activities: [],
    },
  };
  await a(`/families/${f.familyId}/sync`, tooMany, 400);
  const stopped = await b(`/families/${f.familyId}/sync`, {
    operationId: randomUUID(),
    revision: 1,
    snapshot: {
      children: [child],
      activities: [{ ...saved.snapshot.activities[0], end: Date.now() }],
    },
  });
  assert.equal(stopped.revision, 2);
  const jobs = execFileSync(
    "docker",
    [
      "compose",
      "--env-file",
      ".env.local",
      "exec",
      "-T",
      "db",
      "psql",
      "-U",
      "baby",
      "-d",
      "baby",
      "-tAc",
      `SELECT count(*) FROM reminder_jobs WHERE activity_id='${activity.id}'`,
    ],
    { cwd, encoding: "utf8" },
  );
  assert.equal(jobs.trim(), "0");
  await a("/logout", {});
  await a("/me", undefined, 401);
});
