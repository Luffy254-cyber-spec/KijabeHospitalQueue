import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { sql } from "@/lib/db.server";
import { SECRET, type SessionUser } from "@/lib/local-auth.server";

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const PERIOD_MS = 30_000;
const ENROLL_TTL_MS = 10 * 60 * 1000;
const ISSUER = "Kijabe Care Flow";

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += B32[(value >>> bits) & 31];
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    value = (value << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((value >>> bits) & 0xff);
      value &= (1 << bits) - 1;
    }
  }
  return Buffer.from(out);
}

/** RFC 4226 HOTP (SHA-1, dynamic truncation) — the core of RFC 6238 TOTP. */
export function hotp(secret: Buffer, counter: number, digits = 6): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", secret).update(msg).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const bin =
    ((digest[offset]! & 0x7f) << 24) |
    (digest[offset + 1]! << 16) |
    (digest[offset + 2]! << 8) |
    digest[offset + 3]!;
  return String(bin % 10 ** digits).padStart(digits, "0");
}

export function totpCode(secret: Buffer, timeMs: number, digits = 6): string {
  return hotp(secret, Math.floor(timeMs / PERIOD_MS), digits);
}

/**
 * Accept the current step plus one step of clock drift either way.
 * A step at or below lastStep is a replay (shoulder-surfed / intercepted code)
 * and is rejected even if it still falls inside the drift window.
 */
export function matchTotp(secret: Buffer, code: string, lastStep: number | null, timeMs = Date.now()): number | null {
  const cleaned = code.replace(/\D/g, "");
  if (cleaned.length !== 6) return null;
  const current = Math.floor(timeMs / PERIOD_MS);
  for (const offset of [0, -1, 1]) {
    const step = current + offset;
    if (lastStep !== null && step <= lastStep) continue;
    const expected = hotp(secret, step);
    const a = Buffer.from(cleaned);
    const b = Buffer.from(expected);
    if (a.length === b.length && timingSafeEqual(a, b)) return step;
  }
  return null;
}

// Secrets are sealed with a key derived from AUTH_SECRET so a database dump
// alone never yields working authenticator seeds.
function sealKey(): Buffer {
  return createHmac("sha256", SECRET()).update("kijabe-totp-at-rest-v1").digest();
}

export function sealSecret(secretB32: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", sealKey(), iv);
  const enc = Buffer.concat([cipher.update(secretB32, "utf8"), cipher.final()]);
  return [iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), enc.toString("base64url")].join(".");
}

