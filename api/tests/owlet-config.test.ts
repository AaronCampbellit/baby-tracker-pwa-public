import { test } from "node:test";
import assert from "node:assert/strict";
import { owletClientConfig, owletIntegrationConfigured, owletTokenKeyConfigured } from "../src/owlet-config.ts";
import { signInOwlet } from "../src/owlet.ts";

const configured = {
  OWLET_TOKEN_KEY: Buffer.alloc(32, 7).toString("base64"),
  OWLET_FIREBASE_API_KEY: "fixture-firebase-key",
  OWLET_AYLA_APP_ID: "fixture-app",
  OWLET_AYLA_APP_SECRET: "fixture-app-secret",
  OWLET_ANDROID_PACKAGE: "test.authorized.client",
  OWLET_ANDROID_CERT: "fixture-certificate",
};
test("Owlet integration has no bundled client fallback and requires every authorized client setting", () => {
  assert.equal(owletClientConfig({}), null);
  assert.equal(owletIntegrationConfigured({ OWLET_TOKEN_KEY: configured.OWLET_TOKEN_KEY }), false);
  assert.equal(owletIntegrationConfigured(configured), true);
  for (const name of Object.keys(configured)) {
    assert.equal(owletIntegrationConfigured({ ...configured, [name]: "" }), false, name);
    assert.equal(owletIntegrationConfigured({ ...configured, [name]: "  " }), false, name);
  }
  assert.equal(owletClientConfig(configured)!.appSecret, "fixture-app-secret");
});
test("token encryption validity is independent of provider configuration", () => {
  assert.equal(owletTokenKeyConfigured({ OWLET_TOKEN_KEY: configured.OWLET_TOKEN_KEY }), true);
  for (const key of ["", "not-base64", Buffer.alloc(31).toString("base64"), Buffer.alloc(33).toString("base64"), configured.OWLET_TOKEN_KEY + "!"])
    assert.equal(owletTokenKeyConfigured({ OWLET_TOKEN_KEY: key }), false);
});

test("missing client configuration makes no provider request; supplied values drive the mocked authentication exchange", async (t) => {
  const prior = Object.fromEntries(Object.keys(configured).map((name) => [name, process.env[name]]));
  const fetchBefore = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = fetchBefore;
    for (const [name, value] of Object.entries(prior)) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  });
  for (const name of Object.keys(configured)) delete process.env[name];
  const requests: { url: string; options: RequestInit }[] = [];
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    if (String(url).includes("verifyPassword")) return Response.json({ refreshToken: "fixture-refresh" });
    if (String(url).includes("securetoken")) return Response.json({ id_token: "fixture-id", refresh_token: "fixture-refresh-2" });
    if (String(url).endsWith("/mini/")) return Response.json({ mini_token: "fixture-mini" });
    if (String(url).endsWith("token_sign_in")) return Response.json({ access_token: "fixture-access", expires_in: 3600 });
    throw new Error("Unexpected provider request");
  };
  await assert.rejects(signInOwlet("fixture@example.test", "fixture-password"), /client configuration is missing/);
  assert.equal(requests.length, 0);
  Object.assign(process.env, configured, { OWLET_FIREBASE_API_KEY: "fixture&key" });
  const tokens = await signInOwlet("fixture@example.test", "fixture-password");
  assert.equal(tokens.access, "fixture-access");
  assert.equal(tokens.refresh, "fixture-refresh-2");
  assert.equal(requests.length, 4);
  assert.equal(new URL(requests[0].url).searchParams.get("key"), "fixture&key");
  assert.equal(new Headers(requests[0].options.headers).get("X-Android-Package"), configured.OWLET_ANDROID_PACKAGE);
  assert.equal(new Headers(requests[1].options.headers).get("X-Android-Cert"), configured.OWLET_ANDROID_CERT);
  assert.deepEqual(JSON.parse(String(requests[3].options.body)), {
    app_id: configured.OWLET_AYLA_APP_ID, app_secret: configured.OWLET_AYLA_APP_SECRET,
    provider: "owl_id", token: "fixture-mini",
  });
});
