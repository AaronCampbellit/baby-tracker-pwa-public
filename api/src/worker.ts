import webpush from "web-push";
import { pool, migrate, transaction } from "./db.ts";
import { pendingAlertBadgeCount, pushPayload } from "./push-payload.ts";
import { expirePushSubscription, recordNotification } from "./notifications.ts";
await migrate();
const enabled = !!(
  process.env.VAPID_PUBLIC_KEY &&
  process.env.VAPID_PRIVATE_KEY &&
  process.env.VAPID_SUBJECT
);
if (enabled)
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT!,
    process.env.VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!,
  );
let stopped = false;
process.on("SIGTERM", () => {
  stopped = true;
});
while (!stopped) {
  if (enabled) {
    try {
      await transaction(async (c) => {
        const job = await c.query(
          "SELECT j.*,a.family_id FROM reminder_jobs j JOIN activities a ON a.id=j.activity_id WHERE j.next_at<=now() ORDER BY j.next_at LIMIT 1 FOR UPDATE OF j SKIP LOCKED",
        );
        if (!job.rowCount) return;
        const j = job.rows[0];
        const q = await c.query(
          "SELECT a.*,coalesce(p.interval_minutes,1) AS minutes FROM activities a JOIN memberships m ON m.family_id=a.family_id AND m.user_id=$2 LEFT JOIN reminder_preferences p ON p.user_id=$2 WHERE a.id=$1",
          [j.activity_id, j.user_id],
        );
        const a = q.rows[0];
        if (!a || a.end_at || a.deleted_at) {
          await c.query("DELETE FROM reminder_jobs WHERE id=$1", [j.id]);
          return;
        }
        if (a.minutes === 0) {
          await c.query(
            "UPDATE reminder_jobs SET next_at=now()+interval '1 minute' WHERE id=$1",
            [j.id],
          );
          return;
        }
        const subs = await c.query(
          "SELECT * FROM push_subscriptions WHERE user_id=$1",
          [j.user_id],
        );
        const message = {
          title: `Your ${a.kind.toLowerCase()} timer is running`,
          body: `Started ${new Date(a.start_at).toLocaleTimeString("en-US", { timeZone: "UTC", hour: "2-digit", minute: "2-digit" })} UTC. Tap to review or stop.`,
          tag: `timer-${a.id}`,
          url: `/?family=${a.family_id}&timer=${a.id}`,
          badgeCount: await pendingAlertBadgeCount(j.user_id, c),
        };
        const payload = pushPayload(message);
        let delivered = false;
        for (const sub of subs.rows) {
          try {
            await webpush.sendNotification(sub.subscription, payload, {
              TTL: 45,
              timeout: 10000,
              urgency: "normal",
            });
            delivered = true;
          } catch (e: any) {
            if (e.statusCode === 404 || e.statusCode === 410)
              await expirePushSubscription(sub.id);
            else
              console.error("Push delivery failed", e.statusCode ?? "network");
          }
        }
        if (delivered) await recordNotification(j.user_id, { key: `timer-${a.id}`, family: a.family_id,
          kind: "timer", title: message.title, body: message.body, url: message.url }, c);
        await c.query(
          "UPDATE reminder_jobs SET next_at=now()+($2 * interval '1 minute'),attempts=attempts+1 WHERE id=$1",
          [j.id, a.minutes],
        );
      });
    } catch (e: any) {
      console.error("Reminder iteration failed", e.code ?? e.name);
    }
  }
  await new Promise((r) => setTimeout(r, 5000));
}
await pool.end();
