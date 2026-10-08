import { api, identity } from "./cloud";
import {
  notificationPreferences,
  setNotificationPreferences,
  notificationPreferencesEvent,
} from "./notification-preferences";

export type DevicePushStatus = {
  state:
    | "enabled"
    | "available"
    | "blocked"
    | "unavailable"
    | "off"
    | "checking"
    | "error";
  message: string;
};
const permissionBlocked =
  "Notifications are blocked. Allow them for this app in this device’s notification settings, then reopen the app.";
class PushUnavailable extends Error {}
const declarativePushManager = () =>
  (window as Window & { pushManager?: PushManager }).pushManager;

function unavailable(): string | null {
  if (!identity?.pushEnabled)
    return "Notification delivery is not configured on the server.";
  if (!window.isSecureContext)
    return "Notifications need a secure HTTPS connection.";
  const appleMobile =
    /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const installed =
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: fullscreen)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  if (appleMobile && !installed)
    return "On iPhone or iPad, add this app to the Home Screen with Open as Web App enabled, then open that installed app to enable notifications.";
  if (
    (!("serviceWorker" in navigator) && !declarativePushManager()) ||
    !("Notification" in window)
  )
    return appleMobile
      ? "Notifications are unavailable in this app on this device. Check that iOS or iPadOS is 16.4 or later and that notifications are allowed."
      : "Notifications are unavailable in this browser. Update it and check that notifications are allowed.";
  return null;
}

async function registration(): Promise<ServiceWorkerRegistration> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async () => {
        if (!(await navigator.serviceWorker.getRegistration()))
          await navigator.serviceWorker.register("/sw.js");
        const reg = await navigator.serviceWorker.ready;
        // Check the registration's capability; the global constructor need not exist.
        if (!reg.pushManager)
          throw new PushUnavailable(
            "Push notifications are unavailable in this app on this device. Update the device and reopen the installed app.",
          );
        return reg;
      })(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () =>
            reject(
              new Error(
                "Notification setup did not finish. Check your connection, reopen the app and try again.",
              ),
            ),
          8000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

async function devicePushManager(): Promise<PushManager> {
  // New iOS exposes subscription management without waiting for a worker, which
  // may have been removed by storage cleanup. Older iOS uses the registration.
  return declarativePushManager() ?? (await registration()).pushManager;
}

export async function devicePushStatus(): Promise<DevicePushStatus> {
  const problem = unavailable();
  if (problem) return { state: "unavailable", message: problem };
  if (Notification.permission === "denied")
    return { state: "blocked", message: permissionBlocked };
  let manager: PushManager;
  try {
    manager = await devicePushManager();
  } catch (error) {
    if (error instanceof PushUnavailable)
      return { state: "unavailable", message: error.message };
    throw error;
  }
  if (Notification.permission === "granted") {
    const subscription = await manager.getSubscription();
    if (subscription) {
      const status = await api("/push/status", {
        endpoint: subscription.endpoint,
      });
      if (status.registered)
        return {
          state: "enabled",
          message: "Notifications enabled on this device for your account.",
        };
    }
  }
  return {
    state: "available",
    message: "Notifications are off for your account on this device.",
  };
}

export async function enablePush() {
  setNotificationPreferences({ push: true });
  const problem = unavailable();
  if (problem) throw new Error(problem);
  // Safari requires requesting permission directly from the button's user gesture.
  // Do not await service worker setup before this call.
  const permission = await Notification.requestPermission();
  if (permission !== "granted")
    throw new Error(
      permission === "denied"
        ? permissionBlocked
        : "Permission was not granted. Tap Enable notifications again and choose Allow.",
    );
  await reconciliation?.promise.catch(() => {});
  const status = await reconcilePushRegistration();
  if (status.state !== "enabled") throw new Error(status.message);
}

const offStatus: DevicePushStatus = {
  state: "off",
  message: "Phone notifications are off on this device.",
};
let reconciliation:
  { user: string; promise: Promise<DevicePushStatus> } | undefined;

export function reconcilePushRegistration(): Promise<DevicePushStatus> {
  const user = identity?.user.id;
  if (!user) return Promise.resolve(offStatus);
  if (reconciliation?.user === user) return reconciliation.promise;
  const promise = (async (): Promise<DevicePushStatus> => {
    if (!notificationPreferences().push) {
      await unregisterDevice(user);
      return offStatus;
    }
    // Refresh server capabilities and keys on return, including after key rotation.
    const me = await api("/me");
    if (identity?.user.id !== user || me.user?.id !== user) return offStatus;
    identity.pushEnabled = me.pushEnabled;
    identity.vapidPublicKey = me.vapidPublicKey;
    const problem = unavailable();
    if (problem) return { state: "unavailable", message: problem };
    if (Notification.permission === "denied")
      return { state: "blocked", message: permissionBlocked };
    let manager: PushManager;
    try {
      manager = await devicePushManager();
    } catch (error) {
      if (error instanceof PushUnavailable)
        return { state: "unavailable", message: error.message };
      throw error;
    }
    if (Notification.permission !== "granted")
      return {
        state: "available",
        message:
          "Phone notifications are on, but this device still needs your permission.",
      };
    let subscription = await manager.getSubscription();
    let status = subscription
      ? await api("/push/status", { endpoint: subscription.endpoint })
      : null;
    const key = Uint8Array.from(
      atob(identity.vapidPublicKey.replaceAll("-", "+").replaceAll("_", "/")),
      (c) => c.charCodeAt(0),
    );
    const previousKey = subscription?.options?.applicationServerKey;
    const keyChanged =
      previousKey &&
      (new Uint8Array(previousKey).length !== key.length ||
        new Uint8Array(previousKey).some((b, i) => b !== key[i]));
    if (identity?.user.id !== user || !notificationPreferences().push)
      return offStatus;
    if (subscription && (status?.expired || keyChanged)) {
      if (!(await subscription.unsubscribe()))
        throw new Error(
          "Could not renew this device’s registration. Tap Enable notifications to retry.",
        );
      subscription = null;
      status = null;
    }
    subscription ??= await manager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: key,
    });
    if (identity?.user.id !== user || !notificationPreferences().push)
      return offStatus;
    if (!status?.registered) await api("/push", subscription.toJSON());
    return {
      state: "enabled",
      message:
        status?.lastStatus >= 400 || status?.retryAt
          ? "Notifications are registered. The push service is retrying delivery automatically."
          : "Notifications enabled on this device for your account.",
    };
  })().finally(() => {
    if (reconciliation?.promise === promise) reconciliation = undefined;
  });
  reconciliation = { user, promise };
  return promise;
}

