import { identity } from "./cloud";

export type NotificationPreferences = {
  push: boolean;
  inApp: boolean;
  sound: boolean;
};
export const notificationPreferencesEvent = "baby:notification-preferences";
const defaults: NotificationPreferences = {
  push: true,
  inApp: true,
  sound: true,
};
const memory = new Map<string, NotificationPreferences>();
const key = () => `baby-notifications-v1:${identity?.user.id ?? "preview"}`;

export function notificationPreferences(): NotificationPreferences {
  const name = key();
  if (!memory.has(name)) {
    let value: Partial<NotificationPreferences> = {};
    try {
      value = JSON.parse(localStorage.getItem(name) ?? "{}");
    } catch {
      /* Use defaults. */
    }
    memory.set(
      name,
      Object.fromEntries(
        Object.entries(defaults).map(([option, fallback]) => [
          option,
          typeof value?.[option as keyof NotificationPreferences] === "boolean"
            ? value[option as keyof NotificationPreferences]
            : fallback,
        ]),
      ) as NotificationPreferences,
    );
  }
  return memory.get(name)!;
}

export function setNotificationPreferences(
  value: Partial<NotificationPreferences>,
) {
  const next = { ...notificationPreferences(), ...value };
  memory.set(key(), next);
  try {
    localStorage.setItem(key(), JSON.stringify(next));
  } catch {
    /* Keep the session choice. */
  }
  window.dispatchEvent(new Event(notificationPreferencesEvent));
}

export function notificationPreferencesChanged() {
  memory.delete(key());
  window.dispatchEvent(new Event(notificationPreferencesEvent));
}
