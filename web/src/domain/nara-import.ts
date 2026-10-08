import type { Activity, Child, Kind, NaraArchive, State } from "./store";

type Row = Record<string, string>;

export type NaraPreview = {
  file: File;
  fileName: string;
  sha256: string;
  byteLength: number;
  profileName: string;
  profileKey: string;
  familyKey: string;
  birthDate: string;
  sex: string;
  profileFields: Record<string, string>;
  activityCount: number;
  typeCounts: Record<string, number>;
  unassignedPumpKeys: string[];
  unsupportedTypes: string[];
};

export type NaraImportResult = {
  children: Child[];
  activities: Activity[];
  naraImports: NaraArchive[];
  selectedChildId: string;
  importedCount: number;
  duplicateCount: number;
  archivedOnlyCount: number;
};

const maxFileBytes = 5_000_000;
const kinds: Record<string, Kind> = {
  Breastfeed: "Nursing",
  "Bottle Feed": "Feed",
  "Combo Feed": "Feed",
  Pump: "Pumping",
  Diaper: "Diaper",
  Sleep: "Sleep",
  Medical: "Medication",
  Growth: "Growth",
  "Solid Feed": "Solids",
  Routine: "Routine",
  "Baby First": "Milestone",
  Vaccine: "Medication",
  Milestone: "Milestone",
};

function parseCsv(text: string): { headers: string[]; rows: Row[] } {
  const records: string[][] = [];
  let record: string[] = [];
  let value = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const character = text[i];
    if (quoted) {
      if (character === '"' && text[i + 1] === '"') {
        value += '"';
        i += 1;
      } else if (character === '"') quoted = false;
      else value += character;
      continue;
    }
    if (character === '"') {
      if (value.length) throw new Error("The CSV contains an invalid quote.");
      quoted = true;
    } else if (character === ",") {
      record.push(value);
      value = "";
    } else if (character === "\r" || character === "\n") {
      record.push(value);
      if (record.length !== 1 || record[0] !== "") records.push(record);
      record = [];
      value = "";
      if (character === "\r" && text[i + 1] === "\n") i += 1;
    } else value += character;
  }
  if (quoted) throw new Error("The CSV has an unterminated quoted value.");
  if (value.length || record.length) {
    record.push(value);
    if (record.length !== 1 || record[0] !== "") records.push(record);
  }
  if (records.length < 2) throw new Error("The CSV has no activity rows.");
  const headers = records[0].map((header, index) =>
    index === 0 ? header.replace(/^\uFEFF/, "") : header,
  );
  if (headers.some((header) => !header) || new Set(headers).size !== headers.length)
    throw new Error("The CSV has a blank or duplicate column name.");
  const rows = records.slice(1).map((cells, index) => {
    if (cells.length > headers.length)
      throw new Error(`CSV row ${index + 2} has more cells than the header.`);
    return Object.fromEntries(
      headers.map((header, column) => [header, cells[column] ?? ""]),
    );
  });
  return { headers, rows };
}

function nonEmptyFields(row: Row): Record<string, string> {
  return Object.fromEntries(
    Object.entries(row).filter(([, value]) => value !== ""),
  );
}

function requiredText(row: Row, column: string) {
  const value = row[column]?.trim();
  if (!value) throw new Error(`The Nara profile is missing ${column}.`);
  return value;
}

function digestBytes(bytes: Uint8Array) {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return crypto.subtle.digest("SHA-256", buffer);
}

function sha256(bytes: Uint8Array) {
  return digestBytes(bytes).then((digest) =>
    Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join(""),
  );
}