async function unregisterDevice(user: string) {
  if (
    identity?.user.id !== user ||
    !("Notification" in window) ||
    Notification.permission !== "granted"
  )
    return;
  const subscription = await (await devicePushManager()).getSubscription();
  if (identity?.user.id !== user || notificationPreferences().push) return;
  if (subscription) {
    await api("/push", { endpoint: subscription.endpoint }, "DELETE");
    await subscription.unsubscribe();
  }
}

export async function disablePush() {
  const user = identity?.user.id;
  setNotificationPreferences({ push: false });
  await reconciliation?.promise.catch(() => {});
  if (user) await unregisterDevice(user);
}

export function watchPushRegistration(
  onStatus: (status: DevicePushStatus) => void,
) {
  let current = true,
    pending = false,
    failures = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const check = async () => {
    if (!current || pending || document.hidden) return;
    clearTimeout(timer);
    pending = true;
    try {
      const result = await reconcilePushRegistration();
      if (current)
        onStatus(notificationPreferences().push ? result : offStatus);
      failures = result.state === "unavailable" ? failures + 1 : 0;
    } catch (error) {
      failures++;
      if (current)
        onStatus({
          state: "error",
          message:
            (error as { status?: number }).status === 401
              ? "Sign in again to reconnect notifications."
              : "Could not reconnect phone notifications. Retrying automatically; you can also tap Repair connection.",
        });
    } finally {
      pending = false;
      if (current)
        timer = setTimeout(
          () => void check(),
          failures
            ? Math.min(60000, 3000 * 2 ** Math.min(failures - 1, 5))
            : 60000,
        );
    }
  };
  const returned = () => {
    if (!document.hidden) void check();
  };
  void check();
  window.addEventListener("focus", returned);
  window.addEventListener("online", returned);
  document.addEventListener("visibilitychange", returned);
  window.addEventListener(notificationPreferencesEvent, returned);
  return () => {
    current = false;
    clearTimeout(timer);
    window.removeEventListener("focus", returned);
    window.removeEventListener("online", returned);
    document.removeEventListener("visibilitychange", returned);
    window.removeEventListener(notificationPreferencesEvent, returned);
  };
}

export async function testPush() {
  const problem = unavailable();
  if (problem) throw new Error(problem);
  if (Notification.permission !== "granted")
    throw new Error("Enable notifications on this device first.");
  const subscription = await (await devicePushManager()).getSubscription();
  if (!subscription)
    throw new Error("Enable notifications on this device first.");
  try {
    await api("/push/test", { endpoint: subscription.endpoint });
  } catch (error) {
    if ((error as { status?: number }).status === 410)
      await subscription.unsubscribe().catch(() => {});
    throw error;
  }
}
