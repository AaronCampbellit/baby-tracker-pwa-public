import { familyId, identity } from "./cloud";
import type { Activity, Child, Kind, State } from "./store";

const templateHeaders = [
  "Type",
  "Profile Name",
  "Start Date/time",
  "Start Date/time (Epoch)",
  "Created By Caregiver",
  "Last Updated By Caregiver",
  "Note",
  "Time Zone",
  "[Medical] Medication",
  "[Medical] Temperature",
  "[Medical] Temperature Unit",
  "[Growth] Head Size",
  "[Growth] Head Size Unit",
  "[Growth] Height",
  "[Growth] Height Unit",
  "[Growth] Weight",
  "[Growth] Weight Unit",
  "[Pump] Duration (Seconds)",
  "[Pump] End Date/time",
  "[Pump] End Date/time (Epoch)",
  "[Pump] Left Volume",
  "[Pump] Left Volume Unit",
  "[Pump] Right Volume",
  "[Pump] Right Volume Unit",
  "[Pump] Total Volume",
  "[Pump] Total Volume Unit",
  "[Bottle Feed] Type",
  "[Bottle Feed] Breast Milk Volume",
  "[Bottle Feed] Breast Milk Volume Unit",
  "[Bottle Feed] Formula Name",
  "[Bottle Feed] Formula Volume",
  "[Bottle Feed] Formula Volume Unit",
  "[Bottle Feed] Volume",
  "[Bottle Feed] Volume Unit",
  "[Diaper] Type",
  "[Diaper] Detail",
  "[Diaper] Dirty Color",
  "[Diaper] Dirty Texture",
  "[Solid Feed] Food",
  "[Solid Feed] Meal",
  "[Sleep] Duration (Seconds)",
  "[Sleep] End Date/time",
  "[Sleep] End Date/time (Epoch)",
  "[Breastfeed] Begin Side",
  "[Breastfeed] End Side",
  "[Breastfeed] Left Duration (Seconds)",
  "[Breastfeed] Right Duration (Seconds)",
  "[Routine] Routine",
  "[Combo Feed] Begin Side",
  "[Combo Feed] End Side",
  "[Combo Feed] Left Duration (Seconds)",
  "[Combo Feed] Right Duration (Seconds)",
  "[Combo Feed] Type",
  "[Combo Feed] Breast Milk Volume",
  "[Combo Feed] Breast Milk Volume Unit",
  "[Combo Feed] Formula Name",
  "[Combo Feed] Formula Volume",
  "[Combo Feed] Formula Volume Unit",
  "[Combo Feed] Volume",
  "[Combo Feed] Volume Unit",
  "[Baby First] Baby First",
  "[Vaccine] Vaccine",
  "[Milestone] Milestone",
  "[Profile] Birth Date",
  "[Profile] Birth Date (Adjusted)",
  "[Profile] Sex",
  "[Profile] Type",
  "_familyKey",
  "_profileKey",
  "_activityKey",
];

