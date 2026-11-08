/** Hospital-style PA announcements — English only, one ticket per call. */

import { playChime } from "@/lib/chimes";

const DIGIT: Record<string, string> = {
  "0": "zero",
  "1": "one",
  "2": "two",
  "3": "three",
  "4": "four",
  "5": "five",
  "6": "six",
  "7": "seven",
  "8": "eight",
  "9": "nine",
};

/**
 * Pad the numeric part to 3 digits when under 3 significant figures.
 * Examples: 5 → 005, 42 → 042, 100 → 100, 1001 → 1001
 * Ensures small tickets speak at least two zeros (e.g. zero zero five).
 */
export function normalizeTicketToken(token: string): string {
  const raw = (token || "TRI001").toUpperCase().replace(/\s+/g, "");
  const m = raw.match(/^([A-Z]+)-?(\d+)$/);
  if (!m) {
    // Test fallback with two zeros so voice always demonstrates zeros
    if (!/\d/.test(raw)) return "TRI001";
    return raw.replace(/[^A-Z0-9]/g, "");
  }
  const prefix = m[1]!;
  const digits = m[2]!;
  const significant = digits.replace(/^0+/, "") || "0";
  const padded = significant.length >= 3 ? significant : significant.padStart(3, "0");
  return `${prefix}${padded}`;
}

function spellTokenEn(token: string): string {
  const normalized = normalizeTicketToken(token);
  const parts: string[] = [];
  for (const ch of normalized) {
    if (/\d/.test(ch)) parts.push(DIGIT[ch] || ch);
    else if (/[A-Z]/.test(ch)) parts.push(ch);
  }
  return parts.join("… ");
}

function pickVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices();
  return voices.find((v) => /female|zira|susan|samantha|karen|moira|tessa|google uk english female/i.test(v.name))
    || voices.find((v) => /en(-|_)?(gb|us|ke)/i.test(v.lang))
    || voices[0]
    || null;
}

function speakBrowserFallback(text: string, onEnd?: () => void) {
  if (!window.speechSynthesis) {
    onEnd?.();
    return;
  }
  window.speechSynthesis.cancel();
  const speak = () => {
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.05;
    u.pitch = 1.15;
    u.lang = "en-KE";
    const voice = pickVoice();
    if (voice) u.voice = voice;
    u.onend = () => onEnd?.();
    u.onerror = () => onEnd?.();
    window.speechSynthesis.speak(u);
  };
  if (window.speechSynthesis.getVoices().length) speak();
  else {
    window.speechSynthesis.onvoiceschanged = () => {
      window.speechSynthesis.onvoiceschanged = null;
      speak();
    };
    setTimeout(speak, 250);
  }
}

let currentAudio: HTMLAudioElement | null = null;

type AnnounceListener = (active: boolean) => void;
const announceListeners = new Set<AnnounceListener>();
const ANNOUNCE_BUS = "kh-announce-active";
let announceChannel: BroadcastChannel | null = null;

function getAnnounceChannel(): BroadcastChannel | null {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") return null;
  if (!announceChannel) announceChannel = new BroadcastChannel(ANNOUNCE_BUS);
  return announceChannel;
}

