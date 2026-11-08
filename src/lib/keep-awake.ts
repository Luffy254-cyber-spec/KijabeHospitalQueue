import { useEffect } from "react";

/**
 * Keeps the screen (and therefore the queue view) awake without ever faking a
 * click or keystroke — synthesising input would also defeat the staff idle
 * sign-out. Uses the Screen Wake Lock API where available and a silent looping
 * audio element as the fallback on browsers that lack it.
 */

type WakeLockSentinelLike = {
  released: boolean;
  release: () => Promise<void>;
  addEventListener: (type: "release", listener: () => void) => void;
};

type WakeLockNavigator = Navigator & {
  wakeLock?: { request: (type: "screen") => Promise<WakeLockSentinelLike> };
};

function silentWavUrl(): string {
  const sampleRate = 8000;
  const dataLen = 800 * 2;
  const buffer = new ArrayBuffer(44 + dataLen);
  const view = new DataView(buffer);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + dataLen, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, dataLen, true);
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]!);
  return `data:audio/wav;base64,${btoa(binary)}`;
}

export function useKeepAwake() {
  useEffect(() => {
    if (typeof window === "undefined") return;

    let sentinel: WakeLockSentinelLike | null = null;
    let audio: HTMLAudioElement | null = null;
    let disposed = false;

    const startSilentLoop = () => {
      if (audio) {
        void audio.play().catch(() => {});
        return;
      }
      audio = new Audio(silentWavUrl());
      audio.loop = true;
      audio.volume = 1;
      void audio.play().catch(() => {});
    };

    const acquire = async () => {
      if (disposed || document.visibilityState !== "visible") return;
      const api = (navigator as WakeLockNavigator).wakeLock;
      if (!api) {
        startSilentLoop();
        return;
      }
      if (sentinel && !sentinel.released) return;
      try {
        sentinel = await api.request("screen");
        sentinel.addEventListener("release", () => {
          sentinel = null;
        });
      } catch {
        // Denied (battery saver, non-secure origin) — fall back to silent audio.
        startSilentLoop();
      }
    };

    const onVisible = () => {
      if (document.visibilityState === "visible") void acquire();
    };
    // Browsers require a gesture before audio may start; re-try once on the
    // first real interaction, then stop listening.
    const onGesture = () => {
      if (document.visibilityState === "visible") void acquire();
      window.removeEventListener("pointerdown", onGesture);
      window.removeEventListener("keydown", onGesture);
    };

    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pointerdown", onGesture, { passive: true });
    window.addEventListener("keydown", onGesture);
    void acquire();

    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pointerdown", onGesture);
      window.removeEventListener("keydown", onGesture);
      try {
        void sentinel?.release();
      } catch {
        /* ignore */
      }
      sentinel = null;
      try {
        audio?.pause();
      } catch {
        /* ignore */
      }
      audio = null;
    };
  }, []);
}
