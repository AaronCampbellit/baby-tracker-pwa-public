import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";
export { deliverOwletPushes } from "./owlet-alerts.ts";
import { pool } from "./db.ts";
import { owletAlertsAllowedSQL, owletCharging } from "./owlet-charging.ts";
import { owletIntegrationConfigured, owletTokenKeyConfigured, requireOwletClientConfig } from "./owlet-config.ts";

// Unofficial US Dream Sock endpoints. Owlet does not publish a supported public
// API; deployments must supply client credentials they are authorized to use.
const aylaBase = "https://ads-field-1a2039d9.aylanetworks.com/apiv1";
const aylaSignIn = "https://user-field-1a2039d9.aylanetworks.com/api/v1/token_sign_in";
const miniUrl = "https://ayla-sso.owletdata.com/mini/";
type Tokens = { access: string; refresh: string; expiresAt: number };
export type OwletDevice = { serial: string; name: string; model: string };
type Connection = {
  id: string;
  family_id: string;
  child_id: string;
  device_serial: string;
  encrypted_tokens: string;
};
class OwletSessionError extends Error {}
class OwletHTTPError extends Error {
  httpStatus: number;
  retrySeconds: number;
  constructor(httpStatus: number, retrySeconds = 0) {
    super(`Owlet service returned status ${httpStatus}`);
    this.httpStatus = httpStatus;
    this.retrySeconds = retrySeconds;
  }
}