export function openSecret(sealed: string): string | null {
  try {
    const [iv, tag, data] = sealed.split(".");
    if (!iv || !tag || !data) return null;
    const decipher = createDecipheriv("aes-256-gcm", sealKey(), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

export function buildTotpUri(email: string, secretB32: string): string {
  const label = `${encodeURIComponent(ISSUER)}:${encodeURIComponent(email.trim().toLowerCase())}`;
  const params = new URLSearchParams({
    secret: secretB32,
    issuer: ISSUER,
    algorithm: "SHA1",
    digits: "6",
    period: "30",
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

export async function totpEnabled(userId: string): Promise<boolean> {
  try {
    const rows = await sql`
      select 1 from auth.users
      where id = ${userId}::uuid and totp_enabled_at is not null and totp_secret_enc is not null
      limit 1
    `;
    return rows.length > 0;
  } catch {
    return false;
  }
}

export async function totpStatus(userId: string): Promise<{ enabled: boolean; enabledAt: string | null }> {
  try {
    const rows = await sql`
      select totp_enabled_at, totp_secret_enc from auth.users where id = ${userId}::uuid limit 1
    `;
    const row = rows[0] as { totp_enabled_at: string | null; totp_secret_enc: string | null } | undefined;
    const enabled = !!row?.totp_enabled_at && !!row?.totp_secret_enc;
    return { enabled, enabledAt: enabled ? row!.totp_enabled_at : null };
  } catch {
    return { enabled: false, enabledAt: null };
  }
}

export async function beginTotpEnrollment(user: SessionUser): Promise<{ secret: string; uri: string; expiresAt: string }> {
  if (await totpEnabled(user.id)) {
    throw new Error("Authenticator protection is already on — turn it off first to enroll a new device");
  }
  const secret = base32Encode(randomBytes(20));
  const expiresAt = new Date(Date.now() + ENROLL_TTL_MS).toISOString();
  await sql`
    update auth.users
    set totp_pending_enc = ${sealSecret(secret)}, totp_pending_expires = ${expiresAt}::timestamptz
    where id = ${user.id}::uuid
  `;
  return { secret, uri: buildTotpUri(user.email, secret), expiresAt };
}

export async function confirmTotpEnrollment(user: SessionUser, code: string): Promise<{ enabled: true; enabledAt: string }> {
  const rows = await sql`
    select totp_pending_enc, totp_pending_expires from auth.users where id = ${user.id}::uuid limit 1
  `;
  const row = rows[0] as { totp_pending_enc: string | null; totp_pending_expires: string | null } | undefined;
  if (!row?.totp_pending_enc || !row.totp_pending_expires) {
    throw new Error("No enrollment in progress — scan a fresh QR code first");
  }
  if (new Date(row.totp_pending_expires).getTime() < Date.now()) {
    throw new Error("Enrollment window expired — start again with a fresh QR code");
  }
  const secret = openSecret(row.totp_pending_enc);
  if (!secret) throw new Error("Could not read the enrollment secret — start again");
  const step = matchTotp(base32Decode(secret), code, null);
  if (step === null) {
    throw new Error("That code did not match — enter the current 6-digit code from your authenticator (it refreshes every 30 seconds)");
  }
  const enabledAt = new Date().toISOString();
  await sql`
    update auth.users
    set totp_secret_enc = totp_pending_enc,
        totp_enabled_at = ${enabledAt}::timestamptz,
        totp_last_step = ${step},
        totp_pending_enc = null,
        totp_pending_expires = null
    where id = ${user.id}::uuid
  `;
  return { enabled: true, enabledAt };
}

export async function disableTotp(user: SessionUser, code: string): Promise<{ enabled: false }> {
  const rows = await sql`
    select totp_secret_enc, totp_enabled_at, totp_last_step from auth.users where id = ${user.id}::uuid limit 1
  `;
  const row = rows[0] as {
    totp_secret_enc: string | null; totp_enabled_at: string | null; totp_last_step: string | number | null;
  } | undefined;
  if (!row?.totp_enabled_at || !row.totp_secret_enc) {
    throw new Error("Authenticator protection is not enabled on this account");
  }
  const secret = openSecret(row.totp_secret_enc);
  if (!secret) throw new Error("Could not read the authenticator secret — ask admin@kijabe.local to reset MFA");
  // Allow the code just used at sign-in: disabling proves possession, not freshness.
  const lastStep = row.totp_last_step === null ? null : Number(row.totp_last_step) - 1;
  if (matchTotp(base32Decode(secret), code, lastStep) === null) {
    throw new Error("Incorrect authenticator code — enter the current 6-digit code to turn protection off");
  }
  await sql`
    update auth.users
    set totp_secret_enc = null, totp_enabled_at = null, totp_last_step = null,
        totp_pending_enc = null, totp_pending_expires = null
    where id = ${user.id}::uuid
  `;
  return { enabled: false };
}

/** Lockout recovery: only a superadmin may strip MFA from another account. */
export async function adminResetTotp(actor: SessionUser, userId: string): Promise<{ ok: true }> {
  const roles = await sql`select role::text as role from public.user_roles where user_id = ${actor.id}::uuid`;
  if (!roles.some((r) => String(r.role) === "superadmin")) throw new Error("Superadmin only");
  if (!/^[0-9a-f-]{36}$/i.test(userId)) throw new Error("Staff account not found");
  const rows = await sql`
    update auth.users
    set totp_secret_enc = null, totp_enabled_at = null, totp_last_step = null,
        totp_pending_enc = null, totp_pending_expires = null
    where id = ${userId}::uuid
    returning id
  `;
  if (!rows.length) throw new Error("Staff account not found");
  return { ok: true };
}

/** Password proved; open a 10-minute window for the authenticator code (no email sent). */
export async function beginTotpLoginChallenge(email: string): Promise<void> {
  await sql`
    update auth.users
    set login_code_hash = null,
        login_code_expires = now() + interval '10 minutes',
        login_pending_token = null
    where lower(email) = ${email.trim().toLowerCase()}
  `;
}