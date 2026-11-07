import { describe, expect, it } from "vitest";
import { formatToken, isLongWait, isSurge, sortQueue } from "./queue";

describe("queue rules", () => {
  it("serves emergency, then priority, then normal, oldest first within each", () => {
    const q = sortQueue([
      { id: "a", priority: 0, queued_at: "2026-01-01T08:00:00Z" },
      { id: "b", priority: 1, queued_at: "2026-01-01T08:05:00Z" },
      { id: "c", priority: 2, queued_at: "2026-01-01T08:10:00Z" },
      { id: "d", priority: 1, queued_at: "2026-01-01T08:01:00Z" },
    ]);
    expect(q.map((x) => x.id)).toEqual(["c", "d", "b", "a"]);
  });
  it("formats tokens as PREFIX-001", () => {
    expect(formatToken("OPD", 7)).toBe("OPD-007");
  });
  it("flags a long wait at 45 minutes regardless of department", () => {
    const now = Date.parse("2026-01-01T09:00:00Z");
    expect(isLongWait("2026-01-01T08:15:00Z", now, 60, 10)).toBe(true);
    expect(isLongWait("2026-01-01T08:50:00Z", now, 5, 5)).toBe(false);
  });
  it("triggers surge when waiting reaches the threshold", () => {
    expect(isSurge(25, 25)).toBe(true);
    expect(isSurge(24, 25)).toBe(false);
  });
});

it("puts red before orange before green at the same priority", () => {
  const r = sortQueue([
    { priority: 1, queued_at: "2026-01-01T08:00:00Z", triage_level: "orange", id: "o" },
    { priority: 0, queued_at: "2026-01-01T07:00:00Z", triage_level: "green", id: "g" },
    { priority: 1, queued_at: "2026-01-01T09:00:00Z", triage_level: "red", id: "r" },
  ]);
  expect(r.map((x) => x.id)).toEqual(["r", "o", "g"]);
});
