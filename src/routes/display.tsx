import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Volume2, VolumeX } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { onAnnounceActive, speakHospitalToken, stopAnnouncement, wasTokenAnnouncedRecently } from "@/lib/announce";
import { CHIME_LABELS, currentChime, cycleChime, unlockChimes, type ChimeKind } from "@/lib/chimes";
import { StaffOceanScene } from "@/components/staff-ocean-scene";
import { ambientEnabled, setAmbientEnabled, startAmbient, subscribeAmbient } from "@/lib/ambient-music";

export const Route = createFileRoute("/display")({
  head: () => ({
    meta: [
      { title: "Waiting Room Display — Kijabe Hospital" },
      { name: "description", content: "Live queue display showing called numbers and rooms at AIC Kijabe Hospital." },
      { property: "og:title", content: "Waiting Room Display — Kijabe Hospital" },
      { property: "og:description", content: "Live queue display showing called numbers and rooms at AIC Kijabe Hospital." },
    ],
  }),
  component: Display,
});

type Called = {
  token: string;
  counter: string | null;
  service_en: string;
  service_sw: string;
  status: string;
  called_at: string;
  recall_count: number;
};

type Queue = {
  code: string;
  name_en: string;
  name_sw: string;
  waiting: number;
  avg_minutes: number;
  surge_threshold: number;
  open_counters: number;
  next_tokens: string[] | null;
};

type WaitingPatient = {
  token: string;
  priority: number;
  queued_at: string;
  triage?: string;
  service_code: string;
  service_en: string;
  service_sw: string;
  sort: number;
  ahead: number;
};

type RoomSlide = {
  counter_id: string;
  name: string;
  service_code?: string;
  service_en: string;
  service_sw: string;
  token: string | null;
  status: string | null;
};

type Board = {
  called: Called[];
  queues: Queue[];
  waiting_all?: WaitingPatient[];
  rooms?: RoomSlide[];
};

function chunkPairs<T>(items: T[]): T[][] {
  if (!items.length) return [[]];
  const pairs: T[][] = [];
  for (let i = 0; i < items.length; i += 2) pairs.push(items.slice(i, i + 2));
  return pairs;
}