const naraTypeKinds: Record<string, Kind> = {
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

type Row = Record<string, string>;

function stableId(value: string) {
  return crypto.subtle
    .digest("SHA-256", new TextEncoder().encode(value))
    .then((digest) => {
      const bytes = new Uint8Array(digest).slice(0, 16);
      bytes[6] = (bytes[6] & 0x0f) | 0x50;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex = Array.from(bytes, (byte) =>
        byte.toString(16).padStart(2, "0"),
      );
      return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
    });
}

function csvCell(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

function rowFrom(source?: Record<string, string>): Row {
  return { ...source };
}

function zoneFor(row: Row) {
  return row["Time Zone"] || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function timestampInZone(value: number, zone: string) {
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
  } catch {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
  }
  const parts = Object.fromEntries(
    formatter.formatToParts(new Date(value)).map(({ type, value: part }) => [
      type,
      part,
    ]),
  );
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

function naraType(activity: Activity, row: Row) {
  const sourceType = row.Type;
  if (
    activity.kind === "Feed" &&
    ["Mixed", "Formula", "Breast milk"].includes(activity.detail)
  )
    return activity.detail === "Mixed" ? "Combo Feed" : "Bottle Feed";
  if (sourceType && naraTypeKinds[sourceType] === activity.kind)
    return sourceType;
  switch (activity.kind) {
    case "Feed":
      return activity.detail === "Mixed" ? "Combo Feed" : "Bottle Feed";
    case "Nursing":
      return "Breastfeed";
    case "Pumping":
      return "Pump";
    case "Diaper":
      return "Diaper";
    case "Sleep":
      return "Sleep";
    case "Medication":
      return activity.fields?.vaccine ? "Vaccine" : "Medical";
    case "Growth":
      return "Growth";
    case "Solids":
      return "Solid Feed";
    case "Routine":
      return "Routine";
    case "Milestone":
      return "Milestone";
    case "Spasm":
      return "Medical";
    case "Pregnancy":
    case "Postpartum":
      return "";
  }
}

function durationSeconds(activity: Activity) {
  if (activity.end === undefined) return "";
  return String(Math.max(0, Math.round((activity.end - activity.start) / 1000)));
}

function nursingSideSeconds(activity: Activity, side: string) {
  if (activity.segments?.length) {
    const total = activity.segments
      .filter((segment) => segment.side?.toLowerCase() === side.toLowerCase())
      .reduce(
        (sum, segment) =>
          sum +
          Math.max(
            0,
            (segment.end ?? activity.end ?? Date.now()) - segment.start,
          ),
        0,
      );
    return String(Math.round(total / 1000));
  }
  const sideField = activity.fields?.side?.toLowerCase();
  if (sideField === side.toLowerCase() || sideField === "both") {
    const minutes = Number(activity.fields?.minutes);
    if (Number.isFinite(minutes) && minutes > 0)
      return String(Math.round((sideField === "both" ? minutes / 2 : minutes) * 60));
  }
  return "0";
}

function sourceAmount(row: Row, type: string) {
  const prefix = type === "Pump" ? "[Pump] Total" : `[${type}]`;
  const value = Number(row[`${prefix} Volume`]);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function sourceDescription(source: Record<string, string>, type: string) {
  const parts: string[] = [];
  const add = (label: string, value: string | undefined) => {
    if (value) parts.push(label ? `${label}: ${value}` : value);
  };
  const volume = (prefix: string) => {
    const value = source[`${prefix} Volume`];
    const unit = source[`${prefix} Volume Unit`];
    return value ? `${value}${unit ? ` ${unit}` : ""}` : "";
  };
  switch (type) {
    case "Breastfeed":
      add("", (source["[Breastfeed] Begin Side"] ?? "").toLowerCase());
      add("End side", source["[Breastfeed] End Side"]);
      break;
    case "Bottle Feed":
    case "Combo Feed": {
      const prefix = `[${type}]`;
      add("", source[`${prefix} Type`]);
      add("Breast milk", volume(`${prefix} Breast Milk`));
      add("Formula", volume(`${prefix} Formula`));
      add("Volume", volume(prefix));
      add("Formula name", source[`${prefix} Formula Name`]);
      break;
    }
    case "Pump":
      add("Left", volume("[Pump] Left"));
      add("Right", volume("[Pump] Right"));
      add("Total", volume("[Pump] Total"));
      break;
    case "Diaper":
      add("", source["[Diaper] Type"]);
      add("Detail", source["[Diaper] Detail"]);
      add("Color", source["[Diaper] Dirty Color"]);
      add("Texture", source["[Diaper] Dirty Texture"]);
      break;
    case "Medical":
      add("", source["[Medical] Medication"]);
      add(
        "Temperature",
        [source["[Medical] Temperature"], source["[Medical] Temperature Unit"]]
          .filter(Boolean)
          .join(" "),
      );
      break;
    case "Growth":
      add(
        "Weight",
        [source["[Growth] Weight"], source["[Growth] Weight Unit"]]
          .filter(Boolean)
          .join(" "),
      );
      add(
        "Height",
        [source["[Growth] Height"], source["[Growth] Height Unit"]]
          .filter(Boolean)
          .join(" "),
      );
      add(
        "Head size",
        [source["[Growth] Head Size"], source["[Growth] Head Size Unit"]]
          .filter(Boolean)
          .join(" "),
      );
      break;
    case "Solid Feed":
      add("Food", source["[Solid Feed] Food"]);
      add("Meal", source["[Solid Feed] Meal"]);
      break;
    case "Routine":
      add("", source["[Routine] Routine"]);
      break;
    case "Baby First":
      add("", source["[Baby First] Baby First"]);
      break;
    case "Vaccine":
      add("Vaccine", source["[Vaccine] Vaccine"]);
      break;
    case "Milestone":
      add("", source["[Milestone] Milestone"]);
      break;
  }
  return parts.join(" · ") || type;
}

function setAmount(row: Row, type: string, amount: number) {
  if (!Number.isFinite(amount) || amount <= 0) return;
  const prefix = type === "Pump" ? "[Pump] Total" : `[${type}]`;
  row[`${prefix} Volume`] = String(amount);
  row[`${prefix} Volume Unit`] = "ML";
}

function noteFor(activity: Activity, type: string) {
  const lines = activity.notes ? [activity.notes] : [];
  const mappedFields: Record<Kind, string[]> = {
    Feed: [],
    Diaper: ["rash"],
    Sleep: [],
    Nursing: ["side", "minutes"],
    Pumping: ["side", "minutes"],
    Solids: ["food", "reaction"],
    Growth: ["weight", "height", "head"],
    Medication: ["medicine", "vaccine"],
    Milestone: ["milestone"],
    Routine: ["routine"],
    Pregnancy: [],
    Postpartum: [],
    Spasm: ["features"],
  };
  const extraFields = Object.entries(activity.fields ?? {}).filter(
    ([key, value]) => value && !mappedFields[activity.kind].includes(key),
  );
  if (activity.kind === "Spasm") {
    lines.push("Did I Feed My Baby? · Spasm episode");
    const features = (activity.fields?.features ?? "")
      .split("|")
      .filter(Boolean);
    if (features.length) lines.push(`Signs noticed: ${features.join(", ")}`);
    const elapsed = durationSeconds(activity);
    if (elapsed) lines.push(`Duration: ${elapsed} seconds`);
    else if (!activity.end) lines.push("Episode was active at export time");
    if (activity.detail && activity.detail !== "Spasm episode")
      lines.push(`Details: ${activity.detail}`);
  } else if (
    activity.kind === "Diaper" &&
    activity.naraFields &&
    activity.fields?.rash === "Yes" &&
    !/rash/i.test(activity.naraFields["[Diaper] Detail"] ?? "")
  ) {
    lines.push("Rash: Yes");
  } else if (activity.detail) {
    const sourceType = activity.naraFields?.Type;
    if (activity.naraFields && sourceType) {
      if (activity.detail !== sourceDescription(activity.naraFields, sourceType))
        lines.push(`Updated details: ${activity.detail}`);
    } else if (!["Feed", "Diaper", "Nursing", "Pumping"].includes(activity.kind)) {
      lines.push(`Details: ${activity.detail}`);
    }
  }
  if (extraFields.length)
    lines.push(
      `Additional fields: ${extraFields.map(([key, value]) => `${key}=${value}`).join("; ")}`,
    );
  if (type === "Medical" && activity.fields?.dose)
    lines.push(`Dose: ${activity.fields.dose}`);
  return lines.join("\n");
}

function applyCanonicalFields(activity: Activity, type: string, row: Row) {
  const fields = activity.fields ?? {};
  const put = (key: string, value: string | undefined) => {
    if (value !== undefined) row[key] = value;
  };
  const isCombo = type === "Combo Feed";
  const feedPrefix = isCombo ? "[Combo Feed]" : "[Bottle Feed]";
  switch (activity.kind) {
    case "Feed": {
      if (
        !activity.naraFields ||
        ["Mixed", "Formula", "Breast milk"].includes(activity.detail)
      )
        put(`${feedPrefix} Type`, activity.detail || "Bottle");
      const priorAmount = sourceAmount(row, type);
      if (activity.amount !== undefined && activity.amount !== priorAmount)
        setAmount(row, type, activity.amount);
      if (
        type === "Combo Feed" &&
        (activity.segments?.length || fields.side || fields.minutes)
      ) {
        const prefix = "[Combo Feed]";
        const segments = activity.segments ?? [];
        const firstSide = segments.find((segment) => segment.side)?.side ?? fields.side;
        const endSide = [...segments].reverse().find((segment) => segment.side)?.side;
        put(`${prefix} Begin Side`, firstSide?.toUpperCase());
        put(`${prefix} End Side`, endSide?.toUpperCase() ?? firstSide?.toUpperCase());
        put(`${prefix} Left Duration (Seconds)`, nursingSideSeconds(activity, "Left"));
        put(`${prefix} Right Duration (Seconds)`, nursingSideSeconds(activity, "Right"));
      }
      break;
    }
    case "Nursing": {
      const prefix = "[Breastfeed]";
      const segments = activity.segments ?? [];
      const firstSide = segments.find((segment) => segment.side)?.side ?? fields.side;
      const endSide = [...segments].reverse().find((segment) => segment.side)?.side;
      put(`${prefix} Begin Side`, firstSide?.toUpperCase());
      put(`${prefix} End Side`, endSide?.toUpperCase() ?? firstSide?.toUpperCase());
      put(`${prefix} Left Duration (Seconds)`, nursingSideSeconds(activity, "Left"));
      put(`${prefix} Right Duration (Seconds)`, nursingSideSeconds(activity, "Right"));
      break;
    }
    case "Pumping": {
      const side = fields.side?.toLowerCase();
      if (activity.amount !== undefined && activity.amount !== sourceAmount(row, type)) {
        if (side === "left") setAmount(row, type, activity.amount);
        else if (side === "right") setAmount(row, type, activity.amount);
        else setAmount(row, type, activity.amount);
      }
      if (activity.amount !== undefined && !row["[Pump] Total Volume"]) {
        row["[Pump] Total Volume"] = String(activity.amount);
        row["[Pump] Total Volume Unit"] = "ML";
      }
      if (side === "left") {
        put("[Pump] Left Volume", String(activity.amount ?? ""));
        put("[Pump] Left Volume Unit", "ML");
      } else if (side === "right") {
        put("[Pump] Right Volume", String(activity.amount ?? ""));
        put("[Pump] Right Volume Unit", "ML");
      }
      break;
    }
    case "Diaper":
      if (
        !activity.naraFields ||
        ["Wet", "Dirty", "Both", "Dry"].includes(activity.detail)
      )
        put("[Diaper] Type", activity.detail);
      if (fields.rash !== undefined && !activity.naraFields)
        put("[Diaper] Detail", fields.rash === "Yes" ? "Rash" : "");
      break;
    case "Sleep":
      break;
    case "Medication":
      if (!activity.naraFields || fields.vaccine || fields.medicine) {
        if (type === "Vaccine") put("[Vaccine] Vaccine", fields.vaccine || activity.detail);
        else put("[Medical] Medication", fields.medicine || activity.detail);
      }
      break;
    case "Growth":
      if (fields.weight) {
        put("[Growth] Weight", fields.weight);
        put("[Growth] Weight Unit", "KG");
      }
      if (fields.height) {
        put("[Growth] Height", fields.height);
        put("[Growth] Height Unit", "CM");
      }
      if (fields.head) {
        put("[Growth] Head Size", fields.head);
        put("[Growth] Head Size Unit", "CM");
      }
      break;
    case "Solids":
      if (fields.food || !activity.naraFields)
        put("[Solid Feed] Food", fields.food || activity.detail);
      if (fields.reaction !== undefined)
        put("[Solid Feed] Meal", fields.reaction);
      break;
    case "Routine":
      if (fields.routine || !activity.naraFields)
        put("[Routine] Routine", fields.routine || activity.detail);
      break;
    case "Milestone":
      if (type === "Baby First" && (fields.milestone || !activity.naraFields))
        put("[Baby First] Baby First", fields.milestone || activity.detail);
      else if (fields.milestone || !activity.naraFields)
        put("[Milestone] Milestone", fields.milestone || activity.detail);
      break;
    case "Spasm":
      put("[Medical] Medication", "Spasm episode");
      break;
    case "Pregnancy":
    case "Postpartum":
      break;
  }
}

function setTimes(activity: Activity, row: Row, type: string) {
  const zone = zoneFor(row);
  const originalStart = Number(row["Start Date/time (Epoch)"]);
  if (originalStart !== activity.start) {
    row["Start Date/time"] = timestampInZone(activity.start, zone);
    row["Start Date/time (Epoch)"] = String(Math.trunc(activity.start));
  }
  row["Time Zone"] = zone;
  const endPrefix = type === "Sleep" ? "[Sleep]" : type === "Pump" ? "[Pump]" : "";
  if (endPrefix) {
    const epochKey = `${endPrefix} End Date/time (Epoch)`;
    const dateKey = `${endPrefix} End Date/time`;
    const durationKey = `${endPrefix} Duration (Seconds)`;
    const originalEnd = Number(row[epochKey]);
    if (activity.end === undefined) {
      row[epochKey] = "";
      row[dateKey] = "";
      row[durationKey] = "";
    } else if (originalEnd !== activity.end) {
      row[epochKey] = String(Math.trunc(activity.end));
      row[dateKey] = timestampInZone(activity.end, zone);
      row[durationKey] = durationSeconds(activity);
    }
  }
}

function profileRow(child: Child, familyKey: string, profileKey: string): Row {
  const row = rowFrom(child.naraFields);
  row.Type = "Profile";
  row["Profile Name"] = child.name;
  row["[Profile] Birth Date"] = child.birthDate;
  row["[Profile] Sex"] =
    child.sex === "Not specified"
      ? row["[Profile] Sex"] ?? ""
      : child.sex.toUpperCase();
  row["[Profile] Type"] ||= "CHILD";
  row._familyKey = familyKey;
  row._profileKey = profileKey;
  return row;
}

function activityRow(
  activity: Activity,
  child: Child,
  familyKey: string,
  profileKey: string,
  activityKey: string,
): Row | undefined {
  const row = rowFrom(activity.naraFields);
  const sourceType = row.Type;
  const type = naraType(activity, row);
  if (!type) return undefined;
  if (sourceType && sourceType !== type) {
    const oldPrefix = `[${sourceType}]`;
    for (const header of Object.keys(row))
      if (header.startsWith(oldPrefix)) row[header] = "";
  }
  row.Type = type;
  row["Profile Name"] = child.name;
  row._familyKey = familyKey;
  row._profileKey = profileKey;
  row._activityKey = activityKey;
  row["Created By Caregiver"] =
    row["Created By Caregiver"] || activity.author || identity?.user.name || "";
  row["Last Updated By Caregiver"] =
    row["Last Updated By Caregiver"] || identity?.user.name || activity.author || "";
  row.Note = noteFor(activity, type);
  applyCanonicalFields(activity, type, row);
  setTimes(activity, row, type);
  if (type === "Sleep") {
    const originalDuration = row["[Sleep] Duration (Seconds)"];
    if (activity.end !== undefined && !originalDuration)
      row["[Sleep] Duration (Seconds)"] = durationSeconds(activity);
  }
  if (type === "Pump") {
    const originalDuration = row["[Pump] Duration (Seconds)"];
    if (activity.end !== undefined && !originalDuration)
      row["[Pump] Duration (Seconds)"] = durationSeconds(activity);
  }
  return row;
}

export async function exportNaraCSV(state: State, childId: string) {
  const child = state.children.find((candidate) => candidate.id === childId);
  if (!child) throw new Error("Choose a child to export.");
  const householdFamilyKey =
    state.children
      .map((candidate) => candidate.naraFields?._familyKey)
      .find(Boolean) ??
    (await stableId(`nara-family:${familyId || state.children[0]?.id || child.id}`));
  const familyKey = child.naraFields?._familyKey || householdFamilyKey;
  const profileKey =
    child.naraFields?._profileKey || (await stableId(`nara-profile:${child.id}`));
  const rows: Row[] = [profileRow(child, familyKey, profileKey)];
  const activities = state.activities
    .filter((activity) => activity.childId === child.id && !activity.deleted)
    .sort((first, second) => first.start - second.start);
  for (const activity of activities) {
    const activityKey =
      activity.naraFields?._activityKey ||
      activity.naraSource?.activityKey ||
      (/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(activity.id)
        ? activity.id
        : await stableId(`nara-activity:${activity.id}`));
    const row = activityRow(activity, child, familyKey, profileKey, activityKey);
    if (row) rows.push(row);
  }
  const extraHeaders = new Set<string>();
  for (const row of rows)
    for (const header of Object.keys(row))
      if (!templateHeaders.includes(header)) extraHeaders.add(header);
  const headers = [
    ...templateHeaders,
    ...[...extraHeaders].sort((first, second) => first.localeCompare(second)),
  ];
  return [
    headers.map(csvCell).join(","),
    ...rows.map((row) => headers.map((header) => csvCell(row[header] ?? "")).join(",")),
  ].join("\r\n");
}
