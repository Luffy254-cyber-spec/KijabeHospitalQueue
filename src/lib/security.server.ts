import { createHmac, timingSafeEqual } from "node:crypto";
import { sql } from "@/lib/db.server";

/**
 * Server-side abuse controls: DB-backed sliding-window throttling for sign-in,
 * one-time codes and account recovery, plus Cloudflare Turnstile verification.
 * Nothing here trusts a client-supplied identity — IPs come from proxy headers
 * and subjects are stored only as keyed hashes.
 */

export class RateLimitError extends Error {
  readonly retryAfterSec: number;
  constructor(retryAfterSec: number, message: string) {
    super(message);
    this.name = "RateLimitError";
    this.retryAfterSec = Math.max(1, Math.round(retryAfterSec));
  }
}

export type Limit = { max: number; windowSec: number; blockSec: number };

const PEPPER = () =>
  process.env["AUTH_SECRET"] || "kijabe-local-dev-secret-change-me";

function hash(kind: string, value: string) {
  return createHmac("sha256", PEPPER())
    .update(`${kind}:${value.trim().toLowerCase()}`)
    .digest("hex")
    .slice(0, 40);
}

export function clientIp(request: Request): string {
  const headers = request.headers;
  const forwarded = headers.get("x-forwarded-for") || "";
  return (
    headers.get("cf-connecting-ip")?.trim() ||
    headers.get("x-real-ip")?.trim() ||
    forwarded.split(",")[0]?.trim() ||
    "unknown"
  );
}

type ThrottleRow = { allowed?: boolean; retry_after?: number };

async function hit(bucket: string, subject: string, limit: Limit): Promise<ThrottleRow> {
  const rows = await sql`
    select public.security_throttle_hit(
      ${bucket}, ${subject}, ${limit.windowSec}, ${limit.max}, ${limit.blockSec}
    ) as r
  `;
  return (rows[0]?.["r"] as ThrottleRow | undefined) ?? { allowed: true };
}

/**
 * Count one attempt against both the caller's IP and each subject (email, work
 * id). Throws RateLimitError when either bucket is over its limit.
 */
export async function guardRate(
  request: Request,
  bucket: string,
  subjects: Array<string | null | undefined>,
  ipLimit: Limit,
  subjectLimit: Limit,
  message = "Too many attempts. Please wait a few minutes and try again.",
) {
  const keys = [
    { bucket: `${bucket}:ip`, subject: `ip:${hash("ip", clientIp(request))}`, limit: ipLimit },
    ...subjects
      .map((s) => (s || "").trim())
      .filter(Boolean)
      .slice(0, 3)
      .map((s) => ({ bucket, subject: hash(bucket, s), limit: subjectLimit })),
  ];

  for (const key of keys) {
    const result = await hit(key.bucket, key.subject, key.limit);
    if (result.allowed === false) {
      throw new RateLimitError(Number(result.retry_after) || key.limit.blockSec, message);
    }
  }
}

/** Forget the counters after a genuinely successful attempt. */
export async function clearRate(
  request: Request,
  bucket: string,
  subjects: Array<string | null | undefined>,
) {
  const keys = [
    { bucket: `${bucket}:ip`, subject: `ip:${hash("ip", clientIp(request))}` },
    ...subjects
      .map((s) => (s || "").trim())
      .filter(Boolean)
      .slice(0, 3)
      .map((s) => ({ bucket, subject: hash(bucket, s) })),
  ];
  await Promise.all(
    keys.map((k) =>
      sql`select public.security_throttle_clear(${k.bucket}, ${k.subject})`.catch(() => {}),
    ),
  );
}

const turnsileSecret = () => (process.env["TURNSTILE_SECRET_KEY"] || "").trim();

export function turnstileEnabled() {
  return Boolean(turnsileSecret());
}

/**
 * Cloudflare Turnstile. Inert until TURNSTILE_SECRET_KEY is configured, so the
 * forms keep working before the account is created.
 */
export async function verifyTurnstile(request: Request, token: string | undefined) {
  const secret = turnsileSecret();
  if (!secret) return;
  const response = (token || "").trim();
  if (!response) {
    throw new Error("Complete the security check, then try again");
  }
  const form = new URLSearchParams({
    secret,
    response,
    remoteip: clientIp(request),
  });
  let data: { success?: boolean } = {};
  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: form,
    });
    data = (await res.json()) as { success?: boolean };
  } catch {
    throw new Error("Could not verify the security check — check your connection and try again");
  }
  if (!data.success) {
    throw new Error("Security check failed — refresh the page and try again");
  }
}

/** Constant-time compare for shared callback secrets. */
export function secretMatches(expected: string, provided: string | null | undefined) {
  if (!expected) return true;
  const a = Buffer.from(expected);
  const b = Buffer.from(provided || "");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
