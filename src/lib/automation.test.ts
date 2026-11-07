import { describe, expect, it } from "vitest";
import { clampSettings, DEFAULT_SETTINGS, simulate, type SampleTicket } from "./automation";

const absent: SampleTicket = { token: "A-1", status: "called", minutesAgo: 0, recalls: 0, returns: 0, arrivesAt: null };

describe("automation settings", () => {
  it("clamps unsafe AI suggestions into allowed ranges", () => {
    const s = clampSettings({ recall_after_min: 0, max_recalls: 99, long_wait_min: "1000", surge_enabled: false });
    expect(s.recall_after_min).toBe(1);
    expect(s.max_recalls).toBe(5);
    expect(s.long_wait_min).toBe(480);
    expect(s.surge_enabled).toBe(false);
  });

  it("recalls twice then marks an absent patient missed with default rules", () => {
    const r = simulate(DEFAULT_SETTINGS, [absent], 0, 10);
    expect(r.events.map((e) => e.action)).toEqual(["recall", "recall", "no_show"]);
  });

  it("does nothing automatic when recall and no-show are switched off", () => {
    const r = simulate({ ...DEFAULT_SETTINGS, recall_enabled: false, no_show_enabled: false }, [absent], 0, 30);
    expect(r.events).toHaveLength(0);
  });

  it("returns a missed patient after the requeue delay, up to the limit", () => {
    const missed: SampleTicket = { ...absent, status: "no_show", recalls: 2, returns: 2 };
    expect(simulate(DEFAULT_SETTINGS, [missed], 0, 60).summary.requeued).toBe(0);
    expect(simulate(DEFAULT_SETTINGS, [{ ...missed, returns: 0 }], 0, 16).summary.requeued).toBe(1);
  });

  it("opens an overflow desk when waiting reaches the threshold", () => {
    expect(simulate({ ...DEFAULT_SETTINGS, surge_threshold: 25 }, [], 25, 1).summary.overflow_opened).toBe(true);
    expect(simulate({ ...DEFAULT_SETTINGS, surge_threshold: 25 }, [], 24, 1).summary.overflow_opened).toBe(false);
  });
});
