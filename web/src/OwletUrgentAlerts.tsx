import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useRef, useState } from "react";
import { api } from "./domain/cloud";
import { refreshAlertBadge, setAlertBadge } from "./domain/badges";
import type { BabyTheme } from "./ui";
import { alertSoundReady, beep, soundEvent, stopOwletAlertSound } from "./domain/alert-sound";
export { enableOwletAlertSound } from "./domain/alert-sound";

type PendingAlert = {
  id: string;
  child_id: string;
  child_name: string;
  kind: string;
  measured_value: number;
  threshold_value: number;
  measured_at: string;
  created_at: string;
};
function label(kind: string) {
  return (
    (
      {
        oxygen_below: "Oxygen below your level",
        heart_below: "Heart rate below your level",
        heart_above: "Heart rate above your level",
        battery_below: "Sock battery below your level",
      } as Record<string, string>
    )[kind] ?? "Owlet threshold alert"
  );
}
function storedAlerts(key: string): PendingAlert[] {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(value)
      ? value
          .filter(
            (e) =>
              e &&
              /^[1-9]\d{0,18}$/.test(String(e.id)) &&
              typeof e.child_name === "string" &&
              typeof e.child_id === "string" &&
              [
                "oxygen_below",
                "heart_below",
                "heart_above",
                "battery_below",
              ].includes(e.kind) &&
              (typeof e.measured_value === "number" ||
                typeof e.measured_value === "string") &&
              (typeof e.threshold_value === "number" ||
                typeof e.threshold_value === "string") &&
              Number.isFinite(Number(e.measured_value)) &&
              Number.isFinite(Number(e.threshold_value)) &&
              typeof e.measured_at === "string" &&
              Number.isFinite(Date.parse(e.measured_at)),
          )
          .slice(0, 20)
      : [];
  } catch {
    return [];
  }
}
async function clearNotifications(ids: string[]) {
  if (!ids.length) return;
  if (!("serviceWorker" in navigator)) return;
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration) return;
  const tags = new Set(ids.map((id) => `owlet-event-${id}`));
  for (const notification of await registration.getNotifications())
    if (tags.has(notification.tag)) notification.close();
}

