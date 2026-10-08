import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { requireRetainedActivityIds, validateSnapshot } from "../src/validation.ts";

test("retention handles the 50,000-record limit with a linear ID-read budget", () => {
  let reads = 0;
  const ids = Array.from({ length: 50000 }, () => randomUUID());
  const records = ids.map((id) => ({ get id() { reads++; return id; } }));
  requireRetainedActivityIds(records, records.toReversed());
  assert.ok(reads <= 100000, `read IDs ${reads} times`);
});

test("retention accepts reordering, additions, and tombstones but rejects omitted IDs", () => {
  const a = { id: randomUUID(), deleted: true };
  const b = { id: randomUUID() };
  requireRetainedActivityIds([a, b], [b, { id: randomUUID() }, a]);
  requireRetainedActivityIds([], []);
  assert.throws(() => requireRetainedActivityIds([a, b], [b]), {
    status: 400,
    message: "Use deletion markers rather than removing records",
  });
  assert.throws(() => requireRetainedActivityIds([a, b], [a]), { status: 400 });
});

test("snapshot validation preserves the import limit and rejects duplicate IDs", () => {
  const child = { id: randomUUID(), name: "Demo", birthDate: "2020-01-01" };
  const activity = { id: randomUUID(), childId: child.id, kind: "Feed", start: 1,
    detail: "", notes: "", author: "Demo" };
  const activities = Array.from({ length: 50000 }, () => ({ ...activity, id: randomUUID() }));
  assert.equal(validateSnapshot({ children: [child], activities }).activities.length, 50000);
  assert.throws(() => validateSnapshot({ children: [child], activities: [activity, activity] }), {
    status: 400, message: "Duplicate record",
  });
  assert.throws(() => validateSnapshot({ children: [child], activities: [...activities, activity] }), {
    status: 400, message: "Invalid family records",
  });
});
