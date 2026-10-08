import { requireValue, text, uuid } from "./auth.ts";

/** Tombstones retain every prior ID without a quadratic scan of large imports. */
export function requireRetainedActivityIds(
  previous: readonly { id: string }[],
  incoming: readonly { id: string }[],
) {
  const incomingIds = new Set(incoming.map((activity) => activity.id));
  requireValue(
    previous.every((activity) => incomingIds.has(activity.id)),
    "Use deletion markers rather than removing records",
  );
}

const kinds = [
  "Feed",
  "Diaper",
  "Sleep",
  "Nursing",
  "Pumping",
  "Solids",
  "Growth",
  "Medication",
  "Milestone",
  "Routine",
  "Pregnancy",
  "Postpartum",
  "Spasm",
];
export function validateSnapshot(value: any) {
  requireValue(
    value &&
      Array.isArray(value.children) &&
      value.children.length <= 5 &&
      Array.isArray(value.activities) &&
      value.activities.length <= 50000,
    "Invalid family records",
  );
  const ids = new Set<string>();
  const validateFields = (fields: any, label: string) => {
    requireValue(
      typeof fields === "object" &&
        fields !== null &&
        !Array.isArray(fields) &&
        Object.keys(fields).length <= 100 &&
        Object.values(fields).every(
          (v) => typeof v === "string" && v.length <= 2000,
        ),
      `Invalid ${label}`,
    );
  };
  for (const c of value.children) {
    uuid(c.id);
    requireValue(!ids.has(c.id), "Duplicate child");
    ids.add(c.id);
    requireValue(text(c.name, 80).trim(), "Child name required");
    requireValue(
      /^\d{4}-\d{2}-\d{2}$/.test(c.birthDate) &&
        Number.isFinite(Date.parse(c.birthDate)) &&
        Date.parse(c.birthDate) <= Date.now(),
      "Invalid birth date",
    );
    text(c.sex ?? "", 80);
    if (c.naraFields !== undefined)
      validateFields(c.naraFields, "profile import fields");
  }
  const naraImports = value.naraImports ?? [];
  requireValue(
    Array.isArray(naraImports) && naraImports.length <= 10,
    "Invalid Nara imports",
  );
  const importIds = new Set<string>();
  let totalImportBytes = 0;
  for (const item of naraImports) {
    requireValue(
      item &&
        typeof item.id === "string" &&
        /^[a-f0-9]{64}$/.test(item.id) &&
        item.id === item.sha256 &&
        !importIds.has(item.id),
      "Invalid Nara import identifier",
    );
    importIds.add(item.id);
    text(item.fileName, 255);
    text(item.profileName, 80);
    uuid(item.childId);
    requireValue(ids.has(item.childId), "Unknown Nara import child");
    requireValue(
      Number.isInteger(item.byteLength) &&
        item.byteLength > 0 &&
        item.byteLength <= 5_000_000 &&
        Number.isInteger(item.importedAt) &&
        item.importedAt >= 0 &&
        item.importedAt <= Date.now() + 60000 &&
        Number.isInteger(item.rowCount) &&
        item.rowCount >= 0 &&
        item.rowCount <= 50000 &&
        Number.isInteger(item.importedCount) &&
        item.importedCount >= 0 &&
        item.importedCount <= item.rowCount &&
        Number.isInteger(item.archivedOnlyCount) &&
        item.archivedOnlyCount >= 0 &&
        item.archivedOnlyCount <= item.rowCount,
      "Invalid Nara import metadata",
    );
    requireValue(
      typeof item.contentBase64 === "string" &&
        item.contentBase64.length <= 7_000_000 &&
        /^[A-Za-z0-9+/]+={0,2}$/.test(item.contentBase64) &&
        Buffer.from(item.contentBase64, "base64").byteLength ===
          item.byteLength,
      "Invalid Nara source file",
    );
    totalImportBytes += item.contentBase64.length;
    requireValue(totalImportBytes <= 10_000_000, "Nara imports are too large");
  }
  const active = new Set();
  const activeSpasms = new Set();
  const events = new Set();
  for (const a of value.activities) {
    uuid(a.id);
    requireValue(!events.has(a.id), "Duplicate record");
    events.add(a.id);
    requireValue(kinds.includes(a.kind), "Invalid activity");
    if (a.kind === "Pregnancy" || a.kind === "Postpartum") {
      uuid(a.adultId);
      requireValue(!a.childId, "Parent records cannot belong to a child");
    } else requireValue(ids.has(a.childId), "Unknown child");
    requireValue(
      Number.isFinite(a.start) && a.start >= 0 && a.start <= Date.now() + 60000,
      "Invalid start",
    );
    if (a.end !== undefined)
      requireValue(
        Number.isFinite(a.end) &&
          a.end >= a.start &&
          a.end <= Date.now() + 60000,
        "Invalid end",
      );
    if (a.fields !== undefined) validateFields(a.fields, "activity fields");
    if (a.naraFields !== undefined)
      validateFields(a.naraFields, "activity source fields");
    if (a.naraSource !== undefined)
      requireValue(
        a.naraSource &&
          importIds.has(a.naraSource.fileHash) &&
          Number.isInteger(a.naraSource.rowNumber) &&
          a.naraSource.rowNumber >= 2 &&
          a.naraSource.rowNumber <= 50001 &&
          typeof a.naraSource.activityKey === "string" &&
          a.naraSource.activityKey.length <= 100,
        "Invalid Nara source reference",
      );
    if (a.segments)
      requireValue(
        Array.isArray(a.segments) &&
          a.segments.length < 1000 &&
          a.segments.every(
            (s: any) =>
              Number.isFinite(s.start) &&
              s.start >= a.start &&
              (s.end === undefined ||
                (Number.isFinite(s.end) && s.end >= s.start)),
          ),
        "Invalid timer segments",
      );
    text(a.detail, 2000);
    text(a.notes, 10000);
    text(a.author, 100);
    if (a.amount !== undefined)
      requireValue(
        Number.isFinite(a.amount) && a.amount > 0 && a.amount <= 3000,
        "Invalid amount",
      );
    if (a.kind === "Sleep" && !a.end && !a.deleted) {
      requireValue(!active.has(a.childId), "Sleep timer already active");
      active.add(a.childId);
    }
    if (a.kind === "Spasm" && !a.end && !a.deleted) {
      requireValue(
        !activeSpasms.has(a.childId),
        "Spasm episode already active",
      );
      activeSpasms.add(a.childId);
    }
  }
  return { children: value.children, activities: value.activities, naraImports };
}