export function OwletUrgentAlerts({
  family,
  theme,
  inAppEnabled = true,
  settingsOpen = false,
  onOpenSettings,
  onConnection,
}: {
  family: string;
  theme: BabyTheme;
  inAppEnabled?: boolean;
  settingsOpen?: boolean;
  onOpenSettings?: () => void;
  onConnection?: (status: "connected" | "error") => void;
}) {
  const [alerts, setAlerts] = useState<PendingAlert[]>([]);
  const [error, setError] = useState("");
  const [offline, setOffline] = useState(false);
  const [accepting, setAccepting] = useState<string | null>(null);
  const [soundOn, setSoundOn] = useState(alertSoundReady());
  const accepted = useRef(new Set<string>());
  const heading = useRef<HTMLHeadingElement | null>(null);
  const active = useRef<PendingAlert[]>([]);
  const hasAlerts = alerts.length > 0;
  const storageKey = `baby-owlet-pending-${family}`;
  useEffect(() => {
    let current = true,
      pending = false;
    accepted.current = new Set();
    active.current = storedAlerts(storageKey);
    setAlerts(active.current);
    const refresh = async () => {
      if (pending || document.hidden) return;
      pending = true;
      try {
        const result = await api(
          `/owlet/active-alerts?family=${encodeURIComponent(family)}`,
        );
        if (!current) return;
        const next: PendingAlert[] = result.events.filter(
          (e: PendingAlert) => !accepted.current.has(String(e.id)),
        );
        const remaining = new Set(next.map((e) => String(e.id)));
        void clearNotifications(
          active.current
            .filter((e) => !remaining.has(String(e.id)))
            .map((e) => String(e.id)),
        ).catch(() => {});
        const changed = active.current.map(e => String(e.id)).join(",") !== next.map(e => String(e.id)).join(",");
        if (active.current.length && !next.length) stopOwletAlertSound();
        active.current = next;
        setAlerts(next);
        setOffline(false);
        onConnection?.("connected");
        if (changed) window.dispatchEvent(new Event("baby:notification-change"));
        try {
          localStorage.setItem(storageKey, JSON.stringify(next));
        } catch {
          /* Server remains the source of truth. */
        }
      } catch {
        if (current) { setOffline(true); onConnection?.("error"); }
      } finally {
        pending = false;
      }
    };
    const visible = () => {
      if (!document.hidden) void refresh();
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 1000);
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("focus", visible);
    window.addEventListener("online", visible);
    const acceptedElsewhere = (event: Event) => {
      const id = (event as CustomEvent<string>).detail;
      if (id) {
        accepted.current.add(id); active.current = active.current.filter(e => String(e.id) !== id); setAlerts(active.current);
        if (!active.current.length) stopOwletAlertSound();
        void clearNotifications([id]).catch(() => {});
        try { localStorage.setItem(storageKey, JSON.stringify(active.current)); } catch { /* Acceptance is server confirmed. */ }
      }
      void refresh();
    };
    window.addEventListener("baby:notification-accepted", acceptedElsewhere);
    return () => {
      current = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("focus", visible);
      window.removeEventListener("online", visible);
      window.removeEventListener("baby:notification-accepted", acceptedElsewhere);
    };
  }, [family, storageKey, onConnection]);
  useEffect(() => {
    const changed = () => setSoundOn(alertSoundReady());
    window.addEventListener(soundEvent, changed);
    return () => window.removeEventListener(soundEvent, changed);
  }, []);
  useEffect(() => {
    if (!hasAlerts || !active.current.length) return;
    beep();
    const timer = setInterval(() => {
      if (active.current.length) beep();
      setSoundOn(alertSoundReady());
    }, 1000);
    return () => { clearInterval(timer); stopOwletAlertSound(); };
  }, [hasAlerts, soundOn]);
  const accept = async (eventId: string) => {
    if (accepting) return;
    setAccepting(eventId);
    setError("");
    try {
      const result = await api("/owlet/accept-alert", { family, eventId });
      void setAlertBadge(result.badgeCount);
      void refreshAlertBadge();
      accepted.current.add(eventId);
      const next = active.current.filter((e) => String(e.id) !== eventId);
      active.current = next;
      if (!next.length) stopOwletAlertSound();
      setAlerts(next);
      try {
        localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        /* Acceptance is already saved on the server. */
      }
      void clearNotifications([eventId]).catch(() => {});
      window.dispatchEvent(new CustomEvent("baby:notification-accepted", { detail: eventId }));
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Could not accept. Repeats are still active.",
      );
    } finally {
      setAccepting(null);
    }
  };
  if (!hasAlerts || !inAppEnabled || settingsOpen) return null;
  return (
    <Dialog.Root open={hasAlerts}>
      <Dialog.Portal>
        <Dialog.Overlay className="owlet-urgent-backdrop" />
        <Dialog.Content
          asChild
          aria-describedby="owlet-urgent-description"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            heading.current?.focus();
          }}
          onEscapeKeyDown={(event) => event.preventDefault()}
          onPointerDownOutside={(event) => event.preventDefault()}
          onInteractOutside={(event) => event.preventDefault()}
        >
          <aside
            className={`owlet-urgent baby-sheet-theme ${theme}`}
            data-baby-theme={theme}
            aria-label="Owlet alerts awaiting acceptance"
          >
            <Dialog.Title asChild>
              <h2 ref={heading} tabIndex={-1}>
                Owlet · Accept to stop repeats
              </h2>
            </Dialog.Title>
            <Dialog.Description asChild>
              <p id="owlet-urgent-description">
                Acceptance stops repeats for your household. It does not change
                readings or alert levels.
              </p>
            </Dialog.Description>
            <div className="owlet-urgent-list">
              {alerts.map((event) => (
                <section
                  key={event.id}
                  className="owlet-urgent-event"
                  role="alert"
                >
                  <strong>
                    {event.child_name} · {label(event.kind)}
                  </strong>
                  <span>
                    {event.measured_value}
                    {event.kind.startsWith("heart_") ? " bpm" : "%"} · your
                    level {event.threshold_value}
                    {event.kind.startsWith("heart_") ? " bpm" : "%"}
                  </span>
                  <small>
                    Measured {new Date(event.measured_at).toLocaleString()}.
                    This is the triggering reading.
                  </small>
                  <button
                    type="button"
                    className="primary"
                    disabled={accepting !== null}
                    onClick={() => void accept(String(event.id))}
                  >
                    {accepting === String(event.id) ? "Accepting…" : "Accept"}
                  </button>
                </section>
              ))}
            </div>
            {onOpenSettings && <button type="button" className="more-action" onClick={onOpenSettings}>Notification settings</button>}
            <small>{soundOn ? "Sound repeats every second while this app is visible." : "Sound needs activation in Notification settings."} Phone push timing and sounds depend on your phone.</small>
            {offline && (
              <p className="owlet-urgent-error">
                Connection unavailable. Saved alerts stay active; acceptance
                requires a connection.
              </p>
            )}
            {error && (
              <p className="owlet-urgent-error" role="alert">
                {error} Repeats stay active until acceptance succeeds.
              </p>
            )}
          </aside>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