function Display() {
  const [board, setBoard] = useState<Board>({ called: [], queues: [], waiting_all: [], rooms: [] });
  const [sound, setSound] = useState(() => {
    if (typeof window === "undefined") return false;
    return ambientEnabled();
  });
  const [clock, setClock] = useState<Date | null>(null);
  const [flash, setFlash] = useState<Called | null>(null);
  const [reading, setReading] = useState<Called | null>(null);
  const [serveIndex, setServeIndex] = useState(0);
  const [waitIndex, setWaitIndex] = useState(0);
  const [pairIndex, setPairIndex] = useState(0);
  const [announceDuck, setAnnounceDuck] = useState(false);
  const [chime, setChime] = useState<ChimeKind>(() =>
    typeof window === "undefined" ? "classic" : currentChime(),
  );
  const seen = useRef<Set<string> | null>(null);
  const readingLock = useRef(false);
  const pinnedReading = useRef<string | null>(null);

  // Ducks the ocean bed while the PA speaks (the global music player ducks itself).
  useEffect(() => onAnnounceActive(setAnnounceDuck), []);

  // The shared player can be toggled from any page or tab.
  useEffect(() => subscribeAmbient(() => setSound(ambientEnabled())), []);

  const waitingQueues = useMemo(
    () => (board.queues ?? []).filter((q) => Number(q.waiting) > 0).sort((a, b) => b.waiting - a.waiting),
    [board.queues],
  );

  const servingRooms = useMemo(() => {
    const rank = (r: RoomSlide) =>
      r.status === "serving" ? 0 : r.status === "called" ? 1 : r.token ? 2 : 3;
    const list = board.rooms?.length
      ? [...board.rooms]
      : Array.from(
          new Map(
            (board.called ?? []).map((c) => {
              const name = c.counter || c.service_en || "Desk";
              return [
                name,
                {
                  counter_id: name,
                  name,
                  service_en: c.service_en,
                  service_sw: c.service_sw,
                  token: c.token,
                  status: c.status,
                } satisfies RoomSlide,
              ] as const;
            }),
          ).values(),
        );
    return list.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  }, [board.rooms, board.called]);

  const allWaiting = useMemo(() => {
    if (board.waiting_all?.length) return board.waiting_all;
    const out: WaitingPatient[] = [];
    for (const q of board.queues ?? []) {
      (q.next_tokens ?? []).forEach((token, i) => {
        out.push({
          token,
          priority: 0,
          queued_at: new Date().toISOString(),
          service_code: q.code,
          service_en: q.name_en,
          service_sw: q.name_sw,
          sort: q.avg_minutes,
          ahead: i,
        });
      });
    }
    return out;
  }, [board.waiting_all, board.queues]);

  const safeServe = servingRooms.length ? serveIndex % servingRooms.length : 0;
  const safeWait = waitingQueues.length ? waitIndex % waitingQueues.length : 0;
  const activeRoom = servingRooms[safeServe] ?? null;
  const activeQueue = waitingQueues[safeWait] ?? null;

  const waitPatients = useMemo(() => {
    if (!activeQueue) return allWaiting;
    return allWaiting.filter((p) => p.service_code === activeQueue.code);
  }, [allWaiting, activeQueue]);

  const waitPairs = useMemo(() => chunkPairs(waitPatients), [waitPatients]);
  const safePair = waitPairs.length ? pairIndex % waitPairs.length : 0;

  const callStrip = useMemo(() => {
    const called = board.called ?? [];
    let idx = 0;
    if (reading) {
      const found = called.findIndex(
        (c) => c.token === reading.token && c.called_at === reading.called_at,
      );
      if (found >= 0) idx = found;
    }
    const current = called[idx] ?? null;
    const before = [called[idx + 1] ?? null, called[idx + 2] ?? null, called[idx + 3] ?? null];
    const next =
      allWaiting.find(
        (p) =>
          !!current &&
          (p.service_en === current.service_en || p.service_sw === current.service_sw) &&
          p.token !== current.token,
      ) ??
      allWaiting.find((p) => !current || p.token !== current.token) ??
      null;
    return { before, current, next };
  }, [board.called, reading, allWaiting]);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const { data, error } = await supabase.rpc("get_display_board");
      if (!alive) return;
      if (error || !data) {
        console.warn("get_display_board", error?.message || "empty");
        return;
      }
      const raw = data as unknown as Board;
      const next: Board = {
        called: Array.isArray(raw.called) ? raw.called : [],
        queues: Array.isArray(raw.queues) ? raw.queues : [],
        waiting_all: Array.isArray(raw.waiting_all) ? raw.waiting_all : [],
        rooms: Array.isArray(raw.rooms) ? raw.rooms : [],
      };
      const keys = next.called.map((c) => `${c.token}|${c.called_at}|${c.recall_count}`);
      if (seen.current) {
        const fresh = next.called.filter(
          (c) => !seen.current!.has(`${c.token}|${c.called_at}|${c.recall_count}`),
        );
        if (fresh.length) {
          const first = fresh[0]!;
          setFlash(first);
          setReading(first);
          readingLock.current = true;
          window.setTimeout(() => {
            setFlash(null);
            readingLock.current = false;
          }, 14000);
          if (sound) {
            fresh.forEach((c, i) => {
              window.setTimeout(() => {
                setReading(c);
                readingLock.current = true;
                // Staff Call next / Recall already spoke — only duck music via bus, don't double PA
                if (!wasTokenAnnouncedRecently(c.token)) {
                  speakHospitalToken(c.token, c.counter);
                }
                window.setTimeout(() => {
                  readingLock.current = false;
                }, 12000);
              }, i * 13000);
            });
          }
        }
      }
      seen.current = new Set(keys);
      setBoard(next);
      if (!readingLock.current && next.called[0]) setReading(next.called[0]);
    };
    void load();
    const poll = window.setInterval(() => void load(), 3000);
    const channel = supabase
      .channel("display-board")
      .on("postgres_changes", { event: "*", schema: "public", table: "tickets" }, () => void load())
      .subscribe();
    return () => {
      alive = false;
      window.clearInterval(poll);
      void supabase.removeChannel(channel);
    };
  }, [sound]);

  useEffect(() => {
    setClock(new Date());
    const id = window.setInterval(() => setClock(new Date()), 15000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!reading || servingRooms.length === 0) return;
    // Board polls rebuild the objects every 3s — only jump when the announced call really changes.
    const key = `${reading.token}|${reading.counter ?? ""}`;
    if (pinnedReading.current === key) return;
    pinnedReading.current = key;
    const idx = servingRooms.findIndex(
      (r) =>
        (reading.counter && r.name === reading.counter) ||
        (!!reading.token && r.token === reading.token),
    );
    if (idx >= 0) setServeIndex(idx);
  }, [reading, servingRooms]);

  useEffect(() => {
    if (!reading || waitingQueues.length === 0) return;
    const idx = waitingQueues.findIndex(
      (q) => q.name_en === reading.service_en || q.name_sw === reading.service_sw,
    );
    if (idx >= 0) {
      setWaitIndex(idx);
      setPairIndex(0);
    }
  }, [reading, waitingQueues]);

  useEffect(() => {
    if (servingRooms.length < 2) return;
    const id = window.setInterval(() => {
      if (readingLock.current) return;
      setServeIndex((i) => (i + 1) % servingRooms.length);
    }, 4500);
    return () => window.clearInterval(id);
  }, [servingRooms.length]);

  useEffect(() => {
    if (waitingQueues.length < 2) return;
    const id = window.setInterval(() => {
      if (readingLock.current) return;
      setWaitIndex((i) => (i + 1) % waitingQueues.length);
      setPairIndex(0);
    }, 7000);
    return () => window.clearInterval(id);
  }, [waitingQueues.length]);

  useEffect(() => {
    setPairIndex(0);
  }, [safeWait]);

  useEffect(() => {
    if (waitPairs.length < 2) return;
    const id = window.setInterval(() => {
      if (readingLock.current) return;
      setPairIndex((i) => (i + 1) % waitPairs.length);
    }, 4500);
    return () => window.clearInterval(id);
  }, [waitPairs.length, safeWait]);

  const enableSound = () => {
    setSound(true);
    startAmbient();
    unlockChimes();
    speakHospitalToken("", null, { test: true });
  };

  const disableSound = () => {
    setSound(false);
    setAmbientEnabled(false);
    stopAnnouncement();
  };

  const latest = reading || board.called[0] || null;
  const dateLabel = clock?.toLocaleDateString("en-KE", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const timeLabel = clock?.toLocaleTimeString("en-KE", {
    hour: "2-digit",
    minute: "2-digit",
  });

  const roomStatus =
    activeRoom?.status === "serving"
      ? "serving"
      : activeRoom?.status === "called"
        ? "called"
        : "vacant";

  return (
    <StaffOceanScene
      variant="display"
      showSeaSounds={false}
      ambientActive={sound}
      ambientDuck={announceDuck}
      calmAmbient
    >
      <div className="tv-board">
        <header className="tv-top">
          <div className="tv-brand">
            <p className="tv-kicker">AIC Kijabe Hospital</p>
            <h1>Outpatient · Wagonjwa wa Nje</h1>
            <p className="tv-sub">
              {dateLabel} · live queue (24/7)
              {sound ? " · calm ocean + hope" : ""}
            </p>
          </div>
          <div className="tv-controls">
            {!sound ? (
              <button type="button" className="tv-btn" onClick={enableSound}>
                <Volume2 className="h-4 w-4" /> Enable sound
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="tv-btn"
                  onClick={() => setChime(cycleChime())}
                  title="Change the alert chime"
                >
                  {CHIME_LABELS[chime]}
                </button>
                <button
                  type="button"
                  className="tv-btn"
                  onClick={() => {
                    const token = activeRoom?.token || latest?.token || "TRI001";
                    const desk = activeRoom?.name || latest?.counter || "Triage Room 1";
                    if (latest) {
                      setReading(latest);
                      readingLock.current = true;
                      window.setTimeout(() => {
                        readingLock.current = false;
                      }, 12000);
                    }
                    speakHospitalToken(token, desk, { test: true });
                  }}
                >
                  Test voice
                </button>
                <button type="button" className="tv-btn" onClick={disableSound}>
                  <VolumeX className="h-4 w-4" /> Sound ON
                </button>
              </>
            )}
            <p className="tv-clock">{timeLabel}</p>
          </div>
        </header>

        {flash && (
          <div className="tv-flash">
            <p className="tv-flash-label">Now calling · Anayeitwa sasa</p>
            <p className="tv-flash-token">{flash.token}</p>
            <p className="tv-flash-room">→ {flash.counter}</p>
          </div>
        )}

        <div className="tv-stage">
          <section className={`tv-serve ${flash ? "tv-serve-alert" : ""}`}>
            <div className="tv-serve-head">
              <p className="tv-label">Now serving · Anayehudumiwa</p>
              <p className="tv-meta">
                {servingRooms.length
                  ? `Room ${safeServe + 1} / ${servingRooms.length}`
                  : "Rooms"}
              </p>
            </div>

            <div className="tv-serve-body" key={activeRoom?.counter_id ?? "empty"}>
              {!activeRoom ? (
                <>
                  <p className="tv-token">–</p>
                  <p className="tv-room">No rooms open yet</p>
                </>
              ) : (
                <>
                  <p className={`tv-token ${activeRoom.token ? "" : "tv-token-empty"}`}>
                    {activeRoom.token || "–"}
                  </p>
                  <p className="tv-room">→ {activeRoom.name}</p>
                  <p className="tv-service">
                    {activeRoom.service_en}
                    {activeRoom.service_sw ? ` · ${activeRoom.service_sw}` : ""}
                    {" · "}
                    {roomStatus}
                  </p>
                </>
              )}
            </div>

            {servingRooms.length > 1 && (
              <div className="tv-progress" aria-hidden>
                <span style={{ width: `${((safeServe + 1) / servingRooms.length) * 100}%` }} />
              </div>
            )}
          </section>

          <section className="tv-wait">
            <div className="tv-wait-head">
              <div>
                <h2>Waiting · Wanaosubiri</h2>
                <p>
                  {activeQueue
                    ? `${activeQueue.name_en} · ${activeQueue.name_sw}`
                    : "All desks"}
                  {waitingQueues.length > 1
                    ? ` · dept ${safeWait + 1}/${waitingQueues.length}`
                    : ""}
                  {waitPairs.length > 1 ? ` · pair ${safePair + 1}/${waitPairs.length}` : ""}
                </p>
              </div>
              <p className="tv-count">{allWaiting.length}</p>
            </div>

            {allWaiting.length === 0 ? (
              <p className="tv-empty">Queues are clear</p>
            ) : (
              <>
                <div className="tv-wait-track-wrap">
                  <div
                    className="tv-wait-track"
                    style={{ transform: `translateX(-${safePair * 100}%)` }}
                  >
                    {waitPairs.map((pair, pi) => (
                      <div className="tv-wait-slide" key={`pair-${pi}-${pair.map((p) => p.token).join("|")}`}>
                        {[0, 1].map((slot) => {
                          const p = pair[slot];
                          // Neutral only on the public TV — red/orange triage stays staff-side to avoid waiting-room alarm
                          const tone = p ? "ok" : "idle";
                          return (
                            <article key={p?.token ?? `open-${slot}`} className={`tv-person tv-person-${tone}`}>
                              <p className="tv-person-token">{p?.token ?? "–"}</p>
                              <p className="tv-person-meta">
                                {p ? (p.ahead === 0 ? "Next in line" : `${p.ahead} ahead`) : "Open slot"}
                              </p>
                            </article>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="tv-dots">
                  {waitingQueues.length > 1 &&
                    waitingQueues.map((q, i) => (
                      <button
                        key={q.code}
                        type="button"
                        aria-label={q.name_en}
                        className={i === safeWait ? "is-on" : ""}
                        onClick={() => {
                          setWaitIndex(i);
                          setPairIndex(0);
                        }}
                      />
                    ))}
                  {waitPairs.length > 1 &&
                    waitPairs.map((_, i) => (
                      <button
                        key={`p-${i}`}
                        type="button"
                        aria-label={`Pair ${i + 1}`}
                        className={`is-pair ${i === safePair ? "is-on" : ""}`}
                        onClick={() => setPairIndex(i)}
                      />
                    ))}
                </div>
              </>
            )}
          </section>
        </div>

        <section className="tv-recent">
          <div className="tv-recent-head">
            <p className="tv-label">Recently called · 3 before · now · next</p>
            {callStrip.current && <p className="tv-meta">Focus · {callStrip.current.token}</p>}
          </div>

          {!callStrip.current ? (
            <p className="tv-empty">No calls yet</p>
          ) : (
            <div className="tv-strip">
              {[...callStrip.before].reverse().map((c, i) => (
                <div key={c ? `${c.token}-${c.called_at}` : `b-${i}`} className="tv-chip tv-chip-past">
                  <span>−{3 - i}</span>
                  <strong>{c?.token ?? "–"}</strong>
                  <em>{c?.counter ?? "–"}</em>
                </div>
              ))}
              <div className="tv-chip tv-chip-now">
                <span>Now</span>
                <strong>{callStrip.current.token}</strong>
                <em>→ {callStrip.current.counter || "–"}</em>
                <small>{callStrip.current.service_en}</small>
              </div>
              <div className="tv-chip tv-chip-next">
                <span>Next</span>
                <strong>{callStrip.next?.token ?? "–"}</strong>
                <em>{callStrip.next?.service_en ?? "–"}</em>
              </div>
            </div>
          )}
        </section>

        <div className="tv-footer-safe" aria-hidden />
      </div>
    </StaffOceanScene>
  );
}
