import { useEffect, useRef, useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import { ChevronDown, Pause, Play, Waves } from "lucide-react";
import {
  advanceAmbient,
  ambientEnabled,
  currentAmbient,
  setAmbientEnabled,
  startAmbient,
  subscribeAmbient,
} from "@/lib/ambient-music";
import { onAnnounceActive } from "@/lib/announce";

/**
 * One background player for the whole site. Mounted once in the root route so it
 * survives navigation, and shared through localStorage so every open page/tab
 * plays the same soft instrumental at the same position.
 */

const EMBED_H = 198;
const UI_KEY = "kh-hope-expanded";
const MAX_SKIPS = 8;
const STALE_AFTER_S = 900;

/** Full-screen waiting-room boards: the panel would cover the queue itself. */
function isBoard(path: string) {
  return path === "/display" || path === "/kiosk" || path.startsWith("/kiosk/");
}

type YTPlayer = {
  playVideo: () => void;
  pauseVideo: () => void;
  mute: () => void;
  unMute: () => void;
  setVolume: (v: number) => void;
  cueVideoById: (args: { videoId: string; startSeconds?: number }) => void;
  loadVideoById: (args: { videoId: string; startSeconds?: number }) => void;
  getVideoData?: () => { video_id?: string; title?: string };
  destroy: () => void;
};

type YTNamespace = {
  Player: new (el: HTMLElement | string, opts: Record<string, unknown>) => YTPlayer;
  PlayerState: {
    ENDED: number;
    PLAYING: number;
    PAUSED: number;
    CUED: number;
    BUFFERING: number;
  };
};

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

function bootYouTube(): Promise<YTNamespace> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined") {
      reject(new Error("no window"));
      return;
    }
    if (window.YT?.Player) {
      resolve(window.YT);
      return;
    }

    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      try {
        prev?.();
      } catch {
        /* ignore */
      }
      if (window.YT) resolve(window.YT);
      else reject(new Error("YT missing"));
    };

    if (!document.querySelector("script[data-kh-youtube]")) {
      const script = document.createElement("script");
      script.src = "https://www.youtube.com/iframe_api";
      script.async = true;
      script.dataset["khYoutube"] = "1";
      script.onerror = () => reject(new Error("youtube script failed"));
      document.head.appendChild(script);
    }

    const poll = window.setInterval(() => {
      if (window.YT?.Player) {
        window.clearInterval(poll);
        resolve(window.YT);
      }
    }, 200);

    window.setTimeout(() => {
      window.clearInterval(poll);
      if (!window.YT?.Player) reject(new Error("youtube api timeout"));
    }, 10000);
  });
}

