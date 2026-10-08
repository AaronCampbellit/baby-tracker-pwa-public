import { api, identity, familyId } from "./cloud.ts";
export type Kind =
  | "Feed"
  | "Diaper"
  | "Sleep"
  | "Nursing"
  | "Pumping"
  | "Solids"
  | "Growth"
  | "Medication"
  | "Milestone"
  | "Routine"
  | "Pregnancy"
  | "Postpartum"
  | "Spasm";
export type Activity = {
  id: string;
  childId?: string;
  adultId?: string;
  authorId?: string;
  kind: Kind;
  start: number;
  end?: number;
  timer?: boolean;
  segments?: { start: number; end?: number; side?: string }[];
  amount?: number;
  detail: string;
  notes: string;
  fields?: Record<string, string>;
  naraFields?: Record<string, string>;
  naraSource?: { fileHash: string; rowNumber: number; activityKey: string };
  author: string;
  deleted?: boolean;
};
export type Child = {
  id: string;
  name: string;
  birthDate: string;
  sex: string;
  naraFields?: Record<string, string>;
};
export type NaraArchive = {
  id: string;
  fileName: string;
  sha256: string;
  contentBase64: string;
  byteLength: number;
  importedAt: number;
  profileName: string;
  childId: string;
  rowCount: number;
  importedCount: number;
  archivedOnlyCount: number;
};
export type State = {
  version: 1;
  children: Child[];
  selected: string;
  activities: Activity[];
  naraImports: NaraArchive[];
  reminderMinutes: number;
  theme: "light" | "dark";
  demo: boolean;
};
export function elapsed(start: number, end = Date.now()) {
  return Math.max(0, end - start);
}
export function timerElapsed(a: Activity, now = Date.now()) {
  return a.segments
    ? a.segments.reduce(
        (total, s) =>
          total +
          elapsed(s.start, Math.min(s.end ?? a.end ?? now, a.end ?? now)),
        0,
      )
    : elapsed(a.start, a.end ?? now);
}
export function duration(ms: number) {
  const seconds = Math.floor(Math.max(0, ms) / 1000);
  return [
    Math.floor(seconds / 3600),
    Math.floor(seconds / 60) % 60,
    seconds % 60,
  ]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
}
export function age(birth: string) {
  const now = new Date();
  const date = new Date(birth + "T12:00:00");
  const months = Math.max(
    0,
    (now.getFullYear() - date.getFullYear()) * 12 +
      now.getMonth() -
      date.getMonth() -
      (now.getDate() < date.getDate() ? 1 : 0),
  );
  return months < 24 ? `${months} months` : `${Math.floor(months / 12)} years`;
}
export function todayKey(time: number) {
  const d = new Date(time);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function seed(): State {
  const now = Date.now();
  const birth = new Date();
  birth.setMonth(birth.getMonth() - 4);
  return {
    version: 1,
    children: [
      {
        id: "oliver",
        name: "Oliver",
        birthDate: todayKey(+birth),
        sex: "Not specified",
      },
    ],
    selected: "oliver",
    activities: [
      {
        id: "sample-feed",
        childId: "oliver",
        kind: "Feed",
        start: now - 45 * 60000,
        amount: 120,
        detail: "Breast milk",
        notes: "",
        author: "Alex",
      },
      {
        id: "sample-diaper",
        childId: "oliver",
        kind: "Diaper",
        start: now - 20 * 60000,
        detail: "Wet",
        notes: "",
        author: "Alex",
      },
    ],
    naraImports: [],
    reminderMinutes: 1,
    theme: "light",
    demo: true,
  };
}
let dbPromise: Promise<IDBDatabase> | undefined;
function database() {
  return (dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open("did-i-feed-my-baby", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("state");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
}
export async function load(): Promise<State> {
  const db = await database();
  const cached = await new Promise<State | undefined>((resolve, reject) => {
    const req = db
      .transaction("state")
      .objectStore("state")
      .get(identity ? `${familyId}:${identity.user.id}` : "main");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  if (cached) return { ...cached, naraImports: cached.naraImports ?? [] };
  if (!identity) return seed();
  const result = await api("/families/" + familyId);
  const next: State = {
    ...seed(),
    demo: false,
    ...result.snapshot,
    selected: result.snapshot.children[0]?.id ?? "",
    reminderMinutes: identity.reminderMinutes,
  };
  await write(next, {
    revision: result.revision,
    remoteHash: JSON.stringify(result.snapshot),
  });
  return next;
}
type Meta = {
  revision: number;
  remoteHash: string;
  pending?: string;
  inFlight?: {
    id: string;
    revision: number;
    snapshot: {
      children: Child[];
      activities: Activity[];
      naraImports: NaraArchive[];
    };
  };
  conflict?: boolean;
};
let writeQueue = Promise.resolve();
let syncing: Promise<void> | undefined;
let syncRequested = false;
export let syncStatus = "Local preview";
const snapshot = (s: State) => ({
  children: s.children,
  activities: s.activities,
  naraImports: s.naraImports ?? [],
});
const fingerprint = (s: State) => JSON.stringify(snapshot(s));
const key = () => (identity ? `${familyId}:${identity.user.id}` : "main");
async function pair() {
  const db = await database();
  return new Promise<{ state: State; meta: Meta }>((resolve, reject) => {
    const tx = db.transaction("state");
    const a = tx.objectStore("state").get(key());
    const b = tx.objectStore("state").get(key() + ":meta");
    tx.oncomplete = () =>
      resolve({
        state: a.result,
        meta: b.result ?? { revision: 0, remoteHash: "" },
      });
    tx.onerror = () => reject(tx.error);
  });
}
async function write(state: State, meta: Meta) {
  const db = await database();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction("state", "readwrite");
    tx.objectStore("state").put(state, key());
    tx.objectStore("state").put(meta, key() + ":meta");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
function serial<T>(fn: () => Promise<T>) {
  const next = writeQueue.then(fn);
  writeQueue = next.then(() => {}, () => {});
  return next;
}
function status(s: string) {
  syncStatus = s;
  window.dispatchEvent(new Event("baby:status"));
}
export async function persist(value: State) {
  if (identity) status("Saving…");
  await serial(async () => {
    const { meta } = await pair();
    const f = fingerprint(value);
    if (identity && f !== meta.remoteHash) meta.pending = crypto.randomUUID();
    await write(value, meta);
  });
  if (identity) void sync();
}
// Selection belongs to this caregiver's device. Merge it into the latest stored
// records so an older rendered view cannot overwrite a sync or pending edits.
export async function selectChild(childId: string): Promise<State> {
  return serial(async () => {
    const current = await pair();
    if (!current.state || !current.state.children.some(child => child.id === childId))
      throw new Error("This child is no longer available. Refresh your household.");
    const next = { ...current.state, selected: childId };
    await write(next, current.meta);
    return next;
  });
}
export function sync(): Promise<void> {
  if (!identity) return Promise.resolve();
  if (syncing) {
    syncRequested = true;
    return syncing;
  }
  syncing = synchronize().finally(() => {
    syncing = undefined;
    if (syncRequested && identity && !["Needs review", "Sign in required"].includes(syncStatus)) {
      syncRequested = false;
      void sync();
    } else syncRequested = false;
  });
  return syncing;
}

async function synchronize() {
  let more = false;
  try {
    await writeQueue;
    let before = await pair();
    if (!before.state) return;
    if (before.meta.conflict) {
      status("Needs review");
      return;
    }
    status(navigator.onLine ? "Syncing…" : "Saved offline");
    if (!navigator.onLine) return;
    if (before.meta.pending && !before.meta.inFlight) {
      await serial(async () => {
        const current = await pair();
        current.meta.inFlight = {
          id: current.meta.pending!,
          revision: current.meta.revision,
          snapshot: snapshot(current.state),
        };
        await write(current.state, current.meta);
      });
      before = await pair();
    }
    const flight = before.meta.inFlight;
    const path = "/families/" + familyId;
    const result = flight
      ? await api(path + "/sync", {
          operationId: flight.id,
          revision: flight.revision,
          snapshot: flight.snapshot,
        })
      : await api(path);
    await serial(async () => {
      const current = await pair();
      const unchanged = flight
        ? JSON.stringify(snapshot(current.state)) ===
          JSON.stringify(flight.snapshot)
        : !current.meta.pending;
      if (!unchanged) {
        await write(current.state, {
          ...current.meta,
          inFlight: undefined,
          revision: result.revision,
          remoteHash: JSON.stringify(result.snapshot),
        });
        more = true;
        return;
      }
      const next = {
        ...current.state,
        ...result.snapshot,
        selected: result.snapshot.children.some(
          (c: Child) => c.id === current.state.selected,
        )
          ? current.state.selected
          : (result.snapshot.children[0]?.id ?? ""),
      };
      await write(next, {
        revision: result.revision,
        remoteHash: JSON.stringify(result.snapshot),
      });
      window.dispatchEvent(new CustomEvent("baby:cloud", { detail: next }));
    });
    status(more ? "Syncing…" : "Synced");
  } catch (e: any) {
    if (e.status === 409) {
      await serial(async () => {
        const p = await pair();
        await write(p.state, { ...p.meta, conflict: true });
      });
      status("Needs review");
    } else if (e.status === 401 || e.status === 403) {
      status("Sign in required");
      // An expired login must not erase unsynced care records. The same account
      // can resume its existing outbox after signing in. Revoked access clears it.
      if (e.status === 403) await clearLocal();
      window.dispatchEvent(new Event("baby:unauthorized"));
    } else status("Saved offline — retrying");
  } finally {
    if (more) syncRequested = true;
  }
}
export async function acceptRemote() {
  const result = await api("/families/" + familyId);
  await serial(async () => {
    const p = await pair();
    await write(
      {
        ...p.state,
        ...result.snapshot,
        selected: result.snapshot.children[0]?.id ?? "",
      },
      {
        revision: result.revision,
        remoteHash: JSON.stringify(result.snapshot),
      },
    );
  });
  window.dispatchEvent(new CustomEvent("baby:cloud", { detail: await load() }));
  status("Synced");
}
export async function clearLocal() {
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("state", "readwrite");
    tx.objectStore("state").delete(key());
    tx.objectStore("state").delete(key() + ":meta");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
export function sleepForDay(events: Activity[], date: Date): number {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return events
    .filter((a) => a.kind === "Sleep" && a.end && !a.deleted)
    .reduce(
      (sum, a) =>
        sum + Math.max(0, Math.min(a.end!, +end) - Math.max(a.start, +start)),
      0,
    );
}
export function exportCSV(events: Activity[]) {
  const cell = (x: unknown) =>
    '"' +
    String(x ?? "")
      .replace(/^[=+@\-]/, "'$&")
      .replaceAll('"', '""') +
    '"';
  return [
    [
      "id",
      "child_id",
      "activity",
      "start",
      "end",
      "amount_ml",
      "detail",
      "notes",
      "author",
      "adult_id",
      "fields_json",
      "nara_fields_json",
    ],
    ...events
      .filter((a) => !a.deleted)
      .map((a) => [
        a.id,
        a.childId,
        a.kind,
        new Date(a.start).toISOString(),
        a.end ? new Date(a.end).toISOString() : "",
        a.amount,
        a.detail,
        a.notes,
        a.author,
        a.adultId,
        JSON.stringify(a.fields ?? {}),
        JSON.stringify(a.naraFields ?? {}),
      ]),
  ]
    .map((row) => row.map(cell).join(","))
    .join("\r\n");
}
