export type QueueItem = { priority: number; queued_at: string; triage_level?: string | null };

const TRIAGE_RANK: Record<string, number> = { red: 2, orange: 1, green: 0 };

/** Emergency (2) before priority (1) before normal (0); within a level red before orange before green; then first come, first served. */
export function sortQueue<T extends QueueItem>(items: T[]): T[] {
  return [...items].sort(
    (a, b) => b.priority - a.priority
      || (TRIAGE_RANK[b.triage_level ?? "green"] ?? 0) - (TRIAGE_RANK[a.triage_level ?? "green"] ?? 0)
      || new Date(a.queued_at).getTime() - new Date(b.queued_at).getTime(),
  );
}

export function formatToken(prefix: string, n: number): string {
  return `${prefix}-${String(n).padStart(3, "0")}`;
}

export const PRIORITY_LABEL: Record<number, string> = { 0: "Normal", 1: "Priority", 2: "Emergency" };
export const PAYMENT_LABEL: Record<string, string> = {
  cash: "Cash / M-Pesa",
  card: "Bank card",
  insurance: "Insurance",
  sha: "SHA",
};

/** Desks allowed to see insurer / card cover details */
export const COVER_DESK_CODES = new Set(["registration", "cashier", "insurance", "sha"]);

/** Desks that may release a patient without choosing the next department */
export const RELEASE_DESK_CODES = new Set(["pharmacy", "cashier", "insurance", "sha"]);

/** Desks that must see walk-in priority / emergency reasons */
export const REASON_DESK_CODES = new Set(["triage", "consultation", "emergency"]);

export const ACTION_LABEL: Record<string, string> = {
  issued: "Ticket issued",
  called: "Called",
  recall: "Recalled",
  start: "Started serving",
  complete: "Completed",
  no_show: "No-show — returned to waiting",
  requeue: "Returned to queue",
  transfer: "Transferred",
  auto_recall: "Auto-recalled",
  auto_no_show: "Auto no-show — returned to waiting",
  auto_requeue: "Missed patient returned to queue",
  auto_route: "Moved to next step",
  skip: "Skipped (not responding)",
  escalate: "Escalated to emergency",
  escalate_priority: "Escalated to priority",
  return_common: "Returned to common (normal)",
  day_close: "Closed at end of day",
};

/** Staff desk reasons when changing priority / returning to common. */
export const PRIORITY_CHANGE_REASONS = {
  escalate: [
    "Severe pain",
    "Difficulty breathing / chest pain",
    "Unconscious / fainting / fits",
    "Heavy bleeding / trauma",
    "Rapidly worsening condition",
    "Other clinical concern",
  ],
  escalate_priority: [
    "Elderly (65+)",
    "Pregnant",
    "Disability",
    "Mother with infant",
    "Significant pain",
    "Needs faster clinical review",
    "Other",
  ],
  return_common: [
    "Condition improved / stable",
    "Mis-triaged at walk-in",
    "Seen and cleared for normal queue",
    "Not an emergency after assessment",
    "Patient request — not urgent",
    "Other",
  ],
} as const;

/** Elapsed wait since queued_at as H:MM:SS (hours can exceed 9). */
export function formatWaitDuration(queuedAt: string, nowMs: number): string {
  const ms = Math.max(0, nowMs - new Date(queuedAt).getTime());
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** A patient is flagged as a long wait after 45 minutes, or twice the department's usual time per patient times their position. */
export function isLongWait(queuedAt: string, now: number, avgMinutes: number, position: number, limitMinutes = 45): boolean {
  const waited = (now - new Date(queuedAt).getTime()) / 60000;
  return waited >= limitMinutes || (avgMinutes > 0 && waited >= Math.max(15, 2 * avgMinutes * (position + 1)));
}

export function isSurge(waiting: number, threshold: number): boolean {
  return threshold > 0 && waiting >= threshold;
}
