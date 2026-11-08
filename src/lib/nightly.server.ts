import { sql } from "./db.server";

// Nightly archive runs at 00:00 Africa/Nairobi. A quiet midnight can be missed
// when the free Render instance is asleep, so every request also checks in —
// caught up on the first visit after wake-up. The interval covers an awake
// server that receives no traffic.
const CHECK_INTERVAL_MS = 5 * 60_000;

let lastAttempt = 0;

/**
 * Export and delete fully cleared visits from previous days.
 * The SQL function is a no-op when there is nothing old to remove.
 */
export async function ensureNightlyArchive(): Promise<void> {
  const now = Date.now();
  if (now - lastAttempt < CHECK_INTERVAL_MS) return;
  lastAttempt = now;
  try {
    await sql`select public.run_nightly_archive()`;
  } catch (error) {
    console.error("nightly archive failed", error);
  }
}

const timer = setInterval(() => void ensureNightlyArchive(), CHECK_INTERVAL_MS);
timer.unref?.();
