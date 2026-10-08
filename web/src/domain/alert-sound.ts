import {
  notificationPreferences,
  notificationPreferencesEvent,
} from "./notification-preferences";

let sound: AudioContext | undefined;
const playing = new Set<OscillatorNode>();
export const soundEvent = "baby:owlet-sound";
export const alertSoundReady = () => sound?.state === "running";

export async function enableOwletAlertSound(preview = true) {
  if (!("AudioContext" in window))
    throw new Error(
      "Sound is unavailable in this browser. Enable phone notifications instead.",
    );
  if (!sound || sound.state === "closed") {
    sound = new AudioContext();
    sound.addEventListener("statechange", () =>
      window.dispatchEvent(new Event(soundEvent)),
    );
  }
  await sound.resume();
  if (!alertSoundReady())
    throw new Error("Tap Enable alert sound while the app is open.");
  window.dispatchEvent(new Event(soundEvent));
  if (preview) beep();
}

export function beep() {
  if (
    !notificationPreferences().sound ||
    !sound ||
    sound.state !== "running" ||
    document.hidden
  )
    return;
  const oscillator = sound.createOscillator(),
    gain = sound.createGain(),
    at = sound.currentTime;
  oscillator.frequency.setValueAtTime(880, at);
  oscillator.frequency.setValueAtTime(660, at + 0.14);
  gain.gain.setValueAtTime(0, at);
  gain.gain.linearRampToValueAtTime(0.08, at + 0.02);
  gain.gain.setValueAtTime(0.08, at + 0.22);
  gain.gain.linearRampToValueAtTime(0, at + 0.28);
  oscillator.connect(gain);
  gain.connect(sound.destination);
  oscillator.start(at);
  playing.add(oscillator);
  oscillator.stop(at + 0.3);
  oscillator.onended = () => {
    playing.delete(oscillator);
    oscillator.disconnect();
    gain.disconnect();
  };
  navigator.vibrate?.([100, 60, 100]);
}

export function stopOwletAlertSound() {
  for (const oscillator of playing) oscillator.stop();
  playing.clear();
  navigator.vibrate?.(0);
}

export function watchAlertSound() {
  const arm = (event: Event) => {
    if (
      event.isTrusted &&
      notificationPreferences().sound &&
      !alertSoundReady()
    )
      void enableOwletAlertSound(false).catch(() => {});
  };
  const resume = () => {
    if (notificationPreferences().sound && sound && !document.hidden)
      void sound.resume().catch(() => {});
    else if (!notificationPreferences().sound)
      void sound?.suspend().catch(() => {});
  };
  window.addEventListener("click", arm, { passive: true });
  window.addEventListener("keydown", arm);
  window.addEventListener(notificationPreferencesEvent, resume);
  document.addEventListener("visibilitychange", resume);
  return () => {
    window.removeEventListener("click", arm);
    window.removeEventListener("keydown", arm);
    window.removeEventListener(notificationPreferencesEvent, resume);
    document.removeEventListener("visibilitychange", resume);
  };
}
