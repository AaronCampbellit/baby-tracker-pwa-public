import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import webpush from "web-push";
import { pool, migrate } from "../src/db.ts";
import { hash, token } from "../src/auth.ts";
import { collectOwlet, encryptTokens } from "../src/owlet.ts";
import { deliverOwletPushes } from "../src/owlet-alerts.ts";
import { owletCharging } from "../src/owlet-charging.ts";

const modern = (chg: unknown) => ({
  REAL_TIME_VITALS: { value: JSON.stringify({ chg }) },
});
test("charging requires an explicit known code, including Dream Sock chg=2, and legacy 0/1", () => {
  for (const value of [2, "2"]) {
    assert.equal(owletCharging(modern(value)), true);
    assert.equal(owletCharging({ CHARGE_STATUS: { value } }), null);
  }
  for (const value of [true, 1, "1"]) {
    assert.equal(owletCharging(modern(value)), true);
    assert.equal(owletCharging({ CHARGE_STATUS: { value } }), true);
  }
  for (const value of [false, 0, "0"]) {
    assert.equal(owletCharging(modern(value)), false);
    assert.equal(owletCharging({ CHARGE_STATUS: { value } }), false);
  }
  for (const value of [
    undefined,
    null,
    "",
    "true",
    "false",
    "charging",
    "unknown",
    3,
    -1,
    " 1 ",
    [],
    {},
  ]) {
    assert.equal(owletCharging(modern(value)), null);
    assert.equal(owletCharging({ CHARGE_STATUS: { value } }), null);
  }
});
test("contradictory fields and malformed vital reports never confirm charging", () => {
  assert.equal(
    owletCharging({ ...modern(1), CHARGE_STATUS: { value: 0 } }),
    null,
  );
  assert.equal(
    owletCharging({ ...modern(0), CHARGE_STATUS: { value: 1 } }),
    null,
  );
  assert.equal(
    owletCharging({ ...modern(null), CHARGE_STATUS: { value: 1 } }),
    null,
  );
  assert.equal(
    owletCharging({ ...modern(1), CHARGE_STATUS: { value: 2 } }),
    null,
  );
  assert.equal(
    owletCharging({ ...modern(1), CHARGE_STATUS: { value: "1" } }),
    true,
  );
  for (const value of ["not JSON", "null", "[]", "1"])
    assert.equal(
      owletCharging({
        REAL_TIME_VITALS: { value },
        CHARGE_STATUS: { value: 1 },
      }),
      null,
    );
});
test("full/low battery, sock-off, disconnection and disabled base alerts never imply charging", () => {
  assert.equal(owletCharging({}), null);
  for (const battery of [0, 9, 99, 100])
    assert.equal(
      owletCharging({
        REAL_TIME_VITALS: {
          value: JSON.stringify({
            bat: battery,
            hr: 0,
            ox: 0,
            sc: 0,
            bso: 0,
            aps: 1,
          }),
        },
        SOCK_OFF: { value: 1 },
        SOCK_DISCON_ALRT: { value: 1 },
        ALRTS_DISABLED: { value: 1 },
      }),
      null,
    );
});

