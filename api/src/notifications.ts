import { pool, transaction } from "./db.ts";
import { owletAlertsAllowedSQL } from "./owlet-charging.ts";

export async function expirePushSubscription(subscriptionId: string) {
  await transaction(async (db) => {
    await db.query(
      `INSERT INTO push_expired_endpoints(user_id,endpoint_hash)
      SELECT user_id,md5(subscription->>'endpoint') FROM push_subscriptions WHERE id=$1
      ON CONFLICT(user_id,endpoint_hash) DO UPDATE SET expired_at=now()`,
      [subscriptionId],
    );
    await db.query("DELETE FROM push_subscriptions WHERE id=$1", [
      subscriptionId,
    ]);
  });
}

export async function recordNotification(
  userId: string,
  event: {
    key: string;
    family?: string;
    kind: "timer" | "test";
    title: string;
    body: string;
    url: string;
  },
  db = pool,
) {
  // Timer repeats reuse their original record; delivery attempts are not history.
  await db.query(
    `INSERT INTO notification_history(user_id,event_key,family_id,kind,title,body,url)
    VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(user_id,event_key) DO NOTHING`,
    [
      userId,
      event.key,
      event.family ?? null,
      event.kind,
      event.title,
      event.body,
      event.url,
    ],
  );
}

export async function notificationHistory(userId: string, family: string) {
  return pool.query(
    `SELECT * FROM (
    SELECT 'owlet-'||e.id AS id,'owlet' AS source,e.id::text AS alert_id,
      e.child_id,c.name AS child_name,e.kind,e.measured_value,e.threshold_value,
      e.measured_at,e.created_at,e.acknowledged_at,e.repeat_until_accepted,
      CASE WHEN e.acknowledged_at IS NOT NULL THEN 'accepted'
        WHEN e.repeat_until_accepted THEN CASE WHEN ${owletAlertsAllowedSQL()} THEN 'active' ELSE 'paused' END
        ELSE 'sent' END AS status,
      NULL::text AS title,NULL::text AS body,
      '/?family='||e.family_id||'&child='||e.child_id||'&owletAlert='||e.id AS url
    FROM owlet_alert_events e JOIN children c ON c.id=e.child_id AND c.family_id=e.family_id
    WHERE e.family_id=$2
    UNION ALL
    SELECT h.event_key,h.kind,NULL::text,NULL::uuid,NULL::text,h.kind,
      NULL::numeric,NULL::integer,NULL::timestamptz,h.created_at,NULL::timestamptz,false,
      'sent',h.title,h.body,h.url
    FROM notification_history h WHERE h.user_id=$1 AND (h.family_id=$2 OR h.family_id IS NULL)
  ) history ORDER BY (status IN ('active','paused')) DESC,created_at DESC,id DESC LIMIT 100`,
    [userId, family],
  );
}
