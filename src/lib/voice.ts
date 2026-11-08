/**
 * Gemini TTS voice for the PA. All three are female, mid-register voices the
 * hospital asked for; the selection is shared by every page through
 * localStorage so the display board keeps the same voice after a reload.
 */

export type PaVoice = "Vindemiatrix" | "Sulafat" | "Despina";

export const PA_VOICES: PaVoice[] = ["Vindemiatrix", "Sulafat", "Despina"];

export const VOICE_LABELS: Record<PaVoice, string> = {
  Vindemiatrix: "Vindemiatrix · gentle",
  Sulafat: "Sulafat · warm",
  Despina: "Despina · smooth",
};

const KEY = "kh-pa-voice";

export function currentVoice(): PaVoice {
  if (typeof window === "undefined") return "Vindemiatrix";
  const saved = window.localStorage.getItem(KEY);
  return PA_VOICES.includes(saved as PaVoice) ? (saved as PaVoice) : "Vindemiatrix";
}

export function setVoice(voice: PaVoice) {
  try {
    window.localStorage.setItem(KEY, voice);
  } catch {
    /* ignore */
  }
}

export function cycleVoice(): PaVoice {
  const next = PA_VOICES[(PA_VOICES.indexOf(currentVoice()) + 1) % PA_VOICES.length]!;
  setVoice(next);
  return next;
}
