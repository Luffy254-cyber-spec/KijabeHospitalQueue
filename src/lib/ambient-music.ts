/**
 * One soft-instrumental playlist shared by every page. The current track lives
 * in localStorage so navigation does not restart the music and two open tabs
 * play the same song at the same position.
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

type AmbientState = { index: number; startedAt: number };

const STATE_KEY = "kh-ambient-state";
const LEGACY_KEYS = ["kh-staff-login-sound", "kh-display-sound"];

function safeParse(raw: string | null): AmbientState | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<AmbientState>;
    if (typeof parsed.index !== "number" || typeof parsed.startedAt !== "number") return null;
    if (parsed.index < 0 || parsed.index >= AMBIENT_TRACKS.length) return null;
    return { index: Math.floor(parsed.index), startedAt: parsed.startedAt };
  } catch {
    return null;
  }
}

export function readAmbientState(): AmbientState {
  if (typeof window === "undefined") return { index: 0, startedAt: Date.now() };
  const stored = safeParse(localStorage.getItem(STATE_KEY));
  if (stored) return stored;
  const fresh = { index: 0, startedAt: Date.now() };
  writeAmbientState(fresh);
  return fresh;
}

export function writeAmbientState(next: AmbientState) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STATE_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent(AMBIENT_EVENT, { detail: next }));
}

export function currentAmbient(): { index: number; track: AmbientTrack; elapsed: number } {
  const state = readAmbientState();
  const elapsed = Math.max(0, Math.floor((Date.now() - state.startedAt) / 1000));
  const track = AMBIENT_TRACKS[state.index] ?? AMBIENT_TRACKS[0]!;
  return { index: state.index, track, elapsed };
}

/** Move to the next track and remember when it started, for every page/tab. */
export function advanceAmbient(fromIndex: number): { index: number; track: AmbientTrack } {
  const now = Date.now();
  const state = readAmbientState();
  // Another tab may already have advanced while this one was buffering.
  if (state.index !== fromIndex) {
    return { index: state.index, track: AMBIENT_TRACKS[state.index] ?? AMBIENT_TRACKS[0]! };
  }
  const index = (fromIndex + 1) % AMBIENT_TRACKS.length;
  writeAmbientState({ index, startedAt: now });
  return { index, track: AMBIENT_TRACKS[index] ?? AMBIENT_TRACKS[0]! };
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
    if (!event.key || event.key === STATE_KEY || event.key === ENABLED_KEY || LEGACY_KEYS.includes(event.key)) {
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
