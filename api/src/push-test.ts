import webpush from "web-push";
import { randomUUID } from "node:crypto";
import { pool } from "./db.ts";
import { HttpError } from "./auth.ts";
import { pendingAlertBadgeCount, pushPayload } from "./push-payload.ts";
import { expirePushSubscription, recordNotification } from "./notifications.ts";

export function pushConfigured() {
  return !!(
    process.env.VAPID_PUBLIC_KEY &&
    process.env.VAPID_PRIVATE_KEY &&
    process.env.VAPID_SUBJECT
  );
}

export async function sendTestPush(userId: string, endpoint: string) {
  if (!pushConfigured())
    throw new HttpError(
      503,
      "Notification delivery is not configured on the server.",
    );
  // Only a saved subscription belonging to this account may be used. Never send
  // to a caller-provided subscription or to every device in the household.
  const saved = await pool.query(
    "SELECT id,subscription FROM push_subscriptions WHERE user_id=$1 AND subscription->>'endpoint'=$2",
    [userId, endpoint],
  );
  if (!saved.rowCount)
    throw new HttpError(
      404,
      "Enable notifications on this device for your account first.",
    );
  const device = saved.rows[0];
  const id = `baby-test-${randomUUID()}`;
  try {
    await webpush.sendNotification(
      device.subscription,
      pushPayload({
        title: "Test notification",
        body: "Notifications are working on this device.",
        tag: id,
        url: "/",
        badgeCount: await pendingAlertBadgeCount(userId),
      }),
      {
        TTL: 120,
        timeout: 8000,
        urgency: "normal",
        vapidDetails: {
          subject: process.env.VAPID_SUBJECT!,
          publicKey: process.env.VAPID_PUBLIC_KEY!,
          privateKey: process.env.VAPID_PRIVATE_KEY!,
        },
      },
    );
  } catch (error) {
    if (
      [404, 410].includes((error as { statusCode?: number }).statusCode ?? 0)
    ) {
      await expirePushSubscription(device.id);
      throw new HttpError(
        410,
        "This device’s notification registration expired. Enable notifications again, then retry the test.",
      );
    }
    throw new HttpError(
      502,
      "The notification service could not accept the test. Check your connection and try again shortly.",
    );
  }
  await recordNotification(userId, { key: id, kind: "test", title: "Test notification",
    body: "Push provider accepted this device’s test notification.", url: "/" });
}
