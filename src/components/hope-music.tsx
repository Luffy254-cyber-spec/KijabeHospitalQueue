import { useEffect, useRef, useState } from "react";
import { ChevronDown, Waves } from "lucide-react";

/**
 * Vocal worship songs (YouTube lyric / official videos).
 * Played one-by-one — never repeats the same video until the pool is exhausted.
 * Broken / non-embeddable ids are skipped permanently for the session.
 */
const SONG_POOL: string[] = [
  // Verified lyric / worship videos
  "dy9nwe9_xzw", // Hillsong UNITED — Oceans (lyric)
  "Sc6SSHuZvQE", // Cory Asbury — Reckless Love (lyric)
  "OpfuKKH_SCE", // Elevation — O Come To The Altar (lyric)
  "iJE4yahElBQ", // Elevation — Trust In God (lyric)
  "y1RQciil7B0", // Hillsong UNITED — Touch The Sky (lyric)
  "PBvU7arNhQs", // Matt Maher — Because He Lives (Amen)
  "34GcRkWIY3s", // Ryan Ellis — Heart of the Father
  "nQWFzMvCfLE", // Hillsong — What A Beautiful Name
  "f2oxGYpuLkw", // Elevation — Praise
  "Zp6aygmvzM4", // Elevation — The Blessing
  "DXDGE_lRI0E", // Matt Redman — 10,000 Reasons
  "Jbe7OruLk8I", // Chris Tomlin — Amazing Grace (My Chains Are Gone)
  "QM8jQHE5AAk", // Sinach — Way Maker
  "iJCV_2H9xD0", // Leeland — Way Maker
  "9sE5kEnitqE", // CeCe Winans — Goodness of God
  "sIaT8Jl2zpI", // Lauren Daigle — You Say
  "bL0nDrEYDnk", // Gateway — Revelation Song
  "KwX1f2gYKZ4", // Elevation — Graves Into Gardens (live)
  "R8oxVCFGsgY", // Elevation — Graves Into Gardens (lyric)
  "IcC1Bp13n_4", // Hillsong — Who You Say I Am (lyric)
  "lKw6uqtGFfo", // Hillsong — Who You Say I Am
  "k-rjczm7uCo", // Hillsong — Who You Say I Am (acoustic)
  "r7V2Ja7LzWg", // All Sons & Daughters — Great Are You Lord
  "uHz0w-HG4iU", // Great Are You Lord (concert)
  "hpb02shcAis", // Great Are You Lord (lyric)
  "rYQ5yXCc_CA", // O Come To The Altar (live)
  "l37MNjjqJWo", // O Come To The Altar (acoustic)
  "WJTl2vnF3SE", // Graves Into Gardens (acoustic)
  "HDeVfP7vErE", // Graves Into Gardens (studio)
  "KBD18rsVJHk", // Chris Tomlin — How Great Is Our God
];

/** Split pool into playlists of ~6 for “next playlist” rotation */
function chunkPlaylists(ids: string[], size: number): string[][] {
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += size) {
    chunks.push(ids.slice(i, i + size));
  }
  return chunks.length ? chunks : [ids];
}

const MUSIC_PLAYLISTS = chunkPlaylists(SONG_POOL, 6);

const EMBED_H = 198;
const UI_KEY = "kh-hope-expanded";
const UNLOCK = "kh-hope-unlock";

type YTPlayer = {
  playVideo: () => void;
  pauseVideo: () => void;
  stopVideo: () => void;
  cueVideoById: (args: { videoId: string; startSeconds?: number }) => void;
  loadVideoById: (args: { videoId: string; startSeconds?: number }) => void;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  unMute: () => void;
  setVolume: (v: number) => void;
  getPlayerState: () => number;
  getVideoData?: () => { video_id?: string; title?: string };
  destroy: () => void;
};