/** Subscribe to PA announce start/end so background hope music can pause (same tab + other tabs). */
export function onAnnounceActive(listener: AnnounceListener) {
  announceListeners.add(listener);
  const onMessage = (ev: MessageEvent) => {
    listener(!!(ev.data as { active?: boolean } | null)?.active);
  };
  const onStorage = (ev: StorageEvent) => {
    if (ev.key !== ANNOUNCE_BUS || !ev.newValue) return;
    try {
      listener(!!(JSON.parse(ev.newValue) as { active?: boolean }).active);
    } catch {
      /* ignore */
    }
  };
  const bc = getAnnounceChannel();
  bc?.addEventListener("message", onMessage);
  if (typeof window !== "undefined") window.addEventListener("storage", onStorage);
  return () => {
    announceListeners.delete(listener);
    bc?.removeEventListener("message", onMessage);
    if (typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  };
}

function setAnnounceActive(active: boolean) {
  announceListeners.forEach((l) => {
    try { l(active); } catch { /* ignore */ }
  });
  try {
    getAnnounceChannel()?.postMessage({ active });
  } catch {
    /* ignore */
  }
  try {
    // Cross-origin-safe fallback for browsers without BroadcastChannel listeners wired
    localStorage.setItem(ANNOUNCE_BUS, JSON.stringify({ active, t: Date.now() }));
  } catch {
    /* ignore */
  }
}

/** Remember a recent PA so another tab (display board) does not double-announce. */
function markTokenAnnounced(token: string) {
  try {
    localStorage.setItem(
      "kh-pa-recent",
      JSON.stringify({ token: normalizeTicketToken(token || "TRI001"), t: Date.now() }),
    );
  } catch {
    /* ignore */
  }
}

export function wasTokenAnnouncedRecently(token: string, withinMs = 16000): boolean {
  try {
    const raw = localStorage.getItem("kh-pa-recent");
    if (!raw) return false;
    const parsed = JSON.parse(raw) as { token?: string; t?: number };
    if (!parsed.token || !parsed.t) return false;
    return (
      parsed.token === normalizeTicketToken(token || "TRI001") &&
      Date.now() - parsed.t < withinMs
    );
  } catch {
    return false;
  }
}

/** Stop whatever is on air — used before a new call and when sound is muted. */
export function stopAnnouncement() {
  paId += 1;
  if (currentAudio) {
    try { currentAudio.pause(); } catch { /* ignore */ }
    currentAudio = null;
  }
  window.speechSynthesis?.cancel();
  setAnnounceActive(false);
}

/** One announcement at a time, so two tickets never talk over each other. */
let paId = 0;
let lastSpoken = { token: "", at: 0 };

export function speakHospitalToken(token: string, counter: string | null, opts?: { test?: boolean }) {
  if (typeof window === "undefined") return;
  const dest = counter || "the counter";
  // Test with no token → TRI001 so at least two zeros are spoken
  const normalized = normalizeTicketToken(token || "TRI001");
  const enSpell = spellTokenEn(normalized);
  const line = `Ticket number, ${enSpell}. Please proceed to ${dest}.`;
  const text = token || opts?.test ? line : "Announcements enabled.";

  // A double-click or a second tab can fire the same ticket twice.
  if (token || opts?.test) {
    const now = Date.now();
    const key = token ? normalized : "test";
    if (lastSpoken.token === key && now - lastSpoken.at < (token ? 8000 : 2500)) return;
    lastSpoken = { token: key, at: now };
  }

  stopAnnouncement();
  const id = ++paId;
  markTokenAnnounced(normalized);

  const play = async () => {
    let cleared = false;
    let safety = 0;
    const clear = () => {
      if (cleared || id !== paId) return;
      cleared = true;
      if (safety) window.clearTimeout(safety);
      setAnnounceActive(false);
    };
    const armSafety = (ms: number) => {
      if (safety) window.clearTimeout(safety);
      safety = window.setTimeout(clear, ms);
    };

    setAnnounceActive(true);
    // Long Gemini lines can exceed 20s, so keep music paused until it really ends.
    armSafety(90000);

    await playChime();
    if (id !== paId) return;

    try {
      const res = await fetch("/api/public/announce", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (id !== paId) return;
      if (!res.ok) {
        console.warn("Female Gemini voice unavailable", await res.text().catch(() => ""));
      } else {
        const blob = await res.blob();
        if (id !== paId) return;
        if (blob.size > 0 && (blob.type.startsWith("audio/") || blob.type === "application/octet-stream")) {
          const url = URL.createObjectURL(blob);
          const audio = new Audio(url);
          audio.preload = "auto";
          currentAudio = audio;
          audio.onloadedmetadata = () => {
            if (Number.isFinite(audio.duration) && audio.duration > 0) {
              armSafety(Math.ceil(audio.duration * 1000) + 2000);
            }
          };
          audio.onended = () => {
            URL.revokeObjectURL(url);
            clear();
          };
          audio.onerror = () => {
            URL.revokeObjectURL(url);
          };
          try {
            await audio.play();
            // The Gemini voice is on air — never start the browser voice too.
            return;
          } catch {
            URL.revokeObjectURL(url);
            if (currentAudio === audio) currentAudio = null;
          }
        }
      }
    } catch (e) {
      console.warn("Announce request failed", e);
    }

    if (id !== paId) return;
    speakBrowserFallback(text, clear);
  };
  void play();
}
