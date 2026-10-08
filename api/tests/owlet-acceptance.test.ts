import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import webpush from "web-push";
import { pool, migrate } from "../src/db.ts";
import { hash, token } from "../src/auth.ts";
import { deliverOwletPushes } from "../src/owlet-alerts.ts";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test(
  "acceptance stops household delivery queues and synchronizes with in-flight sends",
  {
    skip: process.env.OWLET_ACCEPTANCE_TEST !== "1",
  },
  async (t) => {
    const database = new URL(process.env.DATABASE_URL!);
    assert.ok(
      ["127.0.0.1", "localhost"].includes(database.hostname) &&
        database.pathname.startsWith("/acceptance_"),
      "Use an isolated local acceptance_* database.",
    );
    const family = randomUUID(),
      child = randomUUID();
    const users = [randomUUID(), randomUUID()],
      cookies = [token(), token()];
    const subscriptions = [randomUUID(), randomUUID()];
    const keys = webpush.generateVAPIDKeys();
    process.env.VAPID_PUBLIC_KEY = keys.publicKey;
    process.env.VAPID_PRIVATE_KEY = keys.privateKey;
    process.env.VAPID_SUBJECT = "mailto:acceptance@example.test";
    const sends: { payload: any; options: any }[] = [];
    let onSend: (() => Promise<void>) | undefined;
    t.mock.method(
      webpush,
      "sendNotification",
      async (_subscription: any, payload: string, options: any) => {
        sends.push({ payload: JSON.parse(payload), options });
        await onSend?.();
        return { statusCode: 201 };
      },
    );
    const reservation = createServer().listen(0, "127.0.0.1");
    await once(reservation, "listening");
    const port = (reservation.address() as { port: number }).port;
    await new Promise<void>((resolve) => reservation.close(() => resolve()));
    const origin = `http://127.0.0.1:${port}`;
    let server: ReturnType<typeof spawn> | undefined;
    const rows = async (sql: string, params: any[] = []) =>
      (await pool.query(sql, params)).rows;
    const accept = async (id: string, caregiver = 0) => {
      const response = await fetch(origin + "/api/owlet/accept-alert", {
        method: "POST",
        headers: {
          Cookie: `baby_session=${cookies[caregiver]}`,
          Origin: origin,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ family, eventId: id }),
      });
      assert.equal(response.status, 200);
      return response.json();
    };
    const makeDue = async () => {
      await pool.query(
        "UPDATE owlet_alert_deliveries SET next_attempt_at=now()-interval '1 second' WHERE finished_at IS NULL",
      );
      await pool.query("DELETE FROM owlet_push_backoff");
    };
    const waitForLock = async (queryFragment: string) => {
      for (let i = 0; i < 200; i++) {
        if (
          (
            await rows(
              "SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND position($1 in query)>0",
              [queryFragment],
            )
          ).length
        )
          return;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.fail(`Expected a blocked query containing ${queryFragment}`);
    };
    try {
      await migrate();
      await pool.query(
        "INSERT INTO families(id,name) VALUES($1,'Acceptance fixture')",
        [family],
      );
      await pool.query(
        "INSERT INTO children(id,family_id,name,birth_date) VALUES($1,$2,'Baby','2026-01-01')",
        [child, family],
      );
      for (let i = 0; i < users.length; i++) {
        await pool.query(
          "INSERT INTO users(id,email,password_hash,name) VALUES($1,$2,'fixture','Caregiver')",
          [users[i], `${users[i]}@example.test`],
        );
        await pool.query("INSERT INTO memberships VALUES($1,$2,$3)", [
          family,
          users[i],
          i ? "caregiver" : "owner",
        ]);
        await pool.query(
          "INSERT INTO sessions VALUES($1,$2,now()+interval '1 hour')",
          [hash(cookies[i]), users[i]],
        );
        await pool.query(
          "INSERT INTO push_subscriptions(id,user_id,subscription) VALUES($1,$2,$3)",
          [
            subscriptions[i],
            users[i],
            JSON.stringify({
              endpoint: `https://web.push.apple.com/fixture/${subscriptions[i]}`,
              keys: { p256dh: "fixture", auth: "fixture" },
            }),
          ],
        );
      }
      const event = async (repeat = true) => {
        const reading = (
          await rows(
            "INSERT INTO owlet_readings(family_id,child_id,device_serial,measured_at,oxygen_percent) VALUES($1,$2,$3,now(),89) RETURNING id",
            [family, child, randomUUID()],
          )
        )[0].id;
        return (
          await rows(
            "INSERT INTO owlet_alert_events(family_id,child_id,reading_id,kind,measured_value,threshold_value,measured_at,repeat_until_accepted) VALUES($1,$2,$3,'oxygen_below',89,92,now(),$4) RETURNING id",
            [family, child, reading, repeat],
          )
        )[0].id as string;
      };
      server = spawn(
        process.execPath,
        [new URL("../src/server.ts", import.meta.url).pathname],
        {
          env: {
            ...process.env,
            HOST: "127.0.0.1",
            PORT: String(port),
            APP_ORIGIN: origin,
            SESSION_SECURE: "false",
          },
          stdio: "ignore",
        },
      );
      for (let i = 0; i < 150; i++) {
        if (server.exitCode !== null)
          throw new Error("Test API exited before becoming ready");
        if (
          await fetch(origin + "/api/health")
            .then((r) => r.ok)
            .catch(() => false)
        )
          break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      await t.test(
        "repeat pushes cannot accumulate at the provider and Accept finishes both caregivers' queues",
        async () => {
          const id = await event();
          await deliverOwletPushes();
          await makeDue();
          await deliverOwletPushes();
          assert.equal(sends.length, 4);
          for (const send of sends) {
            assert.equal(send.options.TTL, 0);
            assert.equal(send.options.topic, `owlet-event-${id}`);
            assert.equal(send.payload.tag, send.options.topic);
            assert.equal(send.payload.badgeCount, 1);
            assert.equal(send.payload.renotify, true);
          }
          const result = await accept(id, 1);
          assert.equal(result.badgeCount, 0);
          const deliveries = await rows(
            "SELECT finished_at FROM owlet_alert_deliveries WHERE event_id=$1",
            [id],
          );
          assert.equal(deliveries.length, 2);
          assert.ok(deliveries.every((d) => d.finished_at));
          await makeDue();
          await deliverOwletPushes();
          assert.equal(sends.length, 4);
          assert.equal(
            (await accept(id)).acknowledged_at,
            result.acknowledged_at,
          );
          assert.equal(
            (
              await rows(
                "SELECT acknowledged_by FROM owlet_alert_events WHERE id=$1",
                [id],
              )
            )[0].acknowledged_by,
            users[1],
          );
        },
      );
      await t.test(
        "Accept waits for an in-flight send before confirming success",
        async () => {
          const id = await event();
          const entered = deferred(),
            release = deferred();
          onSend = async () => {
            entered.resolve();
            await release.promise;
          };
          const delivering = deliverOwletPushes();
          await entered.promise;
          const accepting = accept(id);
          try {
            await waitForLock("UPDATE owlet_alert_events SET");
            assert.equal(
              (
                await rows(
                  "SELECT acknowledged_at FROM owlet_alert_events WHERE id=$1",
                  [id],
                )
              )[0].acknowledged_at,
              null,
            );
          } finally {
            release.resolve();
            onSend = undefined;
            await delivering;
          }
          await accepting;
          const count = sends.length;
          await makeDue();
          await deliverOwletPushes();
          assert.equal(sends.length, count);
          assert.ok(
            (
              await rows(
                "SELECT finished_at FROM owlet_alert_deliveries WHERE event_id=$1",
                [id],
              )
            ).every((d) => d.finished_at),
          );
        },
      );
      await t.test(
        "a claimed worker blocked by acceptance rechecks the committed acknowledgement",
        async () => {
          const id = await event();
          await pool.query(
            "INSERT INTO owlet_alert_deliveries(event_id,subscription_id) SELECT $1,id FROM push_subscriptions WHERE id=ANY($2::uuid[])",
            [id, subscriptions],
          );
          await makeDue();
          const db = await pool.connect();
          const count = sends.length;
          let delivering: Promise<void> | undefined;
          try {
            await db.query("BEGIN");
            await db.query(
              "UPDATE owlet_alert_events SET acknowledged_at=now(),acknowledged_by=$2 WHERE id=$1",
              [id, users[0]],
            );
            delivering = deliverOwletPushes();
            await waitForLock("FOR SHARE OF e");
            await db.query(
              "UPDATE owlet_alert_deliveries SET finished_at=now() WHERE event_id=$1",
              [id],
            );
            await db.query("COMMIT");
            await delivering;
            assert.equal(sends.length, count);
          } finally {
            await db.query("ROLLBACK");
            db.release();
            await delivering;
          }
        },
      );
      await t.test("one-shot pushes keep their offline retention", async () => {
        const id = await event(false),
          count = sends.length;
        await makeDue();
        await deliverOwletPushes();
        assert.equal(sends.length, count + 2);
        for (const send of sends.slice(count)) {
          assert.equal(send.options.TTL, 120);
          assert.equal(send.options.topic, `owlet-event-${id}`);
        }
        await makeDue();
        await deliverOwletPushes();
        assert.equal(sends.length, count + 2);
      });
    } finally {
      if (server && server.exitCode === null) {
        server.kill("SIGTERM");
        await once(server, "exit");
      }
      try {
        await pool.query("DELETE FROM owlet_alert_events WHERE family_id=$1", [
          family,
        ]);
        await pool.query("DELETE FROM owlet_readings WHERE family_id=$1", [
          family,
        ]);
        await pool.query("DELETE FROM children WHERE family_id=$1", [family]);
        await pool.query("DELETE FROM memberships WHERE family_id=$1", [
          family,
        ]);
        await pool.query("DELETE FROM families WHERE id=$1", [family]);
        await pool.query(
          "DELETE FROM push_subscriptions WHERE user_id=ANY($1::uuid[])",
          [users],
        );
        await pool.query("DELETE FROM sessions WHERE user_id=ANY($1::uuid[])", [
          users,
        ]);
        await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [users]);
      } finally {
        await pool.end();
      }
    }
  },
);
