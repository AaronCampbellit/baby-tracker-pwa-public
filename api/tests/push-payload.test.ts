import { test } from "node:test";
import assert from "node:assert/strict";
import { pushPayload } from "../src/push-payload.ts";

test("push messages describe a complete iOS fallback and retain installed-worker compatibility", () => {
  const message = {
    title: "Baby: Owlet alert",
    body: "Review the recorded reading.",
    tag: "owlet-event-42",
    url: "/?family=family&child=child&owletAlert=42",
    alertId: "42",
    badgeCount: 2,
    requireInteraction: true,
    renotify: true,
  };
  const payload = JSON.parse(pushPayload(message, "https://baby.example"));
  assert.equal(payload.web_push, 8030);
  assert.equal(payload.title, message.title);
  assert.equal(payload.url, message.url);
  assert.equal(
    payload.notification.navigate,
    "https://baby.example" + message.url,
  );
  assert.equal(payload.notification.app_badge, "2");
  assert.equal(payload.notification.data.alertId, "42");
  assert.equal(payload.notification.data.url, payload.notification.navigate);
  assert.equal(payload.notification.tag, message.tag);
  assert.equal(payload.notification.silent, false);
  assert.equal(payload.notification.renotify, true);
});

test("zero clears the badge and omitted badge counts do not modify it", () => {
  const message = {
    title: "Timer",
    body: "Review timer",
    tag: "timer-1",
    url: "/",
  };
  assert.equal(
    JSON.parse(pushPayload({ ...message, badgeCount: 0 })).notification
      .app_badge,
    "0",
  );
  assert.equal(
    "app_badge" in JSON.parse(pushPayload(message)).notification,
    false,
  );
  assert.throws(() =>
    pushPayload({ ...message, url: "https://elsewhere.example" }),
  );
  assert.throws(() => pushPayload({ ...message, badgeCount: -1 }));
});
