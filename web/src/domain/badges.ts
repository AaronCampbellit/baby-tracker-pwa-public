import { api, identity } from "./cloud";

let revision = 0;
let pending = false;

export async function setAlertBadge(count: number) {
  if (!Number.isSafeInteger(count) || count < 0) return;
  revision++;
  try {
    if (count === 0 && navigator.clearAppBadge) await navigator.clearAppBadge();
    else if (navigator.setAppBadge) await navigator.setAppBadge(count);
    else return;
  } catch {
    // The OS owns badge permission. A failed badge must not block care logging.
  }
}

export async function refreshAlertBadge() {
  if (
    pending ||
    !identity ||
    document.hidden ||
    !navigator.onLine ||
    !navigator.setAppBadge
  )
    return;
  if ("Notification" in window && Notification.permission === "denied") return;
  pending = true;
  const user = identity.user.id;
  const before = revision;
  try {
    const result = await api("/push/badge");
    if (identity?.user.id === user && revision === before)
      await setAlertBadge(result.count);
  } catch {
    // Keep the last known count offline; zero is only written after confirmation.
  } finally {
    pending = false;
  }
}

export async function clearAlertBadge() {
  revision++;
  await setAlertBadge(0);
}
