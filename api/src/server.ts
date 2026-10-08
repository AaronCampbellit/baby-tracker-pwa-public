import http from "node:http";
import { randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { pool, migrate, transaction } from "./db.ts";
import {
  token,
  hash,
  passwordHash,
  passwordMatches,
  HttpError,
  requireValue,
  text,
  uuid,
} from "./auth.ts";
import { requireRetainedActivityIds, validateSnapshot } from "./validation.ts";
import { owletHistory } from "./owlet-history.ts";
import { pushConfigured, sendTestPush } from "./push-test.ts";
import { owletAlertsAllowedSQL } from "./owlet-charging.ts";
import { pendingAlertBadgeCount } from "./push-payload.ts";
import { notificationHistory } from "./notifications.ts";
import { devicesForConnection, encryptTokens, getOwletDevices, owletConfigured, signInOwlet } from "./owlet.ts";
await migrate();
const origin = process.env.APP_ORIGIN ?? "http://localhost:4174";
const root = resolve(import.meta.dirname, "../../web/dist/pwa");
const quickActionKinds = new Set([
  "Feed", "Diaper", "Sleep", "Nursing", "Pumping", "Solids", "Growth",
  "Medication", "Milestone", "Routine", "Pregnancy", "Postpartum", "Spasm",
]);
function reply(res: http.ServerResponse, status: number, value: unknown) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(JSON.stringify(value));
}
async function body(req: http.IncomingMessage) {
  let data = "";
  for await (const chunk of req) {
    data += chunk;
    if (Buffer.byteLength(data) > 16_000_000)
      throw new HttpError(413, "Request too large");
  }
  try {
    return JSON.parse(data);
  } catch {
    throw new HttpError(400, "Invalid JSON");
  }
}
function cookie(value: string, clear = false) {
  return `baby_session=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${clear ? 0 : 60 * 60 * 24 * 30}${process.env.SESSION_SECURE === "false" ? "" : "; Secure"}`;
}
async function session(req: http.IncomingMessage) {
  const raw = req.headers.cookie
    ?.split(";")
    .map((x) => x.trim())
    .find((x) => x.startsWith("baby_session="))
    ?.slice(13);
  if (!raw) throw new HttpError(401, "Please sign in");
  const q = await pool.query(
    "SELECT u.id,u.email,u.name FROM sessions s JOIN users u ON u.id=s.user_id WHERE token_hash=$1 AND expires_at>now()",
    [hash(raw)],
  );
  if (!q.rowCount) throw new HttpError(401, "Please sign in");
  return q.rows[0];
}
async function membership(user: string, family: string) {
  uuid(family);
  const q = await pool.query(
    "SELECT * FROM memberships WHERE family_id=$1 AND user_id=$2",
    [family, user],
  );
  if (!q.rowCount) throw new HttpError(403, "No access to this household");
  return q.rows[0];
}
async function throttle(key: string) {
  const q = await pool.query(
    "INSERT INTO login_attempts(key,attempts) VALUES($1,1) ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN login_attempts.window_start<now()-interval '15 minutes' THEN 1 ELSE login_attempts.attempts+1 END,window_start=CASE WHEN login_attempts.window_start<now()-interval '15 minutes' THEN now() ELSE login_attempts.window_start END RETURNING attempts",
    [hash(key)],
  );
  if (q.rows[0].attempts > 20)
    throw new HttpError(429, "Too many attempts. Try again in 15 minutes.");
}
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", origin);
    const path = url.pathname;
    const method = req.method ?? "GET";
    if (!["GET", "HEAD"].includes(method)) {
      if (req.headers.origin !== origin)
        throw new HttpError(403, "Untrusted request origin");
      if (!req.headers["content-type"]?.startsWith("application/json"))
        throw new HttpError(415, "JSON required");
    }
    if (path === "/api/health") {
      await pool.query("SELECT 1");
      return reply(res, 200, { status: "ok" });
    }
    if (path === "/api/login" && method === "POST") {
      const b = await body(req);
      const email = text(b.email, 254).trim().toLowerCase();
      const password = text(b.password, 256);
      await throttle(email);
      const q = await pool.query("SELECT * FROM users WHERE email=$1", [email]);
      if (
        !q.rowCount ||
        !(await passwordMatches(password, q.rows[0].password_hash))
      )
        throw new HttpError(401, "Email or password is incorrect");
      const t = token();
      await pool.query(
        "INSERT INTO sessions VALUES($1,$2,now()+interval '30 days')",
        [hash(t), q.rows[0].id],
      );
      res.setHeader("Set-Cookie", cookie(t));
      return reply(res, 200, { ok: true });
    }
    if (path === "/api/activate" && method === "POST") {
      const b = await body(req);
      const email = text(b.email, 254).trim().toLowerCase();
      requireValue(
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),
        "Enter a valid email",
      );
      const password = text(b.password, 256);
      requireValue(
        password.length >= 12,
        "Use at least 12 characters for your password",
      );
      const invite = text(b.invite, 200);
      await throttle(email);
      const name = text(b.name, 80).trim();
      requireValue(name, "Name required");
      const ph = await passwordHash(password);
      const id = randomUUID();
      await transaction(async (c) => {
        const i = await c.query(
          "SELECT * FROM invitations WHERE token_hash=$1 AND expires_at>now() AND used_at IS NULL FOR UPDATE",
          [hash(invite)],
        );
        requireValue(i.rowCount, "Invitation is invalid or expired");
        await c.query(
          "INSERT INTO users(id,email,password_hash,name) VALUES($1,$2,$3,$4)",
          [id, email, ph, name],
        );
        await c.query("INSERT INTO memberships VALUES($1,$2,$3)", [
          i.rows[0].family_id,
          id,
          i.rows[0].role,
        ]);
        await c.query(
          "UPDATE invitations SET used_at=now() WHERE token_hash=$1",
          [hash(invite)],
        );
      });
      const t = token();
      await pool.query(
        "INSERT INTO sessions VALUES($1,$2,now()+interval '30 days')",
        [hash(t), id],
      );
      res.setHeader("Set-Cookie", cookie(t));
      return reply(res, 201, { ok: true });
    }
    if (path === "/api/reset" && method === "POST") {
      const b = await body(req);
      const reset = text(b.reset, 200);
      await throttle(reset);
      const password = text(b.password, 256);
      requireValue(password.length >= 12, "Use at least 12 characters");
      const ph = await passwordHash(password);
      await transaction(async (c) => {
        const q = await c.query(
          "SELECT * FROM password_resets WHERE token_hash=$1 AND expires_at>now() AND used_at IS NULL FOR UPDATE",
          [hash(reset)],
        );
        requireValue(q.rowCount, "Reset link is invalid or expired");
        await c.query("UPDATE users SET password_hash=$1 WHERE id=$2", [
          ph,
          q.rows[0].user_id,
        ]);
        await c.query("DELETE FROM sessions WHERE user_id=$1", [
          q.rows[0].user_id,
        ]);
        await c.query(
          "UPDATE password_resets SET used_at=now() WHERE token_hash=$1",
          [hash(reset)],
        );
      });
      return reply(res, 200, { ok: true });
    }
    if (path.startsWith("/api/")) {
      const user = await session(req);
      if (path === "/api/join" && method === "POST") {
        const b = await body(req);
        await transaction(async (c) => {
          const q = await c.query(
            "SELECT * FROM invitations WHERE token_hash=$1 AND expires_at>now() AND used_at IS NULL FOR UPDATE",
            [hash(text(b.invite, 200))],
          );
          requireValue(q.rowCount, "Invalid invitation");
          await c.query(
            "INSERT INTO memberships VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
            [q.rows[0].family_id, user.id, q.rows[0].role],
          );
          await c.query(
            "UPDATE invitations SET used_at=now() WHERE token_hash=$1",
            [hash(b.invite)],
          );
        });
        return reply(res, 200, { ok: true });
      }
      if (path === "/api/me") {
        const families = await pool.query(
          "SELECT f.id,f.name,m.role FROM families f JOIN memberships m ON m.family_id=f.id WHERE m.user_id=$1",
          [user.id],
        );
        const pref = await pool.query(
          "SELECT interval_minutes FROM reminder_preferences WHERE user_id=$1",
          [user.id],
        );
        const quickActions = await pool.query(
          "SELECT quick_actions FROM users WHERE id=$1",
          [user.id],
        );
        return reply(res, 200, {
          user,
          families: families.rows,
          reminderMinutes: pref.rows[0]?.interval_minutes ?? 1,
          quickActions: quickActions.rows[0]?.quick_actions ?? null,
          pushEnabled: pushConfigured(),
          vapidPublicKey: process.env.VAPID_PUBLIC_KEY ?? "",
        });
      }
      if (path === "/api/logout" && method === "POST") {
        const raw = req.headers.cookie
          ?.split(";")
          .map((x) => x.trim())
          .find((x) => x.startsWith("baby_session="))
          ?.slice(13);
        if (raw)
          await pool.query("DELETE FROM sessions WHERE token_hash=$1", [
            hash(raw),
          ]);
        res.setHeader("Set-Cookie", cookie("", true));
        return reply(res, 200, { ok: true });
      }
      if (path === "/api/preferences" && method === "POST") {
        const b = await body(req);
        requireValue(
          Number.isInteger(b.minutes) && b.minutes >= 0 && b.minutes <= 1440,
          "Invalid interval",
        );
        await pool.query(
          "INSERT INTO reminder_preferences VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET interval_minutes=$2",
          [user.id, b.minutes],
        );
        return reply(res, 200, { ok: true });
      }
      if (path === "/api/quick-actions" && method === "POST") {
        const b = await body(req);
        requireValue(
          Array.isArray(b.actions) &&
            b.actions.length <= quickActionKinds.size &&
            b.actions.every((action: unknown) => quickActionKinds.has(action as string)) &&
            new Set(b.actions).size === b.actions.length,
          "Invalid quick actions",
        );
        await pool.query("UPDATE users SET quick_actions=$1 WHERE id=$2", [
          b.actions,
          user.id,
        ]);
        return reply(res, 200, { ok: true });
      }
      if (path === "/api/notifications" && method === "GET") {
        const family = uuid(url.searchParams.get("family"));
        await membership(user.id, family);
        return reply(res, 200, { events: (await notificationHistory(user.id, family)).rows });
      }
      if (path.startsWith("/api/owlet")) {
        const b = method === "GET" ? null : await body(req);
        const family = uuid(
          method === "GET" ? url.searchParams.get("family") : b.family,
        );
        await membership(user.id, family);
        if (await owletHistory(req, res, url, family)) return;
        if (path === "/api/owlet" && method === "GET") {
          const q = await pool.query(
            `SELECT c.child_id,c.device_serial,c.device_name,c.account_email,c.last_polled_at,c.last_error,c.next_poll_at,c.failure_count,c.last_duration_ms,
              r.measured_at,r.collected_at,r.heart_rate,r.oxygen_percent::float AS oxygen_percent,r.battery_percent::float AS battery_percent,
              r.movement,r.sleep_state,r.sock_connection,r.charging,r.alerts,
              a.created_at AS latest_alert_at,a.kind AS latest_alert_kind
              FROM owlet_connections c
              LEFT JOIN LATERAL (
                SELECT * FROM owlet_readings WHERE family_id=c.family_id AND child_id=c.child_id
                ORDER BY measured_at DESC LIMIT 1
              ) r ON true
              LEFT JOIN LATERAL (
                SELECT created_at,kind FROM owlet_alert_events
                WHERE family_id=c.family_id AND child_id=c.child_id
                ORDER BY created_at DESC LIMIT 1
              ) a ON true WHERE c.family_id=$1 ORDER BY c.created_at`,
            [family],
          );
          return reply(res, 200, { configured: owletConfigured(), connections: q.rows });
        }
        if (path === "/api/owlet/readings" && method === "GET") {
          const child = uuid(url.searchParams.get("child"));
          const before = url.searchParams.get("before");
          if (before && !Number.isFinite(Date.parse(before))) throw new HttpError(400, "Invalid history cursor");
          const q = await pool.query(
            `SELECT measured_at,heart_rate,oxygen_percent,battery_percent,movement,
              sleep_state,sock_connection,charging,alerts,provider_data
              FROM owlet_readings WHERE family_id=$1 AND child_id=$2 ${before ? "AND measured_at<$3" : ""}
              ORDER BY measured_at DESC LIMIT 100`,
            before ? [family, child, before] : [family, child],
          );
          return reply(res, 200, { readings: q.rows, before: q.rows.length === 100 ? q.rows.at(-1).measured_at : null });
        }
        if (path === "/api/owlet/active-alerts" && method === "GET") {
          const pending = await pool.query(`SELECT e.id,e.child_id,c.name AS child_name,e.kind,
            e.measured_value,e.threshold_value,e.measured_at,e.created_at
            FROM owlet_alert_events e JOIN children c ON c.id=e.child_id AND c.family_id=e.family_id
            WHERE e.family_id=$1 AND e.repeat_until_accepted AND e.acknowledged_at IS NULL
              AND ${owletAlertsAllowedSQL()}
            ORDER BY e.created_at`, [family]);
          return reply(res, 200, { events: pending.rows });
        }
        if (path === "/api/owlet/accept-alert" && method === "POST") {
          const eventId = String(b.eventId ?? "");
          requireValue(/^[1-9][0-9]{0,18}$/.test(eventId) && BigInt(eventId)<=9223372036854775807n, "Invalid alert");
          const accepted = await transaction(async client => {
            const result = await client.query(`UPDATE owlet_alert_events SET
              acknowledged_at=COALESCE(acknowledged_at,now()),
              acknowledged_by=CASE WHEN acknowledged_at IS NULL THEN $3 ELSE acknowledged_by END
              WHERE id=$1 AND family_id=$2 AND repeat_until_accepted RETURNING id,acknowledged_at`,
              [eventId,family,user.id]);
            if (!result.rowCount) throw new HttpError(404, "Alert not found in this household");
            await client.query("UPDATE owlet_alert_deliveries SET finished_at=now() WHERE event_id=$1 AND finished_at IS NULL", [eventId]);
            return result.rows[0];
          });
          return reply(res, 200, { ok: true, ...accepted, badgeCount: await pendingAlertBadgeCount(user.id) });
        }
        if (path === "/api/owlet/alerts" && method === "GET") {
          const child = uuid(url.searchParams.get("child"));
          const [settings, events] = await Promise.all([
            pool.query(
              "SELECT oxygen_below,heart_below,heart_above,battery_below,repeat_until_accepted FROM owlet_alert_settings WHERE family_id=$1 AND child_id=$2",
              [family, child],
            ),
            pool.query(
              "SELECT id,kind,measured_value,threshold_value,measured_at,created_at,repeat_until_accepted,acknowledged_at,acknowledged_by FROM owlet_alert_events WHERE family_id=$1 AND child_id=$2 ORDER BY created_at DESC LIMIT 50",
              [family, child],
            ),
          ]);
          return reply(res, 200, { settings: settings.rows[0] ?? null, events: events.rows });
        }
        if (path === "/api/owlet/repeat" && method === "POST") {
          const child = uuid(b.childId);
          requireValue(typeof b.enabled === "boolean", "Invalid repeat option");
          const updated = await pool.query(`UPDATE owlet_alert_settings SET repeat_until_accepted=$3,updated_by=$4
            WHERE family_id=$1 AND child_id=$2 AND ($3=false OR
              oxygen_below IS NOT NULL OR heart_below IS NOT NULL OR heart_above IS NOT NULL OR battery_below IS NOT NULL)
            RETURNING child_id`, [family,child,b.enabled,user.id]);
          requireValue(updated.rowCount, "Set and save at least one Owlet alert level first.");
          return reply(res, 200, { ok: true });
        }
        if (path === "/api/owlet/alerts" && method === "POST") {
          const child = uuid(b.childId);
          const linkedChild = await pool.query("SELECT 1 FROM children WHERE id=$1 AND family_id=$2", [child, family]);
          requireValue(linkedChild.rowCount, "Choose a child in this household");
          const values = [b.oxygenBelow, b.heartBelow, b.heartAbove, b.batteryBelow];
          requireValue(b.repeatUntilAccepted === undefined || typeof b.repeatUntilAccepted === "boolean", "Invalid repeat option");
          requireValue(b.repeatUntilAccepted !== true || values.some(value => value !== null), "Set at least one alert level before enabling repeats");
          requireValue(
            values.every((v: unknown, i: number) => v === null ||
              (Number.isInteger(v) && (v as number) >= 1 && (v as number) <= (i === 0 || i === 3 ? 100 : 300))),
            "Enter valid alert thresholds or leave them off",
          );
          requireValue(
            b.heartBelow === null || b.heartAbove === null || b.heartBelow < b.heartAbove,
            "The low heart rate must be below the high heart rate",
          );
          await pool.query(
            `INSERT INTO owlet_alert_settings
              (family_id,child_id,oxygen_below,heart_below,heart_above,battery_below,updated_by,repeat_until_accepted)
             VALUES($1,$2,$3,$4,$5,$6,$7,COALESCE($8,true))
             ON CONFLICT(family_id,child_id) DO UPDATE SET
               oxygen_below=$3,heart_below=$4,heart_above=$5,battery_below=$6,
               enabled_at=now(),updated_by=$7,repeat_until_accepted=COALESCE($8,owlet_alert_settings.repeat_until_accepted)`,
            [family, child, ...values, user.id,b.repeatUntilAccepted ?? null],
          );
          return reply(res, 200, { ok: true });
        }
        if (!owletConfigured()) throw new HttpError(503, "Owlet integration is not configured");
        const child = uuid(b.childId);
        const linkedChild = await pool.query(
          "SELECT 1 FROM children WHERE id=$1 AND family_id=$2",
          [child, family],
        );
        requireValue(linkedChild.rowCount, "Choose a child in this household");
        if (path === "/api/owlet/connect" && method === "POST") {
          const email = text(b.email, 254).trim().toLowerCase();
          const password = text(b.password, 256);
          requireValue(email && password, "Enter your Owlet email and password");
          const duplicateAccount = await pool.query(
            "SELECT 1 FROM owlet_connections WHERE family_id=$1 AND account_email=$2 AND child_id<>$3",
            [family, email, child],
          );
          if (duplicateAccount.rowCount)
            throw new HttpError(409, "This Owlet account is already linked to another child here");
          let tokens, devices;
          try {
            tokens = await signInOwlet(email, password);
            devices = await getOwletDevices(tokens);
          } catch (error) {
            throw new HttpError(502, error instanceof Error ? error.message : "Owlet connection failed");
          }
          requireValue(devices.length > 0, "No Owlet devices were found for this account");
          const device = devices.find((d) => /sock|ss3|dream/i.test(d.name + " " + d.model)) ?? devices[0];
          await pool.query(
            `INSERT INTO owlet_connections
              (id,family_id,child_id,connected_by,account_email,device_serial,device_name,encrypted_tokens)
              VALUES($1,$2,$3,$4,$5,$6,$7,$8)
              ON CONFLICT(family_id,child_id) DO UPDATE SET
                connected_by=$4,account_email=$5,device_serial=$6,device_name=$7,
                encrypted_tokens=$8,next_poll_at=now(),last_error=NULL`,
            [randomUUID(), family, child, user.id, email, device.serial, device.name, encryptTokens(tokens)],
          );
          return reply(res, 200, { device, devices });
        }
        const connection = await pool.query(
          "SELECT * FROM owlet_connections WHERE family_id=$1 AND child_id=$2",
          [family, child],
        );
        if (!connection.rowCount) throw new HttpError(404, "Owlet is not linked to this child");
        if (path === "/api/owlet/devices" && method === "POST") {
          try {
            return reply(res, 200, { devices: await devicesForConnection(connection.rows[0]) });
          } catch (error) {
            throw new HttpError(502, error instanceof Error ? error.message : "Could not list Owlet devices");
          }
        }
        if (path === "/api/owlet/device" && method === "POST") {
          let devices;
          try { devices = await devicesForConnection(connection.rows[0]); }
          catch (error) {
            throw new HttpError(502, error instanceof Error ? error.message : "Could not list Owlet devices");
          }
          const device = devices.find((item) => item.serial === b.serial);
          requireValue(device, "Choose an Owlet device from this account");
          await pool.query(
            "UPDATE owlet_connections SET device_serial=$1,device_name=$2,next_poll_at=now(),last_error=NULL WHERE id=$3",
            [device.serial, device.name, connection.rows[0].id],
          );
          return reply(res, 200, { device });
        }
        if (path === "/api/owlet/refresh" && method === "POST") {
          await pool.query(
            "UPDATE owlet_connections SET next_poll_at=least(next_poll_at,now()) WHERE id=$1 AND failure_count=0 AND (last_polled_at IS NULL OR last_polled_at<now()-interval '5 seconds')",
            [connection.rows[0].id],
          );
          return reply(res, 200, { ok: true });
        }
        if (path === "/api/owlet/disconnect" && method === "POST") {
          await pool.query("DELETE FROM owlet_connections WHERE id=$1", [connection.rows[0].id]);
          return reply(res, 200, { ok: true });
        }
        throw new HttpError(404, "Not found");
      }
      if (path === "/api/push/badge" && method === "GET") {
        return reply(res, 200, { count: await pendingAlertBadgeCount(user.id) });
      }
      if (path === "/api/push/status" && method === "POST") {
        const b = await body(req);
        const saved = await pool.query(
          `SELECT p.id,b.retry_at,d.last_status,d.failure_count FROM push_subscriptions p
           LEFT JOIN owlet_push_backoff b ON b.subscription_id=p.id
           LEFT JOIN LATERAL (SELECT last_status,failure_count FROM owlet_alert_deliveries
             WHERE subscription_id=p.id AND finished_at IS NULL ORDER BY last_attempt_at DESC NULLS LAST LIMIT 1) d ON true
           WHERE p.user_id=$1 AND p.subscription->>'endpoint'=$2 LIMIT 1`,
          [user.id, text(b.endpoint, 2048)],
        );
        const expired = await pool.query("SELECT 1 FROM push_expired_endpoints WHERE user_id=$1 AND endpoint_hash=md5($2)", [user.id,text(b.endpoint,2048)]);
        return reply(res, 200, { registered: !!saved.rowCount, expired: !!expired.rowCount,
          ...(saved.rows[0]?.last_status >= 400 || saved.rows[0]?.failure_count > 0
            ? { retryAt: saved.rows[0].retry_at, lastStatus: saved.rows[0].last_status } : {}) });
      }
      if (path === "/api/push/test" && method === "POST") {
        const b = await body(req);
        const endpoint = text(b.endpoint, 2048);
        await throttle(`push-test:${user.id}`);
        await sendTestPush(user.id, endpoint);
        return reply(res, 200, { accepted: true });
      }
      if (path === "/api/push" && method === "DELETE") {
        const b = await body(req);
        await pool.query("DELETE FROM push_subscriptions WHERE user_id=$1 AND subscription->>'endpoint'=$2", [user.id,text(b.endpoint,2048)]);
        return reply(res, 200, { ok: true });
      }
      if (path === "/api/push" && method === "POST") {
        const b = await body(req);
        requireValue(
          pushConfigured(),
          "Push delivery is not configured",
        );
        const endpoint = new URL(text(b.endpoint, 2048));
        requireValue(
          endpoint.protocol === "https:" &&
            (endpoint.hostname.endsWith(".push.apple.com") ||
              endpoint.hostname === "fcm.googleapis.com" ||
              endpoint.hostname === "updates.push.services.mozilla.com") &&
            !endpoint.port &&
            !endpoint.username &&
            !endpoint.password,
          "Unsupported push provider",
        );
        requireValue(
          /^[A-Za-z0-9_-]{80,150}$/.test(b.keys?.p256dh) &&
            /^[A-Za-z0-9_-]{16,64}$/.test(b.keys?.auth),
          "Invalid push keys",
        );
        if ((await pool.query("SELECT 1 FROM push_expired_endpoints WHERE user_id=$1 AND endpoint_hash=md5($2)", [user.id,endpoint.href])).rowCount)
          throw new HttpError(410, "This notification subscription expired. Renew it on this device.");
        await pool.query(
          `INSERT INTO push_subscriptions(id,user_id,subscription) VALUES($1,$2,$3)
           ON CONFLICT(user_id,(subscription->>'endpoint')) DO UPDATE SET subscription=EXCLUDED.subscription`,
          [randomUUID(), user.id, JSON.stringify({ ...b, endpoint: endpoint.href })],
        );
        return reply(res, 201, { ok: true });
      }
      const match = path.match(/^\/api\/families\/([^/]+)(?:\/(.*))?$/);
      if (!match) throw new HttpError(404, "Not found");
      const family = match[1],
        action = match[2] ?? "";
      const member = await membership(user.id, family);
      if (action === "" && method === "GET") {
        const q = await pool.query(
          "SELECT id,name,revision,snapshot FROM families WHERE id=$1",
          [family],
        );
        const members = await pool.query(
          "SELECT u.id,u.name,m.role FROM users u JOIN memberships m ON m.user_id=u.id WHERE m.family_id=$1",
          [family],
        );
        return reply(res, 200, { ...q.rows[0], members: members.rows });
      }
      if (action === "remove-member" && method === "POST") {
        if (member.role !== "owner")
          throw new HttpError(403, "Owner access required");
        const b = await body(req);
        const target = uuid(b.userId);
        requireValue(target !== user.id, "Cannot remove yourself");
        await transaction(async (c) => {
          await c.query(
            "DELETE FROM memberships WHERE family_id=$1 AND user_id=$2 AND role='caregiver'",
            [family, target],
          );
          await c.query(
            "DELETE FROM reminder_jobs WHERE user_id=$1 AND activity_id IN (SELECT id FROM activities WHERE family_id=$2)",
            [target, family],
          );
        });
        return reply(res, 200, { ok: true });
      }
      if (action === "invite" && method === "POST") {
        requireValue(
          member.role === "owner",
          "Only the household owner can invite caregivers",
        );
        const t = token();
        await pool.query(
          "INSERT INTO invitations VALUES($1,$2,'caregiver',now()+interval '7 days',NULL)",
          [hash(t), family],
        );
        return reply(res, 201, {
          invite: t,
          url: `${origin}/?invite=${t}`,
          expiresDays: 7,
        });
      }
      if (action === "sync" && method === "POST") {
        const b = await body(req);
        const op = uuid(b.operationId);
        requireValue(
          Number.isInteger(b.revision) && b.revision >= 0,
          "Invalid revision",
        );
        const snapshot = validateSnapshot(b.snapshot);
        const result = await transaction(async (c) => {
          const q = await c.query(
            "SELECT revision,snapshot FROM families WHERE id=$1 FOR UPDATE",
            [family],
          );
          const old = q.rows[0];
          const replay = await c.query(
            "SELECT revision FROM sync_operations WHERE family_id=$1 AND operation_id=$2",
            [family, op],
          );
          if (replay.rowCount) {
            if (replay.rows[0].revision !== old.revision)
              throw new HttpError(
                409,
                "Household changed after your last sync. Review before continuing.",
              );
            return { revision: old.revision, snapshot: old.snapshot };
          }
          if (old.revision !== b.revision)
            throw new HttpError(
              409,
              "Another caregiver changed the records. Review both versions before syncing.",
            );
          requireRetainedActivityIds(old.snapshot.activities, snapshot.activities);
          const members = await c.query(
            "SELECT user_id FROM memberships WHERE family_id=$1",
            [family],
          );
          const adultIds = new Set(members.rows.map((m: any) => m.user_id));
          for (const a of snapshot.activities)
            if (a.adultId)
              requireValue(
                adultIds.has(a.adultId),
                "Parent must belong to household",
              );
          const previous = new Map(
            old.snapshot.activities.map((a: any) => [a.id, a]),
          );
          for (const a of snapshot.activities) {
            const prior: any = previous.get(a.id);
            if (prior) {
              requireValue(
                a.kind === prior.kind &&
                  a.childId === prior.childId &&
                  a.adultId === prior.adultId,
                "Record subject and kind cannot change",
              );
              a.author = prior.author;
              a.authorId = prior.authorId;
            } else {
              a.author = user.name;
              a.authorId = user.id;
            }
          }
          const next = old.revision + 1;
          await c.query(
            "UPDATE families SET snapshot=$2,revision=$3 WHERE id=$1",
            [family, JSON.stringify(snapshot), next],
          );
          await c.query("INSERT INTO sync_operations VALUES($1,$2,$3)", [
            family,
            op,
            next,
          ]);
          // Relational projection is maintained in the same transaction for durable reminders.
          for (const child of snapshot.children)
            await c.query(
              "INSERT INTO children(id,family_id,name,birth_date,sex) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO UPDATE SET name=$3,birth_date=$4,sex=$5 WHERE children.family_id=$2",
              [child.id, family, child.name, child.birthDate, child.sex],
            );
          for (const a of snapshot.activities) {
            const collision = await c.query(
              "SELECT family_id FROM activities WHERE id=$1",
              [a.id],
            );
            requireValue(
              !collision.rowCount || collision.rows[0].family_id === family,
              "Record identifier already used",
            );
            await c.query(
              "INSERT INTO activities(id,family_id,child_id,adult_id,kind,start_at,end_at,details,author_id,deleted_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(id) DO UPDATE SET start_at=$6,end_at=$7,details=$8,deleted_at=$10,version=activities.version+1,updated_at=now()",
              [
                a.id,
                family,
                a.childId ?? null,
                a.adultId ?? null,
                a.kind,
                new Date(a.start),
                a.end ? new Date(a.end) : null,
                JSON.stringify(a),
                a.authorId,
                a.deleted ? new Date() : null,
              ],
            );
            if ((a.kind === "Sleep" || a.timer) && !a.end && !a.deleted)
              await c.query(
                "INSERT INTO reminder_jobs(id,activity_id,user_id,next_at) VALUES($1,$2,$3,now()+(coalesce((SELECT nullif(interval_minutes,0) FROM reminder_preferences WHERE user_id=$3),1)*interval '1 minute')) ON CONFLICT(activity_id,user_id) DO NOTHING",
                [randomUUID(), a.id, a.authorId],
              );
            else
              await c.query("DELETE FROM reminder_jobs WHERE activity_id=$1", [
                a.id,
              ]);
          }
          return { revision: next, snapshot };
        });
        return reply(res, 200, result);
      }
      throw new HttpError(404, "Not found");
    }
    if (method !== "GET" && method !== "HEAD")
      throw new HttpError(405, "Method not allowed");
    let file = resolve(root, "." + decodeURIComponent(path));
    if (!file.startsWith(root + "/") && file !== root)
      throw new HttpError(404, "Not found");
    try {
      if (!(await stat(file)).isFile()) file = resolve(root, "index.html");
    } catch {
      file = resolve(root, "index.html");
    }
    const data = await readFile(file);
    const types: Record<string, string> = {
      ".html": "text/html",
      ".js": "application/javascript",
      ".css": "text/css",
      ".json": "application/json",
      ".webmanifest": "application/manifest+json",
      ".png": "image/png",
      ".svg": "image/svg+xml",
      ".woff2": "font/woff2",
    };
    res.writeHead(200, {
      "Content-Type": types[extname(file)] ?? "application/octet-stream",
      "Cache-Control":
        file.endsWith("sw.js") || file.endsWith(".html")
          ? "no-cache"
          : "public, max-age=3600",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    });
    res.end(method === "HEAD" ? undefined : data);
  } catch (e: any) {
    if (res.headersSent) { res.destroy(); return; }
    if (e.code === "23505")
      return reply(res, 409, {
        error: "This account or active timer already exists.",
      });
    reply(res, e.status ?? 500, {
      error: e.status ? e.message : "Service temporarily unavailable",
    });
    if (!e.status) console.error("Request failed:", e.code ?? e.name);
  }
});
server.listen(
  Number(process.env.PORT ?? 3001),
  process.env.HOST ?? "127.0.0.1",
  () => console.log("Baby API ready"),
);
process.on("SIGTERM", () => server.close(() => pool.end()));
