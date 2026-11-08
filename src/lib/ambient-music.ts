/**
 * One soft-instrumental playlist shared by every page, tab and browser.
 *
 * Instead of storing playback state per browser, every client derives the same
 * track and offset from the wall clock: a fixed-length slot per track, counted
 * from one UTC epoch. Two screens opened minutes apart therefore land on the
 * same song at the same second, and the playlist advances and loops on its own.
 */

export type AmbientTrack = { id: string; title: string };

export const AMBIENT_TRACKS: AmbientTrack[] = [
  { id: "DlAZxnpsFdo", title: "Modern Hymns · instrumental" },
  { id: "-qgdYQtIvNU", title: "Peaceful prayer · piano & cello" },
  { id: "4wZmRQcIDME", title: "Calm · soaking worship" },
  { id: "9WKoTAddjIY", title: "Yeshua · piano & pad" },
  { id: "FjM95SBwGc0", title: "Hallelujah · deep soaking" },
  { id: "2qzR5e4YWrw", title: "Alone with God · instrumental" },
  { id: "5OWlWRZz3VU", title: "Under His wings · instrumental" },
  { id: "JT9aSnNYRjc", title: "Yeshua · prophetic instrumental" },
];

export const ENABLED_KEY = "kh-ambient-enabled";
export const UNLOCK_EVENT = "kh-hope-unlock";
export const AMBIENT_EVENT = "kh-ambient-change";

/** Long ambient compilations, so a 15-minute slot never runs past a track. */
export const SLOT_SECONDS = 15 * 60;
/** Quiet background bed: 20% of the player's range. */
export const AMBIENT_VOLUME = 20;

const EPOCH = Date.UTC(2026, 0, 1, 0, 0, 0);
const SLOT_MS = SLOT_SECONDS * 1000;
const LEGACY_KEYS = ["kh-staff-login-sound", "kh-display-sound"];

export type AmbientSlot = {
  index: number;
  track: AmbientTrack;
  elapsed: number;
  remaining: number;
  slot: number;
};

/** The same result in every browser at the same instant. */
export function ambientSlot(now = Date.now()): AmbientSlot {
  const slot = Math.floor((now - EPOCH) / SLOT_MS);
  const index = ((slot % AMBIENT_TRACKS.length) + AMBIENT_TRACKS.length) % AMBIENT_TRACKS.length;
  const elapsed = Math.floor(((now - EPOCH) % SLOT_MS) / 1000);
  return {
    index,
    track: AMBIENT_TRACKS[index] ?? AMBIENT_TRACKS[0]!,
    elapsed,
    remaining: SLOT_SECONDS - elapsed,
    slot,
  };
}

export function ambientEnabled(): boolean {
  if (typeof window === "undefined") return false;
  const stored = localStorage.getItem(ENABLED_KEY);
  if (stored === "1") return true;
  if (stored === "0") return false;
  // Adopt the toggle state from the pre-global players.
  return LEGACY_KEYS.some((key) => localStorage.getItem(key) === "1");
}

export function setAmbientEnabled(enabled: boolean) {
  if (typeof window === "undefined") return;
  localStorage.setItem(ENABLED_KEY, enabled ? "1" : "0");
  for (const key of LEGACY_KEYS) localStorage.setItem(key, enabled ? "1" : "0");
  window.dispatchEvent(new Event(AMBIENT_EVENT));
}

/** Called from a click gesture: unlocks autoplay and starts the shared track. */
export function startAmbient() {
  setAmbientEnabled(true);
  window.dispatchEvent(new Event(UNLOCK_EVENT));
}

export function subscribeAmbient(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onStorage = (event: StorageEvent) => {
    if (!event.key || event.key === ENABLED_KEY || LEGACY_KEYS.includes(event.key)) {
      listener();
    }
  };
  const onChange = () => listener();
  window.addEventListener("storage", onStorage);
  window.addEventListener(AMBIENT_EVENT, onChange);
  window.addEventListener(UNLOCK_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(AMBIENT_EVENT, onChange);
    window.removeEventListener(UNLOCK_EVENT, onChange);
  };
}