test(
  "charging pauses alert creation and delivery only for the currently linked sock; pending alerts resume",
  { skip: process.env.OWLET_CHARGING_TEST !== "1" },
  async (t) => {
    const database = new URL(process.env.DATABASE_URL!);
    assert.ok(
      ["127.0.0.1", "localhost"].includes(database.hostname) &&
        database.pathname.startsWith("/charging_"),
      "Use an isolated local charging_* test database.",
    );
    const originalFetch = globalThis.fetch;
    const family = randomUUID(),
      children = [randomUUID(), randomUUID()],
      user = randomUUID(),
      subscriptionId = randomUUID();
    const session = token(),
      sends: any[] = [];
    const keys = webpush.generateVAPIDKeys();
    process.env.VAPID_PUBLIC_KEY = keys.publicKey;
    process.env.VAPID_PRIVATE_KEY = keys.privateKey;
    process.env.VAPID_SUBJECT = "mailto:charging@example.test";
    process.env.OWLET_TOKEN_KEY = Buffer.alloc(32, 9).toString("base64");
    Object.assign(process.env, { OWLET_FIREBASE_API_KEY: "fixture-firebase", OWLET_AYLA_APP_ID: "fixture-app", OWLET_AYLA_APP_SECRET: "fixture-secret", OWLET_ANDROID_PACKAGE: "test.fixture", OWLET_ANDROID_CERT: "fixture-cert" });
    const reservation = createServer().listen(0, "127.0.0.1");
    await once(reservation, "listening");
    const port = (reservation.address() as { port: number }).port;
    await new Promise<void>((resolve) => reservation.close(() => resolve()));
    const origin = `http://127.0.0.1:${port}`;
    let server: ReturnType<typeof spawn> | undefined;
    let stamp = new Date(Date.now() - 1000).toISOString();
    let charge: unknown = 2,
      heart = 90,
      legacy: unknown = undefined,
      includeCharge = true,
      missingVitals = false,
      fail = false;
    const connection = {
      id: randomUUID(),
      family_id: family,
      child_id: children[0],
      device_serial: "CHARGINGTEST",
      encrypted_tokens: encryptTokens({
        access: "fixture",
        refresh: "fixture",
        expiresAt: Date.now() + 3600000,
      }),
    };
    const rows = async (sql: string, params: any[] = []) =>
      (await pool.query(sql, params)).rows;
    const active = async () => {
      const response = await originalFetch(
        `${origin}/api/owlet/active-alerts?family=${family}`,
        { headers: { Cookie: `baby_session=${session}` } },
      );
      assert.equal(response.status, 200);
      return (await response.json()).events as {
        id: string;
        child_id: string;
      }[];
    };
    const makeDue = async () => {
      await pool.query(
        "UPDATE owlet_alert_deliveries SET next_attempt_at=now()-interval '1 second' WHERE subscription_id=$1 AND finished_at IS NULL",
        [subscriptionId],
      );
      await pool.query(
        "DELETE FROM owlet_push_backoff WHERE subscription_id=$1",
        [subscriptionId],
      );
    };
    try {
      await migrate();
      await pool.query(
        "INSERT INTO families(id,name) VALUES($1,'Charging test')",
        [family],
      );
      await pool.query(
        "INSERT INTO users(id,email,password_hash,name) VALUES($1,$2,'fixture','Charging caregiver')",
        [user, `${user}@example.test`],
      );
      await pool.query("INSERT INTO memberships VALUES($1,$2,'owner')", [
        family,
        user,
      ]);
      await pool.query(
        "INSERT INTO sessions VALUES($1,$2,now()+interval '1 hour')",
        [hash(session), user],
      );
      for (const child of children)
        await pool.query(
          "INSERT INTO children(id,family_id,name,birth_date) VALUES($1,$2,'Test child','2026-01-01')",
          [child, family],
        );
      await pool.query(
        "INSERT INTO owlet_connections(id,family_id,child_id,connected_by,account_email,device_serial,device_name,encrypted_tokens) VALUES($1,$2,$3,$4,'charging@example.test','CHARGINGTEST','Dream Sock',$5)",
        [connection.id, family, children[0], user, connection.encrypted_tokens],
      );
      await pool.query(
        "INSERT INTO owlet_alert_settings(family_id,child_id,oxygen_below,heart_below,heart_above,battery_below,enabled_at,repeat_until_accepted,updated_by) VALUES($1,$2,92,100,160,20,now()-interval '1 day',true,$3)",
        [family, children[0], user],
      );
      await pool.query(
        "INSERT INTO push_subscriptions(id,user_id,subscription) VALUES($1,$2,$3)",
        [
          subscriptionId,
          user,
          JSON.stringify({
            endpoint: "https://web.push.apple.com/fixture/charging",
            keys: { p256dh: "fixture", auth: "fixture" },
          }),
        ],
      );
      t.mock.method(
        webpush,
        "sendNotification",
        async (_subscription: any, payload: string) => {
          sends.push(JSON.parse(payload));
          return { statusCode: 201 };
        },
      );
      globalThis.fetch = async (input) => {
        if (!String(input).endsWith("properties.json"))
          return Response.json({ datapoint: { value: 1 } });
        if (fail) return new Response("", { status: 429 });
        const vitals = {
          hr: heart,
          ox: 89,
          bat: 9,
          sc: 0,
          ...(includeCharge ? { chg: charge } : {}),
        };
        return Response.json([
          ...(missingVitals
            ? []
            : [
                {
                  property: {
                    name: "REAL_TIME_VITALS",
                    value: JSON.stringify(vitals),
                    data_updated_at: stamp,
                  },
                },
              ]),
          ...(legacy === undefined
            ? []
            : [{ property: { name: "CHARGE_STATUS", value: legacy } }]),
          { property: { name: "SOCK_OFF", value: 1 } },
        ]);
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
          throw Error("Test API exited before becoming ready");
        if (
          await originalFetch(origin + "/api/health")
            .then((r) => r.ok)
            .catch(() => false)
        )
          break;
        await new Promise((resolve) => setTimeout(resolve, 30));
      }
      await t.test(
        "all threshold kinds are skipped on a confirmed charging reading",
        async () => {
          await collectOwlet(connection);
          heart = 170;
          stamp = new Date(Date.now() - 500).toISOString();
          await collectOwlet(connection);
          assert.equal(
            (
              await rows(
                "SELECT count(*)::int AS count FROM owlet_alert_events WHERE family_id=$1",
                [family],
              )
            )[0].count,
            0,
          );
          assert.equal(
            (
              await rows(
                "SELECT charging FROM owlet_polls WHERE child_id=$1 ORDER BY id DESC LIMIT 1",
                [children[0]],
              )
            )[0].charging,
            true,
          );
        },
      );
      // Seed all four unaccepted kinds so the same repeated timestamp can prove
      // charging-state transitions without overwriting historical measurements.
      const firstReading = (
        await rows("SELECT id FROM owlet_readings WHERE child_id=$1 LIMIT 1", [
          children[0],
        ])
      )[0].id;
      for (const kind of [
        "oxygen_below",
        "heart_below",
        "heart_above",
        "battery_below",
      ])
        await pool.query(
          "INSERT INTO owlet_alert_events(family_id,child_id,kind,reading_id,measured_value,threshold_value,measured_at,repeat_until_accepted) VALUES($1,$2,$3,$4,89,92,now(),true)",
          [family, children[0], kind, firstReading],
        );
      await t.test(
        "fresh charging pauses pending foreground alarms and push schedules without accepting them",
        async () => {
          assert.equal((await active()).length, 0);
          await deliverOwletPushes();
          assert.equal(sends.length, 0);
          assert.equal(
            (
              await rows(
                "SELECT count(*)::int AS count FROM owlet_alert_events WHERE family_id=$1 AND acknowledged_at IS NULL",
                [family],
              )
            )[0].count,
            4,
          );
        },
      );
      await t.test(
        "undocking takes effect with the same vital timestamp and preserves alert history",
        async () => {
          charge = 0;
          await collectOwlet(connection);
          assert.equal((await active()).length, 4);
          assert.equal(
            (
              await rows(
                "SELECT count(*)::int AS count FROM owlet_readings WHERE family_id=$1",
                [family],
              )
            )[0].count,
            2,
          );
          await makeDue();
          await deliverOwletPushes();
          assert.equal(sends.length, 1);
          assert.equal(
            (
              await rows(
                "SELECT count(*)::int AS count FROM owlet_alert_deliveries WHERE subscription_id=$1 AND finished_at IS NULL",
                [subscriptionId],
              )
            )[0].count,
            4,
          );
        },
      );
      await t.test(
        "paused queued deliveries do not block another child's alerts on the same device",
        async () => {
          charge = 1;
          await collectOwlet(connection);
          const otherReading = (
            await rows(
              "INSERT INTO owlet_readings(family_id,child_id,device_serial,measured_at,oxygen_percent) VALUES($1,$2,'OTHERTEST',now()-interval '1 minute',89) RETURNING id",
              [family, children[1]],
            )
          )[0].id;
          await pool.query(
            "INSERT INTO owlet_alert_events(family_id,child_id,kind,reading_id,measured_value,threshold_value,measured_at,repeat_until_accepted) VALUES($1,$2,'oxygen_below',$3,89,92,now(),true)",
            [family, children[1], otherReading],
          );
          assert.deepEqual(
            (await active()).map((e) => e.child_id),
            [children[1]],
          );
          await makeDue();
          await deliverOwletPushes();
          assert.equal(sends.length, 2);
          assert.match(sends.at(-1).url, new RegExp(children[1]));
          // A report for an old/replaced device cannot suppress the current sock.
          await pool.query(
            "UPDATE owlet_connections SET device_serial='REPLACED' WHERE id=$1",
            [connection.id],
          );
          assert.equal((await active()).length, 5);
          await pool.query(
            "UPDATE owlet_connections SET device_serial='CHARGINGTEST' WHERE id=$1",
            [connection.id],
          );
        },
      );
      await t.test(
        "missing, invalid and conflicting current flags do not retain an earlier charging pause",
        async () => {
          for (const value of [undefined, null, 3, "true", "0", false]) {
            includeCharge = value !== undefined;
            charge = value;
            await collectOwlet(connection);
            assert.equal((await active()).length, 5, String(value));
          }
          includeCharge = true;
          charge = 1;
          legacy = 0;
          await collectOwlet(connection);
          assert.equal((await active()).length, 5);
          legacy = undefined;
        },
      );
      await t.test(
        "stale and future-dated charging polls do not silence alerts",
        async () => {
          charge = 1;
          await collectOwlet(connection);
          await pool.query(
            "UPDATE owlet_polls SET fetched_at=now()-interval '31 seconds' WHERE child_id=$1",
            [children[0]],
          );
          assert.equal((await active()).length, 5);
          await collectOwlet(connection);
          await pool.query(
            "UPDATE owlet_polls SET fetched_at=now()+interval '1 minute' WHERE id=(SELECT max(id) FROM owlet_polls WHERE child_id=$1)",
            [children[0]],
          );
          assert.equal((await active()).length, 5);
          await pool.query(
            "UPDATE owlet_polls SET fetched_at=now()-interval '31 seconds' WHERE child_id=$1",
            [children[0]],
          );
        },
      );
      await t.test(
        "a failed fetch supersedes charging, while confirmed legacy charging works without vital readings",
        async () => {
          await collectOwlet(connection);
          fail = true;
          await assert.rejects(() => collectOwlet(connection));
          fail = false;
          assert.equal((await active()).length, 5);
          charge = undefined;
          includeCharge = false;
          legacy = 1;
          missingVitals = true;
          await assert.rejects(
            () => collectOwlet(connection),
            /timestamped reading/,
          );
          assert.deepEqual(
            (await active()).map((e) => e.child_id),
            [children[1]],
          );
          missingVitals = false;
          legacy = undefined;
          includeCharge = true;
        },
      );
      await t.test(
        "charging is rechecked after claiming; a transition pauses the send and releases the lease",
        async () => {
          charge = 0;
          await collectOwlet(connection);
          // Acknowledge child 2 in the fixture to isolate this claim race.
          await pool.query(
            "UPDATE owlet_alert_events SET acknowledged_at=now() WHERE child_id=$1",
            [children[1]],
          );
          await makeDue();
          const previous = sends.length;
          const originalQuery = pool.query.bind(pool) as any;
          const queryMock = t.mock.method(
            pool,
            "query",
            async (...args: any[]) => {
              const result = await originalQuery(...args);
              // Publish charging after the claim commits, before the delivery
              // transaction rechecks the current sock state.
              if (String(args[0]).includes("WITH due AS")) {
                await originalQuery(
                  "INSERT INTO owlet_polls(family_id,child_id,device_serial,duration_ms,status,charging) VALUES($1,$2,'CHARGINGTEST',1,'success',true)",
                  [family, children[0]],
                );
              }
              return result;
            },
          );
          try {
            await deliverOwletPushes();
          } finally {
            queryMock.mock.restore();
          }
          assert.equal(sends.length, previous);
          const lease = await rows(
            "SELECT max(extract(epoch from next_attempt_at-now()))::float AS seconds FROM owlet_alert_deliveries WHERE subscription_id=$1 AND finished_at IS NULL",
            [subscriptionId],
          );
          assert.ok(lease[0].seconds < 2);
          charge = 0;
          await collectOwlet(connection);
          await makeDue();
          await deliverOwletPushes();
          assert.equal(sends.length, previous + 1);
        },
      );
      await t.test(
        "non-charging and unknown charging still create normal threshold alerts",
        async () => {
          await pool.query(
            "DELETE FROM owlet_alert_events WHERE family_id=$1",
            [family],
          );
          // Use child 2 with a distinct timestamp so event creation is exercised.
          const other = {
            ...connection,
            id: randomUUID(),
            child_id: children[1],
            device_serial: "OTHERTEST",
          };
          await pool.query(
            "INSERT INTO owlet_connections(id,family_id,child_id,connected_by,account_email,device_serial,device_name,encrypted_tokens) VALUES($1,$2,$3,$4,'second-charging@example.test','OTHERTEST','Dream Sock',$5)",
            [other.id, family, children[1], user, other.encrypted_tokens],
          );
          await pool.query(
            "INSERT INTO owlet_alert_settings(family_id,child_id,oxygen_below,heart_below,heart_above,battery_below,enabled_at,updated_by,repeat_until_accepted) VALUES($1,$2,92,100,160,20,now()-interval '1 day',$3,false)",
            [family, children[1], user],
          );
          includeCharge = false;
          heart = 90;
          await collectOwlet(other);
          assert.deepEqual(
            (
              await rows(
                "SELECT kind FROM owlet_alert_events WHERE child_id=$1 ORDER BY kind",
                [children[1]],
              )
            ).map((e) => e.kind),
            ["battery_below", "heart_below", "oxygen_below"],
          );
          includeCharge = true;
          charge = 0;
          heart = 170;
          stamp = new Date(Date.now() - 250).toISOString();
          await collectOwlet(other);
          assert.equal(
            (
              await rows(
                "SELECT count(*)::int AS count FROM owlet_alert_events WHERE child_id=$1",
                [children[1]],
              )
            )[0].count,
            4,
          );
          charge = 2;
          await collectOwlet(other);
          const previous = sends.length;
          await makeDue();
          await deliverOwletPushes();
          assert.equal(sends.length, previous);
          assert.equal(
            (
              await rows(
                "SELECT count(*)::int AS count FROM owlet_alert_events WHERE child_id=$1 AND push_attempted_at IS NULL",
                [children[1]],
              )
            )[0].count,
            4,
          );
          charge = 0;
          await collectOwlet(other);
          await makeDue();
          await deliverOwletPushes();
          assert.equal(sends.length, previous + 1);
          assert.equal(sends.at(-1).requireInteraction, false);
        },
      );
      await t.test(
        "charging arriving during alert evaluation prevents insertion",
        async () => {
          await pool.query(
            "DELETE FROM owlet_alert_events WHERE family_id=$1",
            [family],
          );
          charge = 0;
          heart = 90;
          stamp = new Date(Date.now() - 100).toISOString();
          const originalQuery = pool.query.bind(pool) as any;
          const queryMock = t.mock.method(
            pool,
            "query",
            async (...args: any[]) => {
              if (String(args[0]).includes("INSERT INTO owlet_alert_events")) {
                await originalQuery(
                  "INSERT INTO owlet_polls(family_id,child_id,device_serial,duration_ms,status,charging) VALUES($1,$2,'CHARGINGTEST',1,'success',true)",
                  [family, children[0]],
                );
              }
              return originalQuery(...args);
            },
          );
          try {
            await collectOwlet(connection);
          } finally {
            queryMock.mock.restore();
          }
          assert.equal(
            (
              await rows(
                "SELECT count(*)::int AS count FROM owlet_alert_events WHERE family_id=$1",
                [family],
              )
            )[0].count,
            0,
          );
        },
      );
    } finally {
      globalThis.fetch = originalFetch;
      if (server && server.exitCode === null) {
        server.kill("SIGTERM");
        await once(server, "exit");
      }
      t.mock.restoreAll();
      await pool.end();
    }
  },
);
