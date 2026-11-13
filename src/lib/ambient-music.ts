/**
 * One soft-instrumental playlist shared by every page, tab and browser.
 *
 * Rich rotation of peaceful instrumental hymns and soaking worship music,
 * dynamically rotating throughout the day with automatic advancement when a
 * track finishes, hourly variation, and manual skip / refresh controls.
 */

export type AmbientTrack = { id: string; title: string; category?: string };

export const AMBIENT_TRACKS: AmbientTrack[] = [
  { id: "1qAz7uC9x4A", title: "It Is Well With My Soul · Soft Piano Hymn", category: "Christian Hymns" },
  { id: "6p3W-oVq_7E", title: "Amazing Grace · Instrumental Piano & Strings", category: "Christian Hymns" },
  { id: "fJ9rUzIMcZQ", title: "Goodness of God · Christian Worship & Guitar", category: "Christian Worship" },
  { id: "9WKoTAddjIY", title: "Yeshua · Christian Soaking Worship", category: "Worship" },
  { id: "5qap5aO4i9A", title: "Great Is Thy Faithfulness · Piano Hymn", category: "Christian Hymns" },
  { id: "M7lc1UVf-VE", title: "In Christ Alone · Peaceful Christian Strings", category: "Christian Hymns" },
  { id: "kXYiU_JCYtU", title: "What A Beautiful Name · Acoustic Worship", category: "Christian Worship" },
  { id: "kJQP7kiw5Fk", title: "10,000 Reasons (Bless the Lord) · Soft Piano", category: "Christian Worship" },
  { id: "L_LUpnjgPso", title: "Way Maker · Christian Healing Atmosphere", category: "Worship" },
  { id: "hT_nvWreIhg", title: "Tis So Sweet To Trust In Jesus · Piano Hymn", category: "Christian Hymns" },
  { id: "YQHsXMglC9A", title: "How Great Thou Art · Gentle Christian Piano", category: "Christian Hymns" },
  { id: "fLexgOxsZu0", title: "Holy, Holy, Holy · Morning Christian Solace", category: "Christian Hymns" },
  { id: "RgKAFK5djSk", title: "The Lord's Prayer · Peaceful Christian Piano", category: "Christian Prayer" },
  { id: "DlAZxnpsFdo", title: "Traditional Christian Hymns · Piano & Cello", category: "Christian Hymns" },
  { id: "-qgdYQtIvNU", title: "Peaceful Christian Prayer · Piano & Strings", category: "Christian Prayer" },
  { id: "4wZmRQcIDME", title: "Calm & Healing · Christian Soaking Worship", category: "Worship" },
  { id: "FjM95SBwGc0", title: "Hallelujah · Christian Deep Peace & Worship", category: "Worship" },
  { id: "2qzR5e4YWrw", title: "Alone with God · Christian Instrumental", category: "Christian Prayer" },
  { id: "5OWlWRZz3VU", title: "Under His Wings · Soft Christian Acoustic", category: "Christian Hymns" },
  { id: "JT9aSnNYRjc", title: "Prophetic Christian Worship · Instrumental", category: "Worship" },
];

export const ENABLED_KEY = "kh-ambient-enabled";
export const UNLOCK_EVENT = "kh-hope-unlock";
export const AMBIENT_EVENT = "kh-ambient-change";
export const OFFSET_KEY = "kh-ambient-track-offset";

/** 7-minute slots so music rotates naturally and refreshes across the day. */
export const SLOT_SECONDS = 7 * 60;
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

function getLocalOffset(): number {
  if (typeof window === "undefined") return 0;
  const val = localStorage.getItem(OFFSET_KEY);
  return val ? parseInt(val, 10) || 0 : 0;
}

/** The same result in every browser at the same instant, rotating naturally. */
export function ambientSlot(now = Date.now()): AmbientSlot {
  const baseSlot = Math.floor((now - EPOCH) / SLOT_MS);
  const userOffset = getLocalOffset();
  const totalSlots = baseSlot + userOffset;
  const count = AMBIENT_TRACKS.length;
  const index = ((totalSlots % count) + count) % count;
  const elapsed = Math.floor(((now - EPOCH) % SLOT_MS) / 1000);
  return {
    index,
    track: AMBIENT_TRACKS[index] ?? AMBIENT_TRACKS[0]!,
    elapsed,
    remaining: Math.max(1, SLOT_SECONDS - elapsed),
    slot: totalSlots,
  };
}

/** Advance directly to the next track in the playlist. */
export function skipToNextTrack(): AmbientSlot {
  if (typeof window !== "undefined") {
    const current = getLocalOffset();
    localStorage.setItem(OFFSET_KEY, String(current + 1));
    window.dispatchEvent(new Event(AMBIENT_EVENT));
  }
  return ambientSlot();
}

/** Randomize/refresh the playlist rotation for a completely fresh selection. */
export function shuffleAmbientPlaylist(): AmbientSlot {
  if (typeof window !== "undefined") {
    const randomJump = Math.floor(Math.random() * (AMBIENT_TRACKS.length - 1)) + 1;
    const current = getLocalOffset();
    localStorage.setItem(OFFSET_KEY, String(current + randomJump));
    window.dispatchEvent(new Event(AMBIENT_EVENT));
  }
  return ambientSlot();
}

export function ambientEnabled(): boolean {
  if (typeof window === "undefined") return false;
  const stored = localStorage.getItem(ENABLED_KEY);
  if (stored === "1") return true;
  if (stored === "0") return false;
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
    if (
      !event.key ||
      event.key === ENABLED_KEY ||
      event.key === OFFSET_KEY ||
      LEGACY_KEYS.includes(event.key)
    ) {
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