export function owletConfigured() {
  return owletIntegrationConfigured();
}
function encryptionKey() {
  if (!owletTokenKeyConfigured()) throw new Error("Owlet token encryption key is not configured");
  return Buffer.from(process.env.OWLET_TOKEN_KEY!, "base64");
}
export function encryptTokens(tokens: Tokens) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(tokens)), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64");
}
function decryptTokens(value: string): Tokens {
  const bytes = Buffer.from(value, "base64");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), bytes.subarray(0, 12));
  decipher.setAuthTag(bytes.subarray(12, 28));
  return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString());
}
async function requestJSON(url: string, options: RequestInit = {}) {
  let response: Response;
  try {
    response = await fetch(url, { ...options, signal: AbortSignal.timeout(12000) });
  } catch {
    throw new Error("Owlet could not be reached");
  }
  if (!response.ok) {
    if (response.status === 401 || response.status === 403)
      throw new OwletSessionError("Owlet rejected the account or session");
    if (response.status === 400)
      throw new Error("Owlet rejected the request or account credentials");
    const retry = response.headers.get("retry-after");
    const retrySeconds = retry ? (/^\d+$/.test(retry) ? Number(retry) : Math.max(0, Math.ceil((Date.parse(retry) - Date.now()) / 1000))) : 0;
    throw new OwletHTTPError(response.status, Number.isFinite(retrySeconds) ? retrySeconds : 0);
  }
  const text = await response.text();
  if (text.length > 1_000_000) throw new Error("Owlet response is too large");
  try { return JSON.parse(text); }
  catch { throw new Error("Owlet returned an unreadable response"); }
}
async function exchangeRefresh(refresh: string): Promise<Tokens> {
  const { firebaseKey, androidHeaders, appId, appSecret } = requireOwletClientConfig();
  const firebase = await requestJSON(
    `https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(firebaseKey)}`,
    {
      method: "POST",
      headers: { ...androidHeaders, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grantType: "refresh_token", refreshToken: refresh }),
    },
  );
  if (typeof firebase.id_token !== "string" || typeof firebase.refresh_token !== "string")
    throw new Error("Owlet sign-in response is incomplete");
  const mini = await requestJSON(miniUrl, {
    headers: { Authorization: firebase.id_token },
  });
  if (typeof mini.mini_token !== "string") throw new Error("Owlet mini token is missing");
  const ayla = await requestJSON(aylaSignIn, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      app_id: appId,
      app_secret: appSecret,
      provider: "owl_id",
      token: mini.mini_token,
    }),
  });
  if (typeof ayla.access_token !== "string" || !Number.isFinite(Number(ayla.expires_in)))
    throw new Error("Owlet access token is missing");
  return {
    access: ayla.access_token,
    refresh: firebase.refresh_token,
    expiresAt: Date.now() + Math.max(60, Number(ayla.expires_in) - 60) * 1000,
  };
}
export async function signInOwlet(email: string, password: string): Promise<Tokens> {
  const { firebaseKey, androidHeaders } = requireOwletClientConfig();
  const firebase = await requestJSON(
    `https://www.googleapis.com/identitytoolkit/v3/relyingparty/verifyPassword?key=${encodeURIComponent(firebaseKey)}`,
    {
      method: "POST",
      headers: { ...androidHeaders, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ email, password, returnSecureToken: "true" }),
    },
  );
  if (typeof firebase.refreshToken !== "string")
    throw new Error("Owlet did not return a refresh token");
  return exchangeRefresh(firebase.refreshToken);
}
async function aylaGET(path: string, access: string) {
  return requestJSON(aylaBase + path, {
    headers: { Authorization: `auth_token ${access}` },
  });
}
export async function getOwletDevices(tokens: Tokens): Promise<OwletDevice[]> {
  const data = await aylaGET("/devices.json", tokens.access);
  if (!Array.isArray(data)) throw new Error("Owlet device list is unreadable");
  return data.flatMap((item) => {
    const device = item?.device ?? item;
    const serial = device?.dsn;
    if (typeof serial !== "string" || !/^[a-zA-Z0-9_-]{3,100}$/.test(serial)) return [];
    return [{
      serial,
      name: String(device.product_name ?? "Owlet sock").slice(0, 80),
      model: String(device.oem_model ?? device.model ?? "").slice(0, 80),
    }];
  });
}
export async function devicesForConnection(connection: Connection) {
  let tokens = decryptTokens(connection.encrypted_tokens);
  if (tokens.expiresAt <= Date.now()) {
    tokens = await exchangeRefresh(tokens.refresh);
    await pool.query("UPDATE owlet_connections SET encrypted_tokens=$1 WHERE id=$2", [
      encryptTokens(tokens), connection.id,
    ]);
  }
  return getOwletDevices(tokens);
}
async function readProperties(serial: string, access: string) {
  // Owlet's unofficial Dream Sock client uses APP_ACTIVE to request new
  // readings. No alarm thresholds or base station controls are changed here.
  await requestJSON(`${aylaBase}/dsns/${encodeURIComponent(serial)}/properties/APP_ACTIVE/datapoints.json`, {
    method: "POST",
    headers: { Authorization: `auth_token ${access}`, "Content-Type": "application/json" },
    body: JSON.stringify({ datapoint: { metadata: {}, value: 1 } }),
  });
  return aylaGET(`/dsns/${encodeURIComponent(serial)}/properties.json`, access);
}
function parseProperties(data: unknown) {
  if (!Array.isArray(data)) throw new Error("Owlet readings are unreadable");
  const properties: Record<string, { value?: unknown; data_updated_at?: string }> = {};
  for (const item of data) {
    const property = item?.property;
    if (typeof property?.name === "string") properties[property.name] = property;
  }
  return properties;
}
function number(value: unknown, min: number, max: number) {
  const parsed = Number(value);
  return value !== undefined && value !== null && value !== "" &&
    Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : null;
}
function flag(value: unknown) {
  return value === true || value === 1 || value === "1";
}
function normalize(properties: Record<string, { value?: unknown; data_updated_at?: string }>) {
  let vitals: Record<string, unknown> = {};
  if (typeof properties.REAL_TIME_VITALS?.value === "string") {
    try { vitals = JSON.parse(properties.REAL_TIME_VITALS.value); }
    catch { throw new Error("Owlet vital readings are unreadable"); }
  }
  const value = (modern: string, legacy: string) =>
    vitals[modern] ?? properties[legacy]?.value;
  const timeText = properties.REAL_TIME_VITALS?.data_updated_at ??
    properties.HEART_RATE?.data_updated_at ??
    properties.OXYGEN_LEVEL?.data_updated_at;
  const measuredAt = timeText ? Date.parse(timeText) : NaN;
  if (!Number.isFinite(measuredAt) || measuredAt > Date.now() + 60000)
    throw new Error("Owlet has no timestamped reading yet");
  const alerts = Object.fromEntries(
    ["CRIT_OX_ALRT", "LOW_OX_ALRT", "LOW_HR_ALRT", "HIGH_HR_ALRT", "SOCK_DISCON_ALRT", "SOCK_OFF", "LOW_BATT_ALRT"]
      .filter((key) => key in properties)
      .map((key) => [key, flag(properties[key].value)]),
  );
  const providerData = {
    vitals,
    properties: Object.fromEntries(
      Object.entries(properties)
        .filter(([name]) => name !== "REAL_TIME_VITALS")
        .map(([name, property]) => [name, property.value ?? null]),
    ),
  };
  return {
    measuredAt: new Date(measuredAt),
    heartRate: number(value("hr", "HEART_RATE"), 0, 300),
    oxygenPercent: number(value("ox", "OXYGEN_LEVEL"), 0, 100),
    batteryPercent: number(value("bat", "BATT_LEVEL"), 0, 100),
    movement: number(value("mv", "MOVEMENT"), 0, 1000),
    sleepState: number(vitals.ss, 0, 100),
    sockConnection: number(value("sc", "SOCK_CONNECTION"), 0, 100),
    charging: owletCharging(properties),
    alerts,
    providerData,
  };
}
async function evaluateOwletAlerts(readingId: number, connection: Connection, reading: ReturnType<typeof normalize>) {
  if (reading.charging === true) return;
  // Never issue a new alert for a cached or delayed provider reading.
  if (Date.now() - reading.measuredAt.getTime() > 120_000) return;
  const settings = await pool.query(
    "SELECT * FROM owlet_alert_settings WHERE family_id=$1 AND child_id=$2 AND enabled_at<=$3",
    [connection.family_id, connection.child_id, reading.measuredAt],
  );
  if (!settings.rowCount) return;
  const s = settings.rows[0];
  const checks = [
    ["oxygen_below", reading.oxygenPercent, s.oxygen_below, "below"],
    ["heart_below", reading.heartRate, s.heart_below, "below"],
    ["heart_above", reading.heartRate, s.heart_above, "above"],
    ["battery_below", reading.batteryPercent, s.battery_below, "below"],
  ] as const;
  for (const [kind, value, threshold, direction] of checks) {
    if (value === null || threshold === null ||
      (direction === "below" ? value >= threshold : value <= threshold)) continue;
    await pool.query(
      `INSERT INTO owlet_alert_events
        (family_id,child_id,reading_id,kind,measured_value,threshold_value,measured_at,repeat_until_accepted)
       SELECT $1,$2,$3,$4,$5,$6,$7,$8
       FROM (SELECT $1::uuid AS family_id,$2::uuid AS child_id) e
       WHERE ${owletAlertsAllowedSQL()} AND NOT EXISTS (
         SELECT 1 FROM owlet_alert_events
         WHERE family_id=$1 AND child_id=$2 AND kind=$4
           AND ((repeat_until_accepted AND acknowledged_at IS NULL) OR (created_at>now()-interval '15 minutes' AND (NOT $8 OR repeat_until_accepted)))
       ) ON CONFLICT DO NOTHING`,
      [connection.family_id, connection.child_id, readingId, kind, value, threshold, reading.measuredAt, s.repeat_until_accepted],
    );
  }
}
export async function collectOwlet(connection: Connection) {
  const started = Date.now();
  let pollId: string | undefined;
  try {
  let tokens = decryptTokens(connection.encrypted_tokens);
  let storedCipher = connection.encrypted_tokens;
  const renew = async () => {
    tokens = await exchangeRefresh(tokens.refresh);
    const nextCipher = encryptTokens(tokens);
    const updated = await pool.query("UPDATE owlet_connections SET encrypted_tokens=$1 WHERE id=$2 AND encrypted_tokens=$3 RETURNING id", [
      nextCipher, connection.id, storedCipher,
    ]);
    if (!updated.rowCount) throw new Error("Owlet connection changed during collection");
    storedCipher = nextCipher;
  };
  if (tokens.expiresAt <= Date.now()) await renew();
  let raw;
  try {
    raw = await readProperties(connection.device_serial, tokens.access);
  } catch (error) {
    if (!(error instanceof OwletSessionError)) throw error;
    await renew();
    raw = await readProperties(connection.device_serial, tokens.access);
  }
  const archived = await pool.query(
    "INSERT INTO owlet_polls(family_id,child_id,device_serial,duration_ms,status,raw_properties) VALUES($1,$2,$3,$4,'success',$5) RETURNING id",
    [connection.family_id, connection.child_id, connection.device_serial, Date.now() - started, JSON.stringify(raw)],
  );
  pollId = archived.rows[0].id;
  const properties = parseProperties(raw);
  // Charging can change while measurements stop or repeat. Save it for every
  // successful provider response, before requiring a timestamped vital reading.
  await pool.query("UPDATE owlet_polls SET charging=$1 WHERE id=$2", [owletCharging(properties), pollId]);
  for (const [name, property] of Object.entries(properties)) {
    if (/LOG_FILE|LOGGED_DATA_CACHE/.test(name) && typeof property.value === "string" && property.value.startsWith("https://"))
      await pool.query("INSERT INTO owlet_log_files(family_id,child_id,device_serial,property_name,source_url) VALUES($1,$2,$3,$4,$5) ON CONFLICT(family_id,child_id,source_url) DO NOTHING", [connection.family_id, connection.child_id, connection.device_serial, name, property.value]);
  }
  const reading = normalize(properties);
  await pool.query("UPDATE owlet_polls SET measured_at=$1 WHERE id=$2", [reading.measuredAt, pollId]);
  const inserted = await pool.query(
    `INSERT INTO owlet_readings
      (family_id,child_id,device_serial,measured_at,heart_rate,oxygen_percent,battery_percent,movement,sleep_state,sock_connection,charging,alerts,provider_data)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      ON CONFLICT(family_id,child_id,device_serial,measured_at) DO NOTHING RETURNING id`,
    [
      connection.family_id, connection.child_id, connection.device_serial,
      reading.measuredAt, reading.heartRate, reading.oxygenPercent,
      reading.batteryPercent, reading.movement, reading.sleepState,
      reading.sockConnection, reading.charging, reading.alerts, reading.providerData,
    ],
  );
  if (inserted.rowCount) await evaluateOwletAlerts(inserted.rows[0].id, connection, reading);
  await pool.query(
    "UPDATE owlet_connections SET last_polled_at=now(),last_error=NULL,failure_count=0,last_duration_ms=$2,next_poll_at=greatest(now(),$3::timestamptz+interval '5 seconds') WHERE id=$1",
    [connection.id, Date.now() - started, new Date(started)],
  );
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0,180) : "Owlet collection failed";
    const status = error instanceof OwletHTTPError ? error.httpStatus : null;
    if (pollId) await pool.query("UPDATE owlet_polls SET status='error',error=$1,duration_ms=$2,http_status=$3 WHERE id=$4", [message, Date.now()-started, status, pollId]);
    else await pool.query("INSERT INTO owlet_polls(family_id,child_id,device_serial,duration_ms,status,error,http_status) VALUES($1,$2,$3,$4,'error',$5,$6)", [connection.family_id,connection.child_id,connection.device_serial,Date.now()-started,message,status]);
    throw error;
  }
}
export async function pollDueOwlet() {
  if (!owletConfigured()) return;
  const due = await pool.query(
    "SELECT id,family_id,child_id,device_serial,encrypted_tokens FROM owlet_connections WHERE next_poll_at<=now() ORDER BY next_poll_at LIMIT 4",
  );
  await Promise.all((due.rows as Connection[]).map(async (connection) => {
    const claimed = await pool.query(
      "UPDATE owlet_connections SET next_poll_at=now()+interval '90 seconds' WHERE id=$1 AND next_poll_at<=now() RETURNING id",
      [connection.id],
    );
    if (!claimed.rowCount) return;
    try {
      await collectOwlet(connection);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Owlet collection failed";
      await pool.query(
        "UPDATE owlet_connections SET last_error=$1,failure_count=failure_count+1,next_poll_at=now()+greatest(least(300,5*power(2,least(failure_count,6))),$3)*interval '1 second' WHERE id=$2",
        [message.slice(0, 180), connection.id, error instanceof OwletHTTPError && error.httpStatus === 429 ? Math.max(60,error.retrySeconds) : 0],
      );
      console.error("Owlet collection failed", connection.id, message);
    }
  }));
}

