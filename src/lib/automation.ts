export type AutomationSettings = {
  recall_enabled: boolean;
  recall_after_min: number;
  max_recalls: number;
  no_show_enabled: boolean;
  no_show_after_min: number;
  requeue_enabled: boolean;
  requeue_after_min: number;
  max_returns: number;
  surge_enabled: boolean;
  surge_threshold: number;
  long_wait_enabled: boolean;
  long_wait_min: number;
};

export const DEFAULT_SETTINGS: AutomationSettings = {
  recall_enabled: true, recall_after_min: 2, max_recalls: 2,
  no_show_enabled: true, no_show_after_min: 2,
  requeue_enabled: true, requeue_after_min: 15, max_returns: 2,
  surge_enabled: true, surge_threshold: 25,
  long_wait_enabled: true, long_wait_min: 45,
};

/** Allowed ranges — must match the database checks. */
export const LIMITS: Record<keyof AutomationSettings, [number, number] | null> = {
  recall_enabled: null, recall_after_min: [1, 30], max_recalls: [0, 5],
  no_show_enabled: null, no_show_after_min: [1, 60],
  requeue_enabled: null, requeue_after_min: [1, 240], max_returns: [0, 5],
  surge_enabled: null, surge_threshold: [1, 500],
  long_wait_enabled: null, long_wait_min: [5, 480],
};

/** Coerce any (e.g. AI-suggested) values into safe, allowed settings. */
export function clampSettings(input: Partial<Record<keyof AutomationSettings, unknown>>, base: AutomationSettings = DEFAULT_SETTINGS): AutomationSettings {
  const out = { ...base } as Record<string, number | boolean>;
  for (const k of Object.keys(LIMITS) as (keyof AutomationSettings)[]) {
    const v = input[k];
    const lim = LIMITS[k];
    if (lim === null) { if (typeof v === "boolean") out[k] = v; continue; }
    const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
    if (Number.isFinite(n)) out[k] = Math.min(lim[1], Math.max(lim[0], Math.round(n)));
  }
  return out as AutomationSettings;
}

export type SampleTicket = {
  token: string;
  status: "called" | "no_show" | "waiting";
  /** minutes since called / marked missed / joined the queue */
  minutesAgo: number;
  recalls: number;
  returns: number;
  /** minute (from now) when the patient comes forward, or null if they never do */
  arrivesAt: number | null;
};

export type SimEvent = { minute: number; token: string; action: "recall" | "no_show" | "requeue" | "came_forward" | "long_wait" | "overflow_open" };

export function simulate(settings: AutomationSettings, sample: SampleTicket[], extraWaiting: number, horizon = 60) {
  const s = settings;
  const tix = sample.map((t) => ({ ...t, since: t.minutesAgo, flagged: false, done: false }));
  const events: SimEvent[] = [];
  let overflowOpen = false;
  for (let m = 1; m <= horizon; m++) {
    for (const t of tix) {
      if (t.done) continue;
      t.since += 1;
      if (t.status === "called") {
        if (t.arrivesAt !== null && m >= t.arrivesAt) { t.done = true; events.push({ minute: m, token: t.token, action: "came_forward" }); continue; }
        if (s.recall_enabled && t.since > s.recall_after_min && t.recalls < s.max_recalls) {
          t.recalls++; t.since = 0; events.push({ minute: m, token: t.token, action: "recall" });
        } else if (s.no_show_enabled && t.since > s.no_show_after_min && (t.recalls >= s.max_recalls || !s.recall_enabled)) {
          t.status = "no_show"; t.since = 0; events.push({ minute: m, token: t.token, action: "no_show" });
        }
      } else if (t.status === "no_show") {
        if (s.requeue_enabled && t.since > s.requeue_after_min && t.returns < s.max_returns) {
          t.status = "waiting"; t.returns++; t.recalls = 0; t.since = 0; t.flagged = false;
          events.push({ minute: m, token: t.token, action: "requeue" });
        }
      } else if (t.status === "waiting") {
        if (s.long_wait_enabled && !t.flagged && t.since >= s.long_wait_min) { t.flagged = true; events.push({ minute: m, token: t.token, action: "long_wait" }); }
      }
    }
    const waiting = extraWaiting + tix.filter((t) => !t.done && t.status === "waiting").length;
    if (s.surge_enabled && !overflowOpen && waiting >= s.surge_threshold) { overflowOpen = true; events.push({ minute: m, token: "—", action: "overflow_open" }); }
  }
  const count = (a: SimEvent["action"]) => events.filter((e) => e.action === a).length;
  return {
    events,
    summary: {
      recalls: count("recall"), no_shows: count("no_show"), requeued: count("requeue"),
      long_waits: count("long_wait"), overflow_opened: overflowOpen,
      still_missed: tix.filter((t) => !t.done && t.status === "no_show").length,
    },
  };
}

export const SIM_LABEL: Record<SimEvent["action"], string> = {
  recall: "Called again", no_show: "Marked missed", requeue: "Back in queue (priority)",
  came_forward: "Came to desk", long_wait: "Long-wait alert", overflow_open: "Overflow desk opens",
};

export function sampleTickets(prefix = "OPD"): SampleTicket[] {
  return [
    { token: `${prefix}-101`, status: "called", minutesAgo: 0, recalls: 0, returns: 0, arrivesAt: 1 },
    { token: `${prefix}-102`, status: "called", minutesAgo: 1, recalls: 0, returns: 0, arrivesAt: 4 },
    { token: `${prefix}-103`, status: "called", minutesAgo: 0, recalls: 0, returns: 0, arrivesAt: null },
    { token: `${prefix}-104`, status: "no_show", minutesAgo: 10, recalls: 2, returns: 0, arrivesAt: null },
    { token: `${prefix}-105`, status: "waiting", minutesAgo: 30, recalls: 0, returns: 0, arrivesAt: null },
    { token: `${prefix}-106`, status: "waiting", minutesAgo: 5, recalls: 0, returns: 0, arrivesAt: null },
  ];
}