export function AmbientMusic() {
  const mountRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const ytRef = useRef<YTNamespace | null>(null);

  const enabledRef = useRef(false);
  const duckRef = useRef(false);
  const readyRef = useRef(false);
  const loadedIndexRef = useRef(0);
  const switchingRef = useRef(false);
  const blockedRef = useRef<Set<string>>(new Set());
  const skipsRef = useRef(0);

  const [ready, setReady] = useState(false);
  const [enabled, setEnabledState] = useState(false);
  const [duck, setDuck] = useState(false);
  const [expanded, setExpanded] = useState(() => {
    if (typeof window === "undefined") return false;
    if (isBoard(window.location.pathname)) return false;
    const saved = localStorage.getItem(UI_KEY);
    if (saved === "1") return true;
    if (saved === "0") return false;
    // First visit: stay a small icon so the panel never covers the page.
    return ambientEnabled();
  });

  const board = useRouterState({ select: (s) => isBoard(s.location.pathname) });
  useEffect(() => {
    if (board) setExpanded(false);
  }, [board]);
  const [status, setStatus] = useState("Hope · soft worship");

  const shouldPlayNow = () => enabledRef.current && !duckRef.current;

  const loadShared = (autoplay: boolean) => {
    const p = playerRef.current;
    if (!p) return;
    const { index, track, elapsed } = currentAmbient();
    loadedIndexRef.current = index;
    const start = elapsed > STALE_AFTER_S ? 0 : elapsed;
    setStatus(track.title);
    try {
      if (autoplay) p.loadVideoById({ videoId: track.id, startSeconds: start });
      else p.cueVideoById({ videoId: track.id, startSeconds: start });
    } catch {
      /* ignore */
    }
  };

  const tryPlay = () => {
    const p = playerRef.current;
    if (!p || !readyRef.current || !shouldPlayNow()) return false;
    try {
      p.unMute();
      p.setVolume(62);
      p.playVideo();
      return true;
    } catch {
      return false;
    }
  };

  /** Move every page to the next shared track and load it here. */
  const shiftShared = () => {
    if (skipsRef.current > MAX_SKIPS) {
      setStatus("Hope · unavailable, tap to retry");
      return;
    }
    switchingRef.current = true;
    const { index } = advanceAmbient(loadedIndexRef.current);
    switchingRef.current = false;
    loadedIndexRef.current = index;
    skipsRef.current += 1;
    loadShared(shouldPlayNow());
    window.setTimeout(() => tryPlay(), 350);
  };

  const skipBroken = (videoId: string | undefined) => {
    if (videoId) blockedRef.current.add(videoId);
    shiftShared();
  };

  // Boot the embed once for the lifetime of the app.
  useEffect(() => {
    let gone = false;
    if (!mountRef.current) return;

    enabledRef.current = ambientEnabled();
    setEnabledState(enabledRef.current);

    const playerDomId = `kh-hope-yt-${Math.random().toString(36).slice(2, 9)}`;
    const slot = document.createElement("div");
    slot.id = playerDomId;
    mountRef.current.innerHTML = "";
    mountRef.current.appendChild(slot);

    const initial = currentAmbient();
    loadedIndexRef.current = initial.index;

    void bootYouTube()
      .then((YT) => {
        if (gone || !document.getElementById(playerDomId)) return;
        ytRef.current = YT;

        const player = new YT.Player(playerDomId, {
          height: String(EMBED_H),
          width: "100%",
          videoId: initial.track.id,
          host: "https://www.youtube-nocookie.com",
          playerVars: {
            // No autoplay flag: playback is started by a real gesture or an
            // already-unlocked session, never by the OS/browser at random.
            autoplay: 0,
            controls: 0,
            modestbranding: 1,
            rel: 0,
            playsinline: 1,
            fs: 0,
            iv_load_policy: 3,
            enablejsapi: 1,
            origin: window.location.origin,
          },
          events: {
            onReady: (e: { target: YTPlayer }) => {
              if (gone) return;
              playerRef.current = e.target;
              readyRef.current = true;
              setReady(true);
              loadShared(shouldPlayNow());
              if (shouldPlayNow()) {
                tryPlay();
                window.setTimeout(() => tryPlay(), 400);
                window.setTimeout(() => tryPlay(), 1200);
              }
              setStatus(shouldPlayNow() ? "Hope · soft worship" : "Hope · enable sound");
            },
            onStateChange: (e: { data: number; target: YTPlayer }) => {
              if (gone || !ytRef.current) return;
              const st = ytRef.current.PlayerState;
              if (e.data === st.PLAYING) {
                skipsRef.current = 0;
                setStatus("Hope · soft worship");
              }
              if (e.data === st.ENDED) shiftShared();
            },
            onError: () => {
              if (gone) return;
              const { track } = currentAmbient();
              skipBroken(track.id);
            },
          },
        });

        playerRef.current = player;
      })
      .catch(() => {
        if (!gone) setStatus("Hope · music unavailable");
      });

    return () => {
      gone = true;
      try {
        playerRef.current?.pauseVideo();
        playerRef.current?.destroy();
      } catch {
        /* ignore */
      }
      playerRef.current = null;
      readyRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Follow the shared state written by other pages/tabs.
  useEffect(() => {
    const sync = () => {
      const on = ambientEnabled();
      enabledRef.current = on;
      setEnabledState(on);

      if (!on) {
        try {
          playerRef.current?.pauseVideo();
        } catch {
          /* ignore */
        }
        setStatus("Hope · sound off");
        return;
      }
      if (duckRef.current || switchingRef.current || !readyRef.current) return;

      const { index, track } = currentAmbient();
      if (index !== loadedIndexRef.current) {
        loadShared(true);
        setStatus(track.title);
        window.setTimeout(() => tryPlay(), 400);
        return;
      }
      tryPlay();
    };
    return subscribeAmbient(sync);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pause under PA announcements made from any page/tab.
  useEffect(
    () =>
      onAnnounceActive((active) => {
        duckRef.current = active;
        setDuck(active);
        const p = playerRef.current;
        if (!p) return;
        try {
          if (active) p.pauseVideo();
          else if (enabledRef.current) {
            p.unMute();
            p.setVolume(62);
            p.playVideo();
          }
        } catch {
          /* ignore */
        }
      }),
    [],
  );

  // First real interaction in this tab unlocks unmuted playback.
  useEffect(() => {
    const unlock = () => {
      if (enabledRef.current && !duckRef.current) tryPlay();
    };
    window.addEventListener("pointerdown", unlock, { passive: true });
    window.addEventListener("keydown", unlock);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (ready) setStatus(shouldPlayNow() ? "Hope · soft worship" : "Hope · sound off");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, enabled]);

  const live = enabled && !duck;

  const minimise = () => {
    setExpanded(false);
    localStorage.setItem(UI_KEY, "0");
  };

  const open = () => {
    setExpanded(true);
    localStorage.setItem(UI_KEY, "1");
    if (!enabledRef.current) startAmbient();
  };

  const toggleSound = () => {
    if (enabled) setAmbientEnabled(false);
    else startAmbient();
  };

  return (
    <div
      className={`hope-dock hope-dock-global${expanded ? " hope-dock-open" : " hope-dock-icon"}${live ? " hope-dock-live" : ""}${duck ? " hope-dock-duck" : ""}`}
      aria-label="Hope worship music"
    >
      {!expanded && (
        <button
          type="button"
          className={`hope-fab${live ? " hope-fab-pulse" : ""}`}
          onClick={open}
          title="Open hope music"
          aria-expanded={false}
        >
          <span className="hope-fab-rings" aria-hidden />
          <span className="hope-fab-core" aria-hidden>
            <Waves className="hope-fab-icon" />
            <span className="hope-fab-cross">†</span>
          </span>
          {live && (
            <span className="hope-fab-eq" aria-hidden>
              <i />
              <i />
              <i />
            </span>
          )}
        </button>
      )}

      <div className={`hope-panel${expanded ? "" : " hope-panel-parked"}`}>
        {expanded && (
          <div className="hope-panel-head">
            <div>
              <p className="hope-music-label">{status}</p>
              <p className="hope-music-hint">
                Soft instrumental · same song on every page
                {duck ? " · PA" : ""}
              </p>
            </div>
            <div className="hope-panel-actions">
              <button
                type="button"
                className="hope-collapse-btn"
                onClick={toggleSound}
                aria-label={enabled ? "Pause music" : "Play music"}
                title={enabled ? "Pause music" : "Play music"}
              >
                {enabled ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              </button>
              <button
                type="button"
                className="hope-collapse-btn"
                onClick={minimise}
                aria-label="Minimise to icon"
                title="Minimise"
              >
                <ChevronDown className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}

        <div className="hope-music-embed-shell">
          <div ref={mountRef} className="hope-music-embed" style={{ minHeight: EMBED_H }} />
        </div>

        {expanded && (
          <p className="hope-volume-tip">
            Play once and it keeps going across pages. Announcements pause it automatically.
          </p>
        )}
      </div>
    </div>
  );
}