type YTNamespace = {
  Player: new (
    el: HTMLElement | string,
    opts: Record<string, unknown>,
  ) => YTPlayer;
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

function shuffle<T>(items: readonly T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

function pickOtherPlaylist(current: number, total: number): number {
  if (total <= 1) return 0;
  const others = Array.from({ length: total }, (_, i) => i).filter((i) => i !== current);
  return others[Math.floor(Math.random() * others.length)] ?? (current + 1) % total;
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
      script.dataset.khYoutube = "1";
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

type Props = {
  active: boolean;
  duck?: boolean;
  oceanOn?: boolean;
};

export function HopeMusic({ active, duck = false, oceanOn = false }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const ytRef = useRef<YTNamespace | null>(null);

  const playlistIdxRef = useRef(Math.floor(Math.random() * MUSIC_PLAYLISTS.length));
  const songOrderRef = useRef<string[]>([]);
  const songPosRef = useRef(0);
  const blockedRef = useRef<Set<string>>(new Set());
  const lastPlayedRef = useRef<string | null>(null);

  const startedRef = useRef(false);
  const duckedRef = useRef(false);
  const wantPlayRef = useRef(false);
  const swapRef = useRef(false);
  const activeRef = useRef(active);
  const duckRef = useRef(duck);

  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState("Hope · loading YouTube…");
  const [expanded, setExpanded] = useState(() => {
    if (typeof window === "undefined") return true;
    return localStorage.getItem(UI_KEY) !== "0";
  });

  activeRef.current = active;
  duckRef.current = duck;

  const rebuildSongOrder = (playlistIndex: number) => {
    const raw = MUSIC_PLAYLISTS[playlistIndex] ?? MUSIC_PLAYLISTS[0]!;
    const usable = raw.filter((id) => !blockedRef.current.has(id));
    let order = shuffle(usable.length ? usable : [...raw]);
    // Never start with the song we just finished
    if (order.length > 1 && order[0] === lastPlayedRef.current) {
      const rest = order.slice(1);
      order = [...rest, order[0]!];
    }
    songOrderRef.current = order;
    songPosRef.current = 0;
    playlistIdxRef.current = playlistIndex;
  };

  const currentSong = () => songOrderRef.current[songPosRef.current] ?? null;

  const tryPlay = () => {
    const p = playerRef.current;
    if (!p || duckRef.current) return false;
    if (!activeRef.current && !wantPlayRef.current) return false;
    wantPlayRef.current = true;
    try {
      p.unMute();
      p.setVolume(72);
      p.playVideo();
      startedRef.current = true;
      setStatus("Hope · soft worship");
      return true;
    } catch {
      return false;
    }
  };

  const loadCurrent = (autoplay: boolean) => {
    const p = playerRef.current;
    const id = currentSong();
    if (!p || !id) return;
    try {
      if (autoplay) {
        p.loadVideoById({ videoId: id, startSeconds: 0 });
      } else {
        p.cueVideoById({ videoId: id, startSeconds: 0 });
      }
      lastPlayedRef.current = id;
    } catch {
      /* ignore */
    }
  };

  const advanceSong = () => {
    if (!playerRef.current) return;

    // Next in this playlist
    if (songPosRef.current < songOrderRef.current.length - 1) {
      songPosRef.current += 1;
      // Skip if somehow same as last
      while (
        songPosRef.current < songOrderRef.current.length &&
        songOrderRef.current[songPosRef.current] === lastPlayedRef.current
      ) {
        songPosRef.current += 1;
      }
      if (songPosRef.current < songOrderRef.current.length) {
        const shouldPlay = Boolean(
          activeRef.current && wantPlayRef.current && !duckRef.current,
        );
        loadCurrent(shouldPlay);
        if (shouldPlay) window.setTimeout(() => tryPlay(), 300);
        return;
      }
    }

    // Playlist finished → different playlist (never the same)
    nextDifferentPlaylist();
  };

  const nextDifferentPlaylist = () => {
    if (swapRef.current || !playerRef.current) return;
    swapRef.current = true;
    const next = pickOtherPlaylist(playlistIdxRef.current, MUSIC_PLAYLISTS.length);
    setStatus("Next hope playlist…");
    rebuildSongOrder(next);
    const shouldPlay = Boolean(
      activeRef.current && wantPlayRef.current && !duckRef.current,
    );
    loadCurrent(shouldPlay);
    window.setTimeout(() => {
      if (shouldPlay) tryPlay();
      setStatus("Hope · soft worship");
      swapRef.current = false;
    }, 500);
  };

  const skipBroken = (videoId: string | undefined) => {
    if (videoId) blockedRef.current.add(videoId);
    setStatus("Hope · skipping…");
    // Remove from current order
    songOrderRef.current = songOrderRef.current.filter((id) => id !== videoId);
    if (songPosRef.current >= songOrderRef.current.length) {
      nextDifferentPlaylist();
      return;
    }
    // Stay on same position (next song slid into place) or advance
    loadCurrent(Boolean(activeRef.current && wantPlayRef.current && !duckRef.current));
    window.setTimeout(() => tryPlay(), 300);
  };

  useEffect(() => {
    let gone = false;
    if (!mountRef.current) return;

    const playerDomId = `kh-hope-yt-${Math.random().toString(36).slice(2, 9)}`;
    const slot = document.createElement("div");
    slot.id = playerDomId;
    mountRef.current.innerHTML = "";
    mountRef.current.appendChild(slot);

    rebuildSongOrder(playlistIdxRef.current);
    const firstId = currentSong() ?? SONG_POOL[0]!;
    const shouldAuto =
      wantPlayRef.current || (activeRef.current && !duckRef.current);

    void bootYouTube()
      .then((YT) => {
        if (gone || !document.getElementById(playerDomId)) return;
        ytRef.current = YT;

        const player = new YT.Player(playerDomId, {
          height: String(EMBED_H),
          width: "100%",
          videoId: firstId,
          host: "https://www.youtube-nocookie.com",
          playerVars: {
            // Autoplay when sound already unlocked; browsers still need a prior gesture
            autoplay: shouldAuto ? 1 : 0,
            controls: 1,
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
              lastPlayedRef.current = firstId;
              setReady(true);
              setStatus(
                activeRef.current ? "Hope · soft worship" : "Hope · enable sound",
              );
              const playNow =
                wantPlayRef.current || (activeRef.current && !duckRef.current);
              try {
                if (playNow) {
                  // Start from 0:00 and autoplay as soon as the embed is ready
                  e.target.loadVideoById({ videoId: firstId, startSeconds: 0 });
                  e.target.unMute();
                  e.target.setVolume(72);
                  e.target.playVideo();
                  startedRef.current = true;
                  wantPlayRef.current = true;
                } else {
                  e.target.cueVideoById({ videoId: firstId, startSeconds: 0 });
                }
              } catch {
                /* ignore */
              }
              if (playNow) {
                tryPlay();
                window.setTimeout(() => tryPlay(), 400);
                window.setTimeout(() => tryPlay(), 1200);
              }
            },
            onStateChange: (e: { data: number; target: YTPlayer }) => {
              if (gone || !ytRef.current) return;
              const st = ytRef.current.PlayerState;
              if (e.data === st.PLAYING) {
                startedRef.current = true;
                setStatus("Hope · soft worship");
                try {
                  const id = e.target.getVideoData?.()?.video_id;
                  if (id) lastPlayedRef.current = id;
                } catch {
                  /* ignore */
                }
              }
              if (e.data === st.ENDED) {
                advanceSong();
              }
            },
            onError: (e: { data: number; target: YTPlayer }) => {
              if (gone) return;
              // 101 / 150 = embedding disabled; 100 = not found; 2 = bad id
              let id: string | undefined;
              try {
                id = e.target.getVideoData?.()?.video_id ?? currentSong() ?? undefined;
              } catch {
                id = currentSong() ?? undefined;
              }
              skipBroken(id);
            },
          },
        });

        playerRef.current = player;
      })
      .catch(() => {
        if (!gone) setStatus("Hope · YouTube unavailable");
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
    };
  }, []);

  useEffect(() => {
    const onUnlock = () => {
      wantPlayRef.current = true;
      activeRef.current = true;
      setExpanded(true);
      localStorage.setItem(UI_KEY, "1");
      const p = playerRef.current;
      const id = currentSong() ?? lastPlayedRef.current;
      // Hard start from 0:00 in the same user-gesture stack as Enable sound
      if (p && id) {
        try {
          p.loadVideoById({ videoId: id, startSeconds: 0 });
          p.unMute();
          p.setVolume(72);
          p.playVideo();
          startedRef.current = true;
          setStatus("Hope · soft worship");
        } catch {
          tryPlay();
        }
      } else {
        tryPlay();
      }
      window.setTimeout(() => tryPlay(), 300);
      window.setTimeout(() => tryPlay(), 900);
      window.setTimeout(() => tryPlay(), 1800);
    };
    window.addEventListener(UNLOCK, onUnlock);
    return () => window.removeEventListener(UNLOCK, onUnlock);
  }, [ready]);

  useEffect(() => {
    const p = playerRef.current;
    if (!p || !ready) return;

    if (!active) {
      wantPlayRef.current = false;
      try {
        p.pauseVideo();
      } catch {
        /* ignore */
      }
      startedRef.current = false;
      duckedRef.current = false;
      setStatus("Hope · sound off");
      return;
    }

    if (duck) {
      duckedRef.current = true;
      try {
        p.pauseVideo();
      } catch {
        /* ignore */
      }
      setStatus("Paused · announcement");
      return;
    }

    if (duckedRef.current) {
      try {
        p.unMute();
        p.playVideo();
        duckedRef.current = false;
        startedRef.current = true;
        setStatus("Hope · soft worship");
      } catch {
        /* ignore */
      }
      return;
    }

    if (wantPlayRef.current || startedRef.current) {
      tryPlay();
    } else {
      setStatus("Hope · enable sound to autoplay");
    }
  }, [active, duck, ready]);

  const minimise = () => {
    setExpanded(false);
    localStorage.setItem(UI_KEY, "0");
  };

  const open = () => {
    wantPlayRef.current = true;
    setExpanded(true);
    localStorage.setItem(UI_KEY, "1");
    tryPlay();
  };

  const live = active && !duck;

  return (
    <div
      className={`hope-dock${expanded ? " hope-dock-open" : " hope-dock-icon"}${live ? " hope-dock-live" : ""}${duck ? " hope-dock-duck" : ""}`}
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
                YouTube songs · autoplay · no repeats · next playlist when done
                {oceanOn ? " · ocean on" : ""}
                {duck ? " · PA" : ""}
              </p>
            </div>
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
        )}

        <div className="hope-music-embed-shell">
          <div
            ref={mountRef}
            className="hope-music-embed"
            style={{ minHeight: EMBED_H }}
          />
        </div>

        {expanded && (
          <p className="hope-volume-tip">
            Enable sound once — songs autoplay. Blocked videos are skipped. When a playlist ends, a
            different one starts.
          </p>
        )}
      </div>
    </div>
  );
}
