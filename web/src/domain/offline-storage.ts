export type OfflineStorageStatus = {
  state: "checking" | "persistent" | "best-effort" | "unavailable";
  usage?: number;
  quota?: number;
};
export let offlineStorageStatus: OfflineStorageStatus = { state: "checking" };
let checking: Promise<void> | undefined;

export function checkOfflineStorage() {
  return (checking ??= inspect().finally(() => {
    checking = undefined;
  }));
}

async function inspect() {
  const storage = navigator.storage;
  let state: OfflineStorageStatus["state"] = "unavailable";
  if (storage?.persisted) {
    try {
      const protectedAlready = await storage.persisted();
      const granted =
        protectedAlready || (storage.persist ? await storage.persist() : false);
      state = granted ? "persistent" : "best-effort";
    } catch {
      state = "best-effort";
    }
  }
  let estimate: StorageEstimate = {};
  try {
    estimate = (await storage?.estimate?.()) ?? {};
  } catch {
    /* Storage still works without estimates. */
  }
  offlineStorageStatus = {
    state,
    usage: estimate.usage,
    quota: estimate.quota,
  };
  window.dispatchEvent(new Event("baby:storage"));
}

// iOS has no Background Sync: retry while visible, immediately on reconnect/resume.
export function watchReconnection(upload: () => Promise<void>) {
  const visible = () => {
    if (!document.hidden) {
      void upload();
      void checkOfflineStorage();
    }
  };
  const tick = () => {
    if (!document.hidden) void upload();
  };
  const timer = setInterval(tick, 5000);
  window.addEventListener("online", visible);
  window.addEventListener("focus", visible);
  window.addEventListener("pageshow", visible);
  document.addEventListener("visibilitychange", visible);
  visible();
  return () => {
    clearInterval(timer);
    window.removeEventListener("online", visible);
    window.removeEventListener("focus", visible);
    window.removeEventListener("pageshow", visible);
    document.removeEventListener("visibilitychange", visible);
  };
}