async function readFile(file: File) {
  if (file.size > maxFileBytes)
    throw new Error(`${file.name} is larger than the 5 MB import limit.`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  return { bytes, text };
}

export async function inspectNaraFile(file: File): Promise<NaraPreview> {
  const { bytes, text } = await readFile(file);
  const { headers, rows } = parseCsv(text);
  for (const required of ["Type", "Profile Name", "_familyKey", "_activityKey"])
    if (!headers.includes(required))
      throw new Error(`${file.name} is missing the “${required}” Nara column.`);
  const profileRows = rows.filter((row) => row.Type === "Profile");
  if (profileRows.length !== 1)
    throw new Error(
      `${file.name} must contain exactly one Nara Profile row. Split multi-profile exports before importing.`,
    );
  const profileRow = profileRows[0];
  const profileNames = new Set(
    rows.map((row) => row["Profile Name"]).filter(Boolean),
  );
  const profileKeys = new Set(
    rows.map((row) => row._profileKey).filter(Boolean),
  );
  const familyKeys = new Set(
    rows.map((row) => row._familyKey).filter(Boolean),
  );
  if (profileNames.size > 1 || profileKeys.size !== 1 || familyKeys.size !== 1)
    throw new Error(
      `${file.name} contains multiple or incomplete child/family identities.`,
    );
  const typeCounts: Record<string, number> = {};
  for (const row of rows) {
    if (row.Type === "Profile") continue;
    typeCounts[row.Type] = (typeCounts[row.Type] ?? 0) + 1;
  }
  const unsupportedTypes = Object.keys(typeCounts).filter((type) => !kinds[type]);
  const unassignedPumpKeys = rows
    .filter(
      (row) => row.Type === "Pump" && !row["Profile Name"] && !row._profileKey,
    )
    .map((row, index) =>
      row._activityKey
        ? `${row._familyKey}:${row._activityKey}`
        : `${file.name}:pump:${index}`,
    );
  return {
    file,
    fileName: file.name,
    sha256: await sha256(bytes),
    byteLength: bytes.byteLength,
    profileName:
      profileRow["Profile Name"] || [...profileNames][0] || file.name,
    profileKey: requiredText(profileRow, "_profileKey"),
    familyKey: requiredText(profileRow, "_familyKey"),
    birthDate: profileRow["[Profile] Birth Date"] ?? "",
    sex: profileRow["[Profile] Sex"] ?? "",
    profileFields: nonEmptyFields(profileRow),
    activityCount: rows.length - profileRows.length,
    typeCounts,
    unassignedPumpKeys,
    unsupportedTypes,
  };
}

function base64(bytes: Uint8Array) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function epoch(value: string) {
  if (!value) return undefined;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0)
    return numeric < 100_000_000_000 ? numeric * 1000 : numeric;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function seconds(row: Row, key: string) {
  const value = Number(row[key]);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function uuidFromDigest(digest: Uint8Array) {
  const bytes = digest.slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}

async function naraActivityId(familyKey: string, activityKey: string) {
  const digest = await digestBytes(
    new TextEncoder().encode(`${familyKey}:${activityKey}`),
  );
  return uuidFromDigest(new Uint8Array(digest));
}

function volume(row: Row, prefix: string) {
  const value = row[`${prefix} Volume`];
  const unit = row[`${prefix} Volume Unit`];
  return value ? `${value}${unit ? ` ${unit}` : ""}` : "";
}

function activityDetail(type: string, row: Row) {
  const parts: string[] = [];
  const add = (label: string, value: string) => {
    if (value) parts.push(label ? `${label}: ${value}` : value);
  };
  switch (type) {
    case "Breastfeed":
      add("", (row["[Breastfeed] Begin Side"] ?? "").toLowerCase());
      add("End side", row["[Breastfeed] End Side"]);
      break;
    case "Bottle Feed":
      add("", row["[Bottle Feed] Type"]);
      add("Breast milk", volume(row, "[Bottle Feed] Breast Milk"));
      add("Formula", volume(row, "[Bottle Feed] Formula"));
      add("Volume", volume(row, "[Bottle Feed]"));
      add("Formula name", row["[Bottle Feed] Formula Name"]);
      break;
    case "Combo Feed":
      add("", row["[Combo Feed] Type"]);
      add("Breast milk", volume(row, "[Combo Feed] Breast Milk"));
      add("Formula", volume(row, "[Combo Feed] Formula"));
      add("Volume", volume(row, "[Combo Feed]"));
      add("Formula name", row["[Combo Feed] Formula Name"]);
      break;
    case "Pump":
      add("Left", volume(row, "[Pump] Left"));
      add("Right", volume(row, "[Pump] Right"));
      add("Total", volume(row, "[Pump] Total"));
      break;
    case "Diaper":
      add("", row["[Diaper] Type"]);
      add("Detail", row["[Diaper] Detail"]);
      add("Color", row["[Diaper] Dirty Color"]);
      add("Texture", row["[Diaper] Dirty Texture"]);
      break;
    case "Medical":
      add("", row["[Medical] Medication"]);
      add(
        "Temperature",
        [row["[Medical] Temperature"], row["[Medical] Temperature Unit"]]
          .filter(Boolean)
          .join(" "),
      );
      break;
    case "Growth":
      add(
        "Weight",
        [row["[Growth] Weight"], row["[Growth] Weight Unit"]]
          .filter(Boolean)
          .join(" "),
      );
      add(
        "Height",
        [row["[Growth] Height"], row["[Growth] Height Unit"]]
          .filter(Boolean)
          .join(" "),
      );
      add(
        "Head size",
        [row["[Growth] Head Size"], row["[Growth] Head Size Unit"]]
          .filter(Boolean)
          .join(" "),
      );
      break;
    case "Solid Feed":
      add("Food", row["[Solid Feed] Food"]);
      add("Meal", row["[Solid Feed] Meal"]);
      break;
    case "Routine":
      add("", row["[Routine] Routine"]);
      break;
    case "Baby First":
      add("", row["[Baby First] Baby First"]);
      break;
    case "Vaccine":
      add("Vaccine", row["[Vaccine] Vaccine"]);
      break;
    case "Milestone":
      add("", row["[Milestone] Milestone"]);
      break;
  }
  return parts.join(" · ") || type;
}

function amountMl(row: Row, type: string) {
  const prefix = type === "Pump" ? "[Pump] Total" : `[${type}]`;
  const value = row[`${prefix} Volume`];
  const unit = row[`${prefix} Volume Unit`];
  if (!value || unit !== "ML") return undefined;
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 && amount <= 3000
    ? amount
    : undefined;
}

function timerSegments(row: Row, type: string, start: number) {
  const prefix = type === "Breastfeed" ? "[Breastfeed]" : "[Combo Feed]";
  const leftSeconds = seconds(row, `${prefix} Left Duration (Seconds)`);
  const rightSeconds = seconds(row, `${prefix} Right Duration (Seconds)`);
  if (!leftSeconds && !rightSeconds) return undefined;
  const begin = (row[`${prefix} Begin Side`] ?? "").toUpperCase();
  const firstSide = begin === "RIGHT" ? "Right" : "Left";
  const sideDurations = [
    [firstSide, firstSide === "Left" ? leftSeconds : rightSeconds] as const,
    [firstSide === "Left" ? "Right" : "Left", firstSide === "Left" ? rightSeconds : leftSeconds] as const,
  ];
  let cursor = start;
  return sideDurations.flatMap(([side, secondsForSide]) => {
    if (!secondsForSide) return [];
    const segment = {
      start: cursor,
      end: cursor + secondsForSide * 1000,
      side,
    };
    cursor = segment.end;
    return [segment];
  });
}

function mappedActivity(
  row: Row,
  kind: Kind,
  id: string,
  childId: string,
  fileHash: string,
  rowNumber: number,
  activityKey: string,
): Activity {
  const type = row.Type;
  const start = epoch(row["Start Date/time (Epoch)"]) ?? epoch(row["Start Date/time"]);
  if (start === undefined)
    throw new Error(`Nara record ${rowNumber} has no valid start time.`);
  const endPrefix = type === "Sleep" ? "[Sleep]" : type === "Pump" ? "[Pump]" : "";
  const rawEnd = endPrefix
    ? epoch(row[`${endPrefix} End Date/time (Epoch)`]) ??
      epoch(row[`${endPrefix} End Date/time`])
    : undefined;
  const durationSeconds = endPrefix
    ? seconds(row, `${endPrefix} Duration (Seconds)`)
    : 0;
  const segments =
    type === "Breastfeed" || type === "Combo Feed"
      ? timerSegments(row, type, start)
      : undefined;
  const end =
    rawEnd ??
    (durationSeconds
      ? start + durationSeconds * 1000
      : segments?.length
        ? segments.at(-1)!.end
        : undefined);
  const detail = activityDetail(type, row);
  const fields: Record<string, string> = {};
  const note = row.Note ?? "";
  if (type === "Breastfeed" || type === "Combo Feed") {
    const side = row[`[${type}] Begin Side`]?.toLowerCase();
    const totalSeconds =
      seconds(row, `[${type}] Left Duration (Seconds)`) +
      seconds(row, `[${type}] Right Duration (Seconds)`);
    if (side) fields.side = side[0].toUpperCase() + side.slice(1);
    if (totalSeconds) fields.minutes = String(Math.round(totalSeconds / 60));
  }
  if (type === "Diaper")
    fields.rash = /rash/i.test(row["[Diaper] Detail"] ?? "") ? "Yes" : "No";
  if (type === "Solid Feed") {
    if (row["[Solid Feed] Food"]) fields.food = row["[Solid Feed] Food"];
    if (row["[Solid Feed] Meal"]) fields.reaction = row["[Solid Feed] Meal"];
  }
  if (type === "Routine" && row["[Routine] Routine"])
    fields.routine = row["[Routine] Routine"];
  if (type === "Medical" && row["[Medical] Medication"])
    fields.medicine = row["[Medical] Medication"];
  if (type === "Vaccine" && row["[Vaccine] Vaccine"])
    fields.vaccine = row["[Vaccine] Vaccine"];
  if (type === "Milestone" && row["[Milestone] Milestone"])
    fields.milestone = row["[Milestone] Milestone"];
  if (type === "Baby First" && row["[Baby First] Baby First"])
    fields.milestone = row["[Baby First] Baby First"];
  return {
    id,
    childId,
    kind,
    start,
    end,
    segments,
    amount: amountMl(row, type),
    detail,
    notes: note,
    fields,
    naraFields: nonEmptyFields(row),
    naraSource: {
      fileHash,
      rowNumber,
      activityKey,
    },
    author: row["Created By Caregiver"] || "Nara import",
  };
}

function validBirthDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = Date.parse(`${value}T12:00:00Z`);
  return Number.isFinite(parsed) && parsed <= Date.now();
}

function normalizedSex(value: string) {
  const normalized = value.trim().toLowerCase();
  if (normalized === "female" || normalized === "f") return "Female";
  if (normalized === "male" || normalized === "m") return "Male";
  if (normalized === "intersex") return "Intersex";
  return "Not specified";
}

export async function importNaraFiles(
  previews: NaraPreview[],
  targets: Record<string, string>,
  unassignedPumpTarget: string,
  state: State,
): Promise<NaraImportResult> {
  if (!previews.length) throw new Error("Choose at least one Nara CSV.");
  if (previews.length > 5) throw new Error("Import up to five CSV files at once.");
  if (new Set(previews.map((preview) => preview.sha256)).size !== previews.length)
    throw new Error("The same Nara CSV was selected more than once.");
  const currentArchiveSize = (state.naraImports ?? []).reduce(
    (total, archive) => total + archive.contentBase64.length,
    0,
  );
  const newArchiveSize = previews.reduce(
    (total, preview) => total + 4 * Math.ceil(preview.byteLength / 3),
    0,
  );
  if (currentArchiveSize + newArchiveSize > 10_000_000)
    throw new Error(
      "The preserved Nara files would exceed the 10 MB household archive limit. Export a JSON backup before removing old Nara archives.",
    );
  const duplicateFile = previews.find((preview) =>
    (state.naraImports ?? []).some((archive) => archive.id === preview.sha256),
  );
  if (duplicateFile)
    throw new Error(`${duplicateFile.fileName} has already been imported.`);
  const selectedTargets = previews.map((preview) => targets[preview.sha256]);
  if (selectedTargets.some((target) => !target))
    throw new Error("Choose a child for every Nara profile.");
  const mappedTargets = selectedTargets.filter((target) => target !== "new");
  if (new Set(mappedTargets).size !== mappedTargets.length)
    throw new Error("Each Nara profile must map to a different child.");
  const unassignedKeys = new Set(
    previews.flatMap((preview) => preview.unassignedPumpKeys),
  );
  if (unassignedKeys.size && !unassignedPumpTarget)
    throw new Error("Choose how to handle Pump records without a child profile.");

  const children = [...state.children];
  const childByFile = new Map<string, string>();
  for (let i = 0; i < previews.length; i += 1) {
    const preview = previews[i];
    const selected = selectedTargets[i];
    if (selected === "new") {
      if (children.length >= 5)
        throw new Error("A household can have no more than five children.");
      if (!validBirthDate(preview.birthDate))
        throw new Error(
          `${preview.profileName} has a missing or invalid Nara birth date. Choose an existing child or correct the source export.`,
        );
      const child: Child = {
        id: crypto.randomUUID(),
        name: preview.profileName.slice(0, 80),
        birthDate: preview.birthDate,
        sex: normalizedSex(preview.sex),
        naraFields: preview.profileFields,
      };
      children.push(child);
      childByFile.set(preview.sha256, child.id);
    } else {
      const index = children.findIndex((child) => child.id === selected);
      if (index < 0) throw new Error("A selected child is no longer available.");
      const child = children[index];
      if (!validBirthDate(preview.birthDate))
        throw new Error(
          `${preview.profileName} has a missing or invalid Nara birth date.`,
        );
      children[index] = {
        ...child,
        name: preview.profileName.slice(0, 80),
        birthDate: preview.birthDate,
        sex: normalizedSex(preview.sex),
        naraFields: { ...child.naraFields, ...preview.profileFields },
      };
      childByFile.set(preview.sha256, child.id);
    }
  }

  const activities = [...state.activities];
  const existingById = new Map(activities.map((activity) => [activity.id, activity]));
  let importedCount = 0;
  let duplicateCount = 0;
  let archivedOnlyCount = 0;
  const naraImports = [...(state.naraImports ?? [])];
  for (const preview of previews) {
    if (preview.unsupportedTypes.length)
      throw new Error(
        `${preview.fileName} has unsupported Nara categories: ${preview.unsupportedTypes.join(", ")}. No records were imported.`,
      );
    const { bytes, text } = await readFile(preview.file);
    const parsed = parseCsv(text);
    const childId = childByFile.get(preview.sha256)!;
    const archive: NaraArchive = {
      id: preview.sha256,
      fileName: preview.fileName,
      sha256: preview.sha256,
      contentBase64: base64(bytes),
      byteLength: bytes.byteLength,
      importedAt: Date.now(),
      profileName: preview.profileName,
      childId,
      rowCount: preview.activityCount,
      importedCount: 0,
      archivedOnlyCount: 0,
    };
    for (let i = 0; i < parsed.rows.length; i += 1) {
      const row = parsed.rows[i];
      if (row.Type === "Profile") continue;
      const kind = kinds[row.Type];
      if (!kind)
        throw new Error(`Unsupported Nara category “${row.Type}” in ${preview.fileName}.`);
      const unassignedPump =
        row.Type === "Pump" && !row["Profile Name"] && !row._profileKey;
      const sourceKey = row._activityKey || `${preview.sha256}:${i + 2}`;
      const id = await naraActivityId(row._familyKey || preview.familyKey, sourceKey);
      if (unassignedPump && unassignedPumpTarget === "archive-only") {
        if (existingById.has(id)) {
          duplicateCount += 1;
          continue;
        }
        existingById.set(id, { id } as Activity);
        archive.archivedOnlyCount += 1;
        archivedOnlyCount += 1;
        continue;
      }
      const targetChild = unassignedPump
        ? unassignedPumpTarget.startsWith("profile:")
          ? childByFile.get(unassignedPumpTarget.slice("profile:".length)) ?? ""
          : unassignedPumpTarget
        : childId;
      if (!targetChild || targetChild === "new")
        throw new Error("Choose a child for the unassigned Pump records.");
      const prior = existingById.get(id);
      if (prior) {
        if (prior.naraSource?.activityKey === sourceKey) {
          duplicateCount += 1;
          continue;
        }
        throw new Error("A Nara activity key conflicts with an existing record.");
      }
      const activity = mappedActivity(
        row,
        kind,
        id,
        targetChild,
        preview.sha256,
        i + 2,
        sourceKey,
      );
      activities.push(activity);
      existingById.set(id, activity);
      archive.importedCount += 1;
      importedCount += 1;
    }
    naraImports.push(archive);
  }
  return {
    children,
    activities,
    naraImports,
    selectedChildId: childByFile.get(previews[0].sha256)!,
    importedCount,
    duplicateCount,
    archivedOnlyCount,
  };
}
