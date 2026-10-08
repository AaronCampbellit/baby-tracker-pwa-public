export type Identity = {
  user: { id: string; name: string; email: string };
  families: { id: string; name: string; role: string }[];
  reminderMinutes: number;
  quickActions?: string[] | null;
  pushEnabled: boolean;
  vapidPublicKey: string;
};
export let identity: Identity | null = null;
export let familyId = "";
export function configureCloud(me: Identity, family: string) {
  identity = me;
  familyId = family;
}
export function clearCloud() {
  identity = null;
  familyId = "";
}
export async function api(path: string, data?: unknown, method?: "POST" | "DELETE") {
  const r = await fetch("/api" + path, {
    credentials: "same-origin",
    method: method ?? (data === undefined ? "GET" : "POST"),
    headers: data === undefined ? {} : { "Content-Type": "application/json" },
    body: data === undefined ? undefined : JSON.stringify(data),
    signal: AbortSignal.timeout(12000),
  });
  const b = await r.json();
  if (!r.ok)
    throw Object.assign(new Error(b.error ?? "Request failed"), {
      status: r.status,
    });
  return b;
}
