import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fork } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { pool, migrate } from "../src/db.ts";
import { hash, token } from "../src/auth.ts";
import { pushConfigured } from "../src/push-test.ts";
import { recordNotification } from "../src/notifications.ts";

test("push readiness requires all three server settings", () => {
  const names = ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"];
  const previous = names.map((name) => process.env[name]);
  try {
    for (const name of names) process.env[name] = "fixture";
    assert.equal(pushConfigured(), true);
    for (const name of names) {
      delete process.env[name];
      assert.equal(pushConfigured(), false);
      process.env[name] = "fixture";
    }
  } finally {
    names.forEach((name, index) => {
      if (previous[index] === undefined) delete process.env[name];
      else process.env[name] = previous[index];
    });
  }
});

test(
  "device tests enforce account, origin and endpoint ownership, expire only that device and limit sends",
  { skip: process.env.PUSH_DEVICE_TEST !== "1" },
  async () => {
    const users = [randomUUID(), randomUUID()],
      cookies = [token(), token()];
    const families = [randomUUID(), randomUUID()],
      children = [randomUUID(), randomUUID()];
    const endpoints = [
      "current",
      "other-device",
      "expired",
      "busy",
      "other-account",
    ].map((name) => `https://web.push.apple.com/fixture/${name}`);
    const deliveries: {
      endpoint: string;
      payload: {
        title: string;
        tag: string;
        url: string;
        web_push: number;
        notification: { navigate: string; app_badge: string };
      };
      options: { TTL: number; timeout: number };
    }[] = [];
    const reservation = createServer().listen(0, "127.0.0.1");
    await once(reservation, "listening");
    const port = (reservation.address() as { port: number }).port;
    await new Promise<void>((resolve) => reservation.close(() => resolve()));
    const origin = `http://127.0.0.1:${port}`;
    let server: ReturnType<typeof fork> | undefined;
    try {
      await migrate();
      for (let i = 0; i < users.length; i++) {
        await pool.query(
          "INSERT INTO users(id,email,password_hash,name) VALUES($1,$2,'fixture','Push test caregiver')",
          [users[i], `${users[i]}@example.test`],
        );
        await pool.query(
          "INSERT INTO sessions VALUES($1,$2,now()+interval '1 hour')",
          [hash(cookies[i]), users[i]],
        );
      }
      for (let i = 0; i < endpoints.length; i++)
        await pool.query(
          "INSERT INTO push_subscriptions(id,user_id,subscription) VALUES($1,$2,$3)",
          [
            randomUUID(),
            i === 4 ? users[1] : users[0],
            JSON.stringify({
              endpoint: endpoints[i],
              keys: { p256dh: "fixture", auth: "fixture" },
            }),
          ],
        );
      for (let i = 0; i < families.length; i++) {
        await pool.query(
          "INSERT INTO families(id,name) VALUES($1,'Badge fixture')",
          [families[i]],
        );
        await pool.query("INSERT INTO memberships VALUES($1,$2,'owner')", [
          families[i],
          users[i],
        ]);
        await pool.query(
          "INSERT INTO children(id,family_id,name,birth_date) VALUES($1,$2,'Baby','2026-01-01')",
          [children[i], families[i]],
        );
        const reading = await pool.query(
          "INSERT INTO owlet_readings(family_id,child_id,device_serial,measured_at) VALUES($1,$2,'fixture',now()) RETURNING id",
          [families[i], children[i]],
        );
        for (const [kind, repeat, acknowledged] of [
          ["oxygen_below", true, false],
          ["heart_below", true, true],
          ["battery_below", false, false],
        ])
          await pool.query(
            `INSERT INTO owlet_alert_events(family_id,child_id,reading_id,kind,measured_value,threshold_value,measured_at,repeat_until_accepted,acknowledged_at)
            VALUES($1,$2,$3,$4,90,95,now(),$5,CASE WHEN $6 THEN now() ELSE NULL END)`,
            [
              families[i],
              children[i],
              reading.rows[0].id,
              kind,
              repeat,
              acknowledged,
            ],
          );
      }
      server = fork(new URL("../src/server.ts", import.meta.url), [], {
        env: {
          ...process.env,
          PORT: String(port),
          HOST: "127.0.0.1",
          APP_ORIGIN: origin,
          SESSION_SECURE: "false",
          VAPID_PUBLIC_KEY: "fixture",
          VAPID_PRIVATE_KEY: "fixture",
          VAPID_SUBJECT: "mailto:test@example.test",
        },
        execArgv: [
          "--import",
          new URL("fixtures/push-provider.mjs", import.meta.url).href,
        ],
        stdio: ["ignore", "ignore", "ignore", "ipc"],
      });
      server.on("message", (message) =>
        deliveries.push(message as (typeof deliveries)[number]),
      );
      for (let i = 0; i < 150; i++) {
        if (server.exitCode !== null)
          throw Error("Test API exited before becoming ready");
        if (
          await fetch(origin + "/api/health")
            .then((r) => r.ok)
            .catch(() => false)
        )
          break;
        await new Promise((resolve) => setTimeout(resolve, 30));
      }
      const post = (
        path: string,
        endpoint: string,
        cookie = cookies[0],
        requestOrigin = origin,
      ) =>
        fetch(origin + "/api" + path, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: requestOrigin,
            Cookie: `baby_session=${cookie}`,
          },
          body: JSON.stringify({ endpoint }),
        });
      const badge = (cookie = cookies[0]) =>
        fetch(origin + "/api/push/badge", {
          headers: { Cookie: `baby_session=${cookie}` },
        });
      assert.equal((await badge("missing")).status, 401);
      assert.deepEqual(await (await badge()).json(), { count: 1 });
      assert.deepEqual(await (await badge(cookies[1])).json(), { count: 1 });
      await pool.query("INSERT INTO memberships VALUES($1,$2,'caregiver')", [
        families[1],
        users[0],
      ]);
      assert.deepEqual(await (await badge()).json(), { count: 2 });
      await pool.query(
        "DELETE FROM memberships WHERE family_id=$1 AND user_id=$2",
        [families[1], users[0]],
      );
      assert.deepEqual(await (await badge()).json(), { count: 1 });
      assert.equal(
        (await post("/push/test", endpoints[0], "missing")).status,
        401,
      );
      assert.equal(
        (
          await post(
            "/push/test",
            endpoints[0],
            cookies[0],
            "https://untrusted.example",
          )
        ).status,
        403,
      );
      assert.deepEqual(
        await (await post("/push/status", endpoints[0])).json(),
        { registered: true, expired: false },
      );
      assert.deepEqual(
        await (await post("/push/status", endpoints[4])).json(),
        { registered: false, expired: false },
      );
      assert.equal((await post("/push/test", endpoints[4])).status, 404);
      assert.equal(
        (await post("/push/test", "http://127.0.0.1/arbitrary")).status,
        404,
      );
      assert.equal(deliveries.length, 0);
      const accepted = await post("/push/test", endpoints[0]);
      assert.equal(accepted.status, 200);
      assert.deepEqual(await accepted.json(), { accepted: true });
      assert.equal(deliveries.length, 1);
      assert.equal(deliveries[0].endpoint, endpoints[0]);
      assert.equal(deliveries[0].payload.title, "Test notification");
      assert.equal(deliveries[0].payload.url, "/");
      assert.equal(deliveries[0].payload.web_push, 8030);
      assert.equal(deliveries[0].payload.notification.navigate, origin + "/");
      assert.equal(deliveries[0].payload.notification.app_badge, "1");
      const pendingAlert = await pool.query(
        "SELECT id FROM owlet_alert_events WHERE family_id=$1 AND repeat_until_accepted AND acknowledged_at IS NULL",
        [families[0]],
      );
      const request = (path: string, data: unknown, method = "POST") =>
        fetch(origin + "/api" + path, {
          method,
          headers: {
            "Content-Type": "application/json",
            Origin: origin,
            Cookie: `baby_session=${cookies[0]}`,
          },
          body: JSON.stringify(data),
        });
      const history = (family = families[0], cookie = cookies[0]) =>
        fetch(origin + `/api/notifications?family=${family}`, {
          headers: { Cookie: `baby_session=${cookie}` },
        });
      assert.equal((await history(families[0], "missing")).status, 401);
      assert.equal((await history(families[1])).status, 403);
      const deviceId = (
        await pool.query(
          "SELECT id FROM push_subscriptions WHERE user_id=$1 AND subscription->>'endpoint'=$2",
          [users[0], endpoints[0]],
        )
      ).rows[0].id;
      await pool.query(
        "INSERT INTO owlet_alert_deliveries(event_id,subscription_id,last_status,failure_count) VALUES($1,$2,429,2)",
        [pendingAlert.rows[0].id, deviceId],
      );
      await pool.query(
        "INSERT INTO owlet_push_backoff(subscription_id,retry_at) VALUES($1,now()+interval '1 minute')",
        [deviceId],
      );
      const subscription = {
        endpoint: endpoints[0],
        keys: { p256dh: "x".repeat(87), auth: "x".repeat(22) },
      };
      for (let i = 0; i < 2; i++)
        assert.equal((await request("/push", subscription)).status, 201);
      assert.equal(
        (
          await pool.query(
            "SELECT id FROM push_subscriptions WHERE user_id=$1 AND subscription->>'endpoint'=$2",
            [users[0], endpoints[0]],
          )
        ).rows[0].id,
        deviceId,
      );
      assert.equal(
        (
          await pool.query(
            "SELECT failure_count FROM owlet_alert_deliveries WHERE subscription_id=$1",
            [deviceId],
          )
        ).rows[0].failure_count,
        2,
      );
      const deferred = await (await post("/push/status", endpoints[0])).json();
      assert.equal(deferred.lastStatus, 429);
      assert.ok(deferred.retryAt);
      const timer = {
        key: "timer-fixture",
        family: families[0],
        kind: "timer" as const,
        title: "Sleep timer",
        body: "First reminder",
        url: "/",
      };
      await recordNotification(users[0], timer);
      await recordNotification(users[0], {
        ...timer,
        body: "Repeated delivery",
      });
      const before = await (await history()).json();
      assert.equal(
        before.events.filter((event: any) => event.source === "owlet").length,
        3,
      );
      assert.equal(
        before.events.filter((event: any) => event.id === "timer-fixture")
          .length,
        1,
      );
      assert.equal(
        before.events.find((event: any) => event.id === "timer-fixture").body,
        "First reminder",
      );
      assert.equal(
        before.events.find(
          (event: any) => event.alert_id === String(pendingAlert.rows[0].id),
        ).status,
        "active",
      );
      assert.equal(
        (await (await history(families[1], cookies[1])).json()).events.filter(
          (event: any) => event.source === "test" || event.source === "timer",
        ).length,
        0,
      );
      await pool.query(
        "INSERT INTO owlet_alert_settings(family_id,child_id,oxygen_below,updated_by) VALUES($1,$2,92,$3)",
        [families[0], children[0], users[0]],
      );
      assert.equal(
        (
          await pool.query(
            "SELECT repeat_until_accepted FROM owlet_alert_settings WHERE child_id=$1",
            [children[0]],
          )
        ).rows[0].repeat_until_accepted,
        true,
      );
      assert.equal(
        (
          await request("/owlet/repeat", {
            family: families[0],
            childId: children[0],
            enabled: false,
          })
        ).status,
        200,
      );
      assert.equal(
        (
          await pool.query(
            "SELECT oxygen_below FROM owlet_alert_settings WHERE child_id=$1",
            [children[0]],
          )
        ).rows[0].oxygen_below,
        92,
      );
      assert.equal(
        (await (await history()).json()).events.find(
          (event: any) => event.alert_id === String(pendingAlert.rows[0].id),
        ).status,
        "active",
      );
      const accept = await fetch(origin + "/api/owlet/accept-alert", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: origin,
          Cookie: `baby_session=${cookies[0]}`,
        },
        body: JSON.stringify({
          family: families[0],
          eventId: String(pendingAlert.rows[0].id),
        }),
      });
      assert.equal(accept.status, 200);
      assert.equal((await accept.json()).badgeCount, 0);
      assert.deepEqual(await (await badge()).json(), { count: 0 });
      const after = await (await history()).json();
      const eventBefore = before.events.find(
        (event: any) => event.alert_id === String(pendingAlert.rows[0].id),
      );
      const eventAfter = after.events.find(
        (event: any) => event.id === eventBefore.id,
      );
      assert.equal(eventAfter.status, "accepted");
      assert.equal(eventAfter.created_at, eventBefore.created_at);
      assert.ok(eventAfter.acknowledged_at);
      assert.equal(
        after.events.filter((event: any) => event.id === eventBefore.id).length,
        1,
      );

      assert.deepEqual(await (await badge(cookies[1])).json(), { count: 1 });
      assert.equal(deliveries[0].options.TTL, 120);
      assert.equal(deliveries[0].options.timeout, 8000);
      assert.equal((await post("/push/test", endpoints[2])).status, 410);
      assert.deepEqual(
        await (await post("/push/status", endpoints[2])).json(),
        { registered: false, expired: true },
      );
      assert.equal(
        (
          await pool.query(
            "SELECT count(*)::int AS count FROM push_subscriptions WHERE user_id=$1",
            [users[0]],
          )
        ).rows[0].count,
        3,
      );
      assert.equal(
        (await request("/push", { ...subscription, endpoint: endpoints[2] }))
          .status,
        410,
      );
      const busy = await post("/push/test", endpoints[3]);
      assert.equal(busy.status, 502);
      assert.doesNotMatch(
        JSON.stringify(await busy.json()),
        /private provider response/,
      );
      assert.deepEqual(
        await (await post("/push/status", endpoints[3])).json(),
        { registered: true, expired: false },
      );
      // Five authenticated test attempts above; fifteen more reach the limit.
      for (let i = 0; i < 15; i++)
        assert.equal((await post("/push/test", endpoints[0])).status, 200);
      assert.equal((await post("/push/test", endpoints[0])).status, 429);
      assert.equal(deliveries.length, 18);
      assert.equal(
        new Set(deliveries.map((d) => d.payload.tag)).size,
        deliveries.length,
      );
      assert.ok(
        deliveries.every(
          (d) => d.endpoint !== endpoints[1] && d.endpoint !== endpoints[4],
        ),
      );
      // The second account has its own rate limit and can test its own device.
      assert.equal(
        (await post("/push/test", endpoints[4], cookies[1])).status,
        200,
      );
    } finally {
      if (server && server.exitCode === null) {
        server.kill("SIGTERM");
        await once(server, "exit");
      }
      await pool.query(
        "DELETE FROM owlet_alert_events WHERE family_id=ANY($1::uuid[])",
        [families],
      );
      await pool.query(
        "DELETE FROM owlet_readings WHERE family_id=ANY($1::uuid[])",
        [families],
      );
      await pool.query("DELETE FROM children WHERE family_id=ANY($1::uuid[])", [
        families,
      ]);
      await pool.query(
        "DELETE FROM memberships WHERE family_id=ANY($1::uuid[])",
        [families],
      );
      await pool.query("DELETE FROM families WHERE id=ANY($1::uuid[])", [
        families,
      ]);
      await pool.query("DELETE FROM sessions WHERE user_id=ANY($1::uuid[])", [
        users,
      ]);
      await pool.query(
        "DELETE FROM push_subscriptions WHERE user_id=ANY($1::uuid[])",
        [users],
      );
      await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [users]);
      await pool.query("DELETE FROM login_attempts WHERE key=ANY($1::text[])", [
        users.map((id) => hash(`push-test:${id}`)),
      ]);
      await pool.end();
    }
  },
);
