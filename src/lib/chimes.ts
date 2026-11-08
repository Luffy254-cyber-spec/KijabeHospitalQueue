/**
 * Waiting-room alert chimes for PA announcements.
 *
 * Deliberately gentle: sine/triangle waves only (square and sawtooth read as
 * alarms), a soft attack, a long exponential decay, and a peak well under the
 * volume of medical equipment alerts so the two are never confused.
 */

export type ChimeKind = "classic" | "marimba" | "ping";

export const CHIME_KINDS: ChimeKind[] = ["classic", "marimba", "ping"];

export const CHIME_LABELS: Record<ChimeKind, string> = {
  classic: "Classic chime",
  marimba: "Soft marimba",
  ping: "Single ping",
};

const KEY = "kh-pa-chime";

type Note = {
  freq: number;
  at: number;
  hold: number;
  type?: OscillatorType;
  peak: number;
};

/** Peak gains stay around 0.05 — roughly 10–15 dB below alarm tones. */
const PRESETS: Record<ChimeKind, { notes: Note[]; tailMs: number }> = {
  // Two descending notes, the familiar “pay attention” ding-dong.
  classic: {
    notes: [
      { freq: 500, at: 0, hold: 0.85, peak: 0.055 },
      { freq: 400, at: 0.3, hold: 1.1, peak: 0.05 },
    ],
    tailMs: 1500,
  },
  // Four quick ascending marimba notes with a long fade.
  marimba: {
    notes: [
      { freq: 523.25, at: 0, hold: 0.6, type: "triangle", peak: 0.05 },
      { freq: 659.25, at: 0.16, hold: 0.65, type: "triangle", peak: 0.05 },
      { freq: 783.99, at: 0.32, hold: 0.7, type: "triangle", peak: 0.048 },
      { freq: 1046.5, at: 0.48, hold: 0.9, type: "triangle", peak: 0.045 },
    ],
    tailMs: 1650,
  },
  // One clean bell-like ping that fades over almost two seconds.
  ping: {
    notes: [{ freq: 880, at: 0, hold: 1.8, peak: 0.06 }],
    tailMs: 2000,
  },
};

let sharedCtx: AudioContext | null = null;

function context(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!sharedCtx) sharedCtx = new Ctor();
  if (sharedCtx.state === "suspended") void sharedCtx.resume();
  return sharedCtx;
}

/** Call from a real click/tap so the display can chime later without a gesture. */
export function unlockChimes() {
  const ctx = context();
  if (ctx && ctx.state === "suspended") void ctx.resume();
}

export function currentChime(): ChimeKind {
  if (typeof window === "undefined") return "classic";
  const saved = window.localStorage.getItem(KEY);
  return CHIME_KINDS.includes(saved as ChimeKind) ? (saved as ChimeKind) : "classic";
}

export function setChime(kind: ChimeKind) {
  try {
    window.localStorage.setItem(KEY, kind);
  } catch {
    /* ignore */
  }
}

export function cycleChime(): ChimeKind {
  const next = CHIME_KINDS[(CHIME_KINDS.indexOf(currentChime()) + 1) % CHIME_KINDS.length]!;
  setChime(next);
  void playChime(next);
  return next;
}

export function playChime(kind: ChimeKind = currentChime()): Promise<void> {
  const ctx = context();
  if (!ctx) return Promise.resolve();
  const preset = PRESETS[kind];
  const t0 = ctx.currentTime + 0.03;

  for (const note of preset.notes) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = note.type ?? "sine";
    osc.frequency.setValueAtTime(note.freq, t0 + note.at);

    const start = t0 + note.at;
    // Soft attack so the note never clicks, then a long smooth decay.
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(note.peak, start + 0.035);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + note.hold);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(start);
    osc.stop(start + note.hold + 0.05);
  }

  return new Promise((resolve) => window.setTimeout(resolve, preset.tailMs));
}
