import webpush from "web-push";
import { pool, transaction } from "./db.ts";
import { owletAlertsAllowedSQL } from "./owlet-charging.ts";
import { pendingAlertBadgeCount, pushPayload } from "./push-payload.ts";
import { expirePushSubscription } from "./notifications.ts";

function retryDelay(error: any, failures: number) {
  const raw = error.headers?.["retry-after"];
  const seconds = raw === undefined ? NaN : Number(raw);
  const until = typeof raw === "string" ? Date.parse(raw) : NaN;
  return Math.max(
    1000,
    Math.min(60000, 1000 * 2 ** Math.min(failures, 6)),
    Number.isFinite(seconds)
      ? seconds * 1000
      : Number.isFinite(until)
        ? until - Date.now()
        : 0,
  );
}

// Delivery has its own durable schedule so collection/log downloads cannot delay it.
// A phone's push service still decides when (and whether) to show each notification.
export async function deliverOwletPushes() {
  if (!(
    process.env.VAPID_PUBLIC_KEY &&
    process.env.VAPID_PRIVATE_KEY &&
    process.env.VAPID_SUBJECT
  ))
    return;
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT,
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY,
  );
  await pool.query(`INSERT INTO owlet_alert_deliveries(event_id,subscription_id)
    SELECT e.id,p.id FROM owlet_alert_events e
    JOIN memberships m ON m.family_id=e.family_id
    JOIN push_subscriptions p ON p.user_id=m.user_id
    WHERE ((e.repeat_until_accepted AND e.acknowledged_at IS NULL)
      OR (NOT e.repeat_until_accepted AND e.push_attempted_at IS NULL AND e.created_at>now()-interval '2 minutes'))
      AND ${owletAlertsAllowedSQL()}
    ON CONFLICT DO NOTHING`);
  await pool.query(`UPDATE owlet_alert_events e SET push_attempted_at=now()
    WHERE NOT repeat_until_accepted AND push_attempted_at IS NULL AND ${owletAlertsAllowedSQL()}`);
  await pool.query(`UPDATE owlet_alert_deliveries d SET finished_at=now()
    FROM owlet_alert_events e WHERE e.id=d.event_id AND d.finished_at IS NULL
      AND (e.acknowledged_at IS NOT NULL OR (NOT e.repeat_until_accepted AND e.created_at<=now()-interval '2 minutes'))`);
  const due = await pool.query(`WITH due AS (
    SELECT d.event_id,d.subscription_id,p.subscription,c.name AS child_name,e.family_id,e.child_id,
      e.kind,e.measured_value,e.threshold_value,e.measured_at,e.repeat_until_accepted
    FROM owlet_alert_deliveries d
    JOIN owlet_alert_events e ON e.id=d.event_id
    JOIN push_subscriptions p ON p.id=d.subscription_id
    JOIN memberships m ON m.user_id=p.user_id AND m.family_id=e.family_id
    JOIN children c ON c.id=e.child_id AND c.family_id=e.family_id
    LEFT JOIN owlet_push_backoff b ON b.subscription_id=p.id
    WHERE d.finished_at IS NULL AND d.next_attempt_at<=now() AND e.acknowledged_at IS NULL
      AND ${owletAlertsAllowedSQL()}
      AND (b.retry_at IS NULL OR b.retry_at<=now())
      AND NOT EXISTS (
        SELECT 1 FROM owlet_alert_deliveries earlier
        JOIN owlet_alert_events ee ON ee.id=earlier.event_id
        JOIN memberships em ON em.user_id=p.user_id AND em.family_id=ee.family_id
        WHERE earlier.subscription_id=d.subscription_id AND earlier.finished_at IS NULL
          AND earlier.next_attempt_at<=now() AND ee.acknowledged_at IS NULL
          AND ${owletAlertsAllowedSQL("ee")}
          AND (earlier.next_attempt_at,earlier.event_id)<(d.next_attempt_at,d.event_id)
      )
    ORDER BY d.next_attempt_at,d.event_id LIMIT 40 FOR UPDATE OF d SKIP LOCKED
  ), claimed AS (UPDATE owlet_alert_deliveries d SET next_attempt_at=now()+interval '30 seconds',last_attempt_at=now()
    FROM due WHERE d.event_id=due.event_id AND d.subscription_id=due.subscription_id
    RETURNING d.*,due.subscription,due.child_name,due.family_id,due.child_id,due.kind,
      due.measured_value,due.threshold_value,due.measured_at,due.repeat_until_accepted),
    reserved AS (INSERT INTO owlet_push_backoff(subscription_id,retry_at)
      SELECT subscription_id,last_attempt_at+interval '1 second' FROM claimed WHERE true
      ON CONFLICT(subscription_id) DO UPDATE SET retry_at=GREATEST(owlet_push_backoff.retry_at,EXCLUDED.retry_at)
      RETURNING subscription_id)
    SELECT claimed.* FROM claimed JOIN reserved USING(subscription_id)`);
  const deliveries = await Promise.allSettled(
    due.rows.map(async (event) => {
      try {
        const response = await transaction(async (db) => {
          // Hold the event's shared lock through the bounded send. Accept's UPDATE
          // waits for in-flight sends, and a worker waiting on Accept rechecks the
          // committed acknowledgement before it can send another push.
          const active = await db.query(
            `SELECT p.user_id FROM owlet_alert_events e
      JOIN push_subscriptions p ON p.id=$2
      JOIN memberships m ON m.user_id=p.user_id AND m.family_id=e.family_id
      WHERE e.id=$1 AND e.acknowledged_at IS NULL AND ${owletAlertsAllowedSQL()}
      FOR SHARE OF e`,
            [event.event_id, event.subscription_id],
          );
          if (!active.rowCount) return null;
          const metric =
            event.kind === "oxygen_below"
              ? "Oxygen"
              : event.kind === "battery_below"
                ? "Sock battery"
                : "Heart rate";
          const unit = event.kind.startsWith("heart_") ? "bpm" : "%";
          const direction = event.kind.endsWith("below") ? "below" : "above";
          const repeat = event.repeat_until_accepted;
          const payload = pushPayload({
            title: `${event.child_name}: Owlet threshold alert${repeat ? " · Accept in app" : ""}`,
            body: `${metric} ${event.measured_value}${unit} was ${direction} your ${event.threshold_value}${unit} setting. Measured ${new Date(event.measured_at).toISOString()}.${repeat ? " Open the app and tap Accept to stop repeats." : ""}`,
            tag: `owlet-event-${event.event_id}`,
            requireInteraction: repeat,
            renotify: repeat,
            alertId: String(event.event_id),
            url: `/?family=${event.family_id}&child=${event.child_id}&owletAlert=${event.event_id}`,
            badgeCount: await pendingAlertBadgeCount(
              active.rows[0].user_id,
              db,
            ),
          });
          return webpush.sendNotification(event.subscription, payload, {
            // Repeats are retried by our durable schedule, so an unavailable
            // phone must not accumulate pushes to replay after acceptance.
            TTL: repeat ? 0 : 120,
            topic: `owlet-event-${event.event_id}`,
            timeout: 1000,
            urgency: "high",
          });
        });
        if (!response) {
          // Charging after a claim must not leave a 30-second resume lease.
          await pool.query(
            `UPDATE owlet_alert_deliveries SET next_attempt_at=now()+interval '1 second'
            WHERE event_id=$1 AND subscription_id=$2 AND finished_at IS NULL`,
            [event.event_id, event.subscription_id],
          );
          return;
        }
        await pool.query(
          `UPDATE owlet_alert_deliveries SET delivered_at=now(),failure_count=0,last_status=$4,
        next_attempt_at=GREATEST(last_attempt_at+interval '1 second',now()),finished_at=CASE WHEN $3 THEN finished_at ELSE now() END
        WHERE event_id=$1 AND subscription_id=$2`,
          [
            event.event_id,
            event.subscription_id,
            event.repeat_until_accepted,
            response.statusCode,
          ],
        );
      } catch (error: any) {
        if (error.statusCode === 404 || error.statusCode === 410) {
          await expirePushSubscription(event.subscription_id);
        } else {
          const delay = retryDelay(error, event.failure_count + 1);
          await pool.query(
            `INSERT INTO owlet_push_backoff(subscription_id,retry_at)
          VALUES($1,now()+($2::double precision*interval '1 millisecond'))
          ON CONFLICT(subscription_id) DO UPDATE SET retry_at=GREATEST(owlet_push_backoff.retry_at,EXCLUDED.retry_at)`,
            [event.subscription_id, delay],
          );
          await pool.query(
            `UPDATE owlet_alert_deliveries SET failure_count=failure_count+1,last_status=$3,
          next_attempt_at=now()+($4::double precision*interval '1 millisecond') WHERE event_id=$1 AND subscription_id=$2 AND finished_at IS NULL`,
            [
              event.event_id,
              event.subscription_id,
              error.statusCode ?? null,
              delay,
            ],
          );
          console.error(
            "Owlet push delivery deferred",
            error.statusCode ?? "network",
          );
        }
      }
    }),
  );
  for (const result of deliveries)
    if (result.status === "rejected") throw result.reason;
}
