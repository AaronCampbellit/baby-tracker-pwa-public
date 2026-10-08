type Properties = Record<string, { value?: unknown }>;

function chargingFlag(value: unknown, modern = false): boolean | null {
  // Dream Sock's chg=2 is a charging/docked state (including a full battery).
  // Verified in the upstream charging fixture and live device reports. Do not
  // coerce arbitrary nonzero values to true. Legacy CHARGE_STATUS remains 0/1.
  if (modern && (value === 2 || value === "2")) return true;
  if (value === true || value === 1 || value === "1") return true;
  if (value === false || value === 0 || value === "0") return false;
  return null;
}

// Only Owlet's explicit charging fields are evidence. Never infer charging from
// battery level, no readings, sock-off, lost connection, or disabled base alerts.
export function owletCharging(properties: Properties): boolean | null {
  let vitals: Record<string, unknown> = {};
  if (properties.REAL_TIME_VITALS?.value !== undefined) {
    try {
      const parsed = JSON.parse(String(properties.REAL_TIME_VITALS.value));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
        return null;
      vitals = parsed;
    } catch {
      return null;
    }
  }
  const hasModern = Object.hasOwn(vitals, "chg");
  const hasLegacy = Object.hasOwn(properties, "CHARGE_STATUS");
  const modern = chargingFlag(vitals.chg, true);
  const legacy = chargingFlag(properties.CHARGE_STATUS?.value);
  // Conflicting or invalid fields are uncertain, so they must not silence alerts.
  if (hasModern && hasLegacy)
    return modern !== null && modern === legacy ? modern : null;
  return hasModern ? modern : hasLegacy ? legacy : null;
}

// Share this exact policy between pending alerts and every push-delivery check.
// New polls supersede old ones even when vital-reading timestamps are unchanged.
// A failed/missing/invalid poll has charging=NULL and cannot keep a pause alive.
export function owletAlertsAllowedSQL(alias: "e" | "ee" = "e") {
  return `NOT EXISTS (
    SELECT 1 FROM owlet_connections charging_connection
    JOIN LATERAL (
      SELECT charging,fetched_at FROM owlet_polls
      WHERE family_id=charging_connection.family_id AND child_id=charging_connection.child_id
        AND device_serial=charging_connection.device_serial
        AND fetched_at>=now()-interval '30 seconds'
      ORDER BY fetched_at DESC,id DESC LIMIT 1
    ) charging_poll ON true
    WHERE charging_connection.family_id=${alias}.family_id
      AND charging_connection.child_id=${alias}.child_id
      AND charging_poll.charging IS TRUE AND charging_poll.fetched_at<=now()
  )`;
}
