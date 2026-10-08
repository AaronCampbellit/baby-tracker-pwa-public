import { pool } from "./db.ts";
import { owletAlertsAllowedSQL } from "./owlet-charging.ts";

// Count actionable alerts across this caregiver's households, never other families.
export async function pendingAlertBadgeCount(userId: string, db = pool) {
  const result = await db.query(
    `SELECT count(*)::int AS count FROM owlet_alert_events e
     JOIN memberships m ON m.family_id=e.family_id AND m.user_id=$1
     WHERE e.repeat_until_accepted AND e.acknowledged_at IS NULL AND ${owletAlertsAllowedSQL()}`,
    [userId],
  );
  return result.rows[0].count as number;
}

type PushMessage = {
  title: string;
  body: string;
  tag: string;
  url: string;
  alertId?: string;
  badgeCount?: number;
  requireInteraction?: boolean;
  renotify?: boolean;
};

// Keep the legacy fields for already-installed workers during a staged update.
// iOS 18.4+ can display notification directly if worker execution fails/is evicted.
export function pushPayload(
  message: PushMessage,
  origin = process.env.APP_ORIGIN ?? "http://localhost:4174",
) {
  const base = new URL(origin);
  const navigate = new URL(message.url, base);
  if (navigate.origin !== base.origin)
    throw new Error("Push links must stay in the app");
  if (
    message.badgeCount !== undefined &&
    (!Number.isSafeInteger(message.badgeCount) || message.badgeCount < 0)
  )
    throw new Error("Invalid app badge count");
  return JSON.stringify({
    ...message,
    web_push: 8030,
    notification: {
      title: message.title,
      body: message.body,
      tag: message.tag,
      navigate: navigate.href,
      icon: new URL("/icon-192.png", base).href,
      silent: false,
      requireInteraction: message.requireInteraction === true,
      renotify: message.renotify === true,
      data: { url: navigate.href, alertId: message.alertId ?? null },
      ...(message.badgeCount === undefined
        ? {}
        : { app_badge: String(message.badgeCount) }),
    },
  });
}