export function trustedOwletFileURL(value: string, metadata = false) {
  const url = new URL(value);
  const ayla = new URL(aylaBase);
  const isAyla = [ayla.hostname,"ads-owlnova.aylanetworks.com"].includes(url.hostname);
  const trusted = metadata ? isAyla && url.pathname.startsWith("/apiv1/") :
    isAyla || url.hostname === "proxy-owlnova-d.aylanetworks.com" || /^(?:[a-z0-9.-]+\.)?s3(?:[.-][a-z0-9-]+)?\.amazonaws\.com$/.test(url.hostname);
  if (url.protocol !== "https:" || url.username || url.password || url.port || !trusted) throw new Error("Owlet log URL is not a supported storage host");
  return url;
}
export async function downloadOwletLogs() {
  const q = await pool.query(`SELECT f.*,c.encrypted_tokens FROM owlet_log_files f JOIN owlet_connections c
    ON c.family_id=f.family_id AND c.child_id=f.child_id AND c.device_serial=f.device_serial
    WHERE f.downloaded_at IS NULL AND f.next_attempt_at<=now() ORDER BY f.discovered_at LIMIT 2`);
  for (const file of q.rows) {
    try {
      const metadataURL = trustedOwletFileURL(file.source_url, true);
      const tokens = decryptTokens(file.encrypted_tokens);
      const metadata = await requestJSON(metadataURL.href, { headers: { Authorization: `auth_token ${tokens.access}` }, redirect: "error" });
      await pool.query("UPDATE owlet_log_files SET metadata=$1 WHERE id=$2",[metadata,file.id]);
      if (typeof metadata?.datapoint?.file !== "string") throw new Error("Owlet log metadata has no file URL");
      const downloadURL = trustedOwletFileURL(metadata.datapoint.file);
      const response = await fetch(downloadURL, { redirect: "error", signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error(`Owlet log download returned status ${response.status}`);
      const chunks: Uint8Array[] = [];
      let size = 0;
      for await (const chunk of response.body as any) {
        size += chunk.length;
        if (size > 10_000_000) { await response.body?.cancel().catch(() => {}); throw new Error("Owlet log exceeds the 10 MB download limit"); }
        chunks.push(chunk);
      }
      const content = Buffer.concat(chunks);
      const format = content[0] === 0x1f && content[1] === 0x8b ? "gzip" : content.subarray(0,2).toString() === "PK" ? "zip" : /^[\[{]/.test(content.subarray(0,100).toString().trim()) ? "json-or-text" : "unknown-binary-or-text";
      metadata.archive_format = format;
      await pool.query("UPDATE owlet_log_files SET downloaded_at=now(),metadata=$1,content=$2,sha256=$3,content_type=$4,last_error=NULL,attempts=attempts+1 WHERE id=$5", [metadata,content,createHash("sha256").update(content).digest("hex"),response.headers.get("content-type"),file.id]);
    } catch (error) {
      await pool.query("UPDATE owlet_log_files SET last_error=$1,attempts=attempts+1,next_attempt_at=now()+greatest(900,$3)*interval '1 second' WHERE id=$2", [error instanceof Error ? error.message.slice(0,180) : "Owlet log download failed",file.id,error instanceof OwletHTTPError ? error.retrySeconds : 0]);
    }
  }
}
