import { createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { sql } from "@/lib/db.server";
import {
  codeHash,
  confirmStaffEmail,
  purgeFirebaseAccount,
  sendEmailChangeCode,
  sendEmailChangeVerification,
  sendLoginVerificationCode,
  sendPasswordResetCode,
  sendStaffConfirmEmail,
} from "@/lib/firebase-mail.server";
import { base32Decode, beginTotpLoginChallenge, matchTotp, openSecret, totpEnabled } from "@/lib/mfa.server";

// Session tokens are HMAC-signed: a guessable secret lets anyone forge a login,
// so production refuses to start signing with the development fallback.
export const SECRET = () => {
  const value = (process.env["AUTH_SECRET"] || "").trim();
  if (value.length >= 32) return value;
  if (process.env["NODE_ENV"] === "production" || process.env["APP_ENV"] === "production") {
    throw new Error("AUTH_SECRET must be set to at least 32 characters in production");
  }
  return "kijabe-local-dev-secret-change-me";
};

export type SessionUser = { id: string; email: string; roles?: string[] };

export function normalizeWorkId(raw: string) {
  return raw.trim().toUpperCase().replace(/\s+/g, "");
}

/** Keyed hash: work IDs are never stored in plain text and cannot be reversed from the DB. */
export function workIdHash(raw: string) {
  return createHmac("sha256", SECRET()).update(`kijabe-work-id:${normalizeWorkId(raw)}`).digest("hex");
}

/** Resolve a staff account from a work ID via its blind index. */
export async function findUserByWorkId(raw: string) {
  const cleaned = normalizeWorkId(raw);
  if (cleaned.length < 4) return undefined;
  const rows = await sql`
    select u.id, u.email, u.email_confirmed_at
    from auth.users u
    join public.staff_profiles sp on sp.user_id = u.id
    where sp.work_id_hash = ${workIdHash(cleaned)}
    limit 1
  `;
  return rows[0] as { id: string; email: string; email_confirmed_at: string | null } | undefined;
}

/** Superadmin assigns (or replaces) a staff work ID. Only the hash and last 4 digits are kept. */
export async function setStaffWorkId(actor: SessionUser, userId: string, rawWorkId: string) {
  const roles = await userRoles(actor.id);
  if (!roles.includes("superadmin")) throw new Error("Superadmin only");
  if (!/^[0-9a-f-]{36}$/i.test(userId)) throw new Error("Staff account not found");
  const cleaned = normalizeWorkId(rawWorkId);
  if (!/^[A-Z0-9][A-Z0-9/-]{3,23}$/.test(cleaned)) {
    throw new Error("Work ID must be 4–24 letters, numbers, / or -");
  }
  const target = await sql`select id from auth.users where id = ${userId}::uuid limit 1`;
  if (!target.length) throw new Error("Staff account not found");
  await sql`
    insert into public.staff_profiles(user_id, full_name, status)
    select u.id, split_part(u.email, '@', 1), 'approved'
    from auth.users u where u.id = ${userId}::uuid
    on conflict (user_id) do nothing
  `;
  try {
    const rows = await sql`
      update public.staff_profiles
      set work_id_hash = ${workIdHash(cleaned)},
          work_id_last4 = ${cleaned.slice(-4)},
          work_id_set_at = now(),
          updated_at = now()
      where user_id = ${userId}::uuid
      returning user_id
    `;
    if (!rows.length) throw new Error("Staff profile not found");
  } catch (e) {
    const msg = String((e as Error)?.message || e);
    if (/unique|duplicate/i.test(msg)) {
      throw new Error("That work ID is already assigned to another staff member");
    }
    throw e;
  }
  return { ok: true as const, workId: cleaned, last4: cleaned.slice(-4) };
}

function b64url(input: string | Buffer) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function fromB64url(input: string) {
  const pad = input.length % 4 === 0 ? "" : "=".repeat(4 - (input.length % 4));
  return Buffer.from(input.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64").toString("utf8");
}

export function signToken(user: SessionUser, ttlSec = 60 * 60 * 24 * 7): string {
  const payload = {
    sub: user.id,
    email: user.email,
    roles: user.roles || [],
    exp: Math.floor(Date.now() / 1000) + ttlSec,
  };
  const body = b64url(JSON.stringify(payload));
  const sig = createHmac("sha256", SECRET()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyToken(token: string | null | undefined): SessionUser | null {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expect = createHmac("sha256", SECRET()).update(body).digest("base64url");
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expect);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  try {
    const payload = JSON.parse(fromB64url(body)) as { sub: string; email: string; exp: number; roles?: string[] };
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return { id: payload.sub, email: payload.email, roles: payload.roles || [] };
  } catch {
    return null;
  }
}

export function bearerUser(req: Request): SessionUser | null {
  const h = req.headers.get("Authorization") || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return verifyToken(m?.[1] || null);
}

async function userRoles(userId: string): Promise<string[]> {
  const rows = await sql`
    select role::text as role from public.user_roles where user_id = ${userId}::uuid
  `;
  return rows.map((r) => String(r.role));
}

async function staffStatus(userId: string): Promise<string> {
  const rows = await sql`
    select status from public.staff_profiles where user_id = ${userId}::uuid limit 1
  `;
  if (rows[0]?.status) return String(rows[0].status);
  return "approved"; // legacy users without a profile
}

function isElevated(roles: string[]) {
  return roles.includes("superadmin") || roles.includes("admin");
}

async function findUserByPassword(email: string, password: string) {
  const rows = await sql`
    select id, email, email_confirmed_at from auth.users
    where lower(email) = lower(${email.trim()})
      and encrypted_password = crypt(${password}, encrypted_password)
    limit 1
  `;
  return rows[0] as { id: string; email: string; email_confirmed_at: string | null } | undefined;
}

async function sessionFor(row: { id: string; email: string }) {
  const roles = await userRoles(String(row.id));
  const user = { id: String(row.id), email: String(row.email), roles };
  return { user, access_token: signToken(user) };
}

async function assertCanLogin(row: { id: string; email: string; email_confirmed_at: string | null }) {
  const roles = await userRoles(String(row.id));
  if (isElevated(roles)) return roles;
  if (!row.email_confirmed_at) {
    throw new Error(
      "Confirm your email before signing in — check Spam / Junk / Promotions if the confirmation mail is missing",
    );
  }
  const status = await staffStatus(String(row.id));
  if (status === "pending") {
    throw new Error("Your account is awaiting superadmin approval (admin@kijabe.local)");
  }
  if (status === "suspended") throw new Error("Your account is suspended — contact the hospital admin");
  if (status === "rejected") throw new Error("Your registration was not approved");
  return roles;
}

/** Legacy direct sign-in */
export async function signIn(email: string, password: string) {
  const row = await findUserByPassword(email, password);
  if (!row) throw new Error("Invalid email or password");
  await assertCanLogin(row);
  if (await totpEnabled(String(row.id))) {
    throw new Error("Authenticator code required — sign in with email + password and enter your 6-digit code");
  }
  return sessionFor(row);
}

/**
 * Step 1: password OK.
 * TOTP enrolled (any role) → authenticator challenge, no email sent.
 * Superadmin/admin without TOTP → immediate session (no verification).
 * Staff → email verification code.
 */
export async function requestLoginCode(email: string, password: string, origin: string) {
  const row = await findUserByPassword(email, password);
  if (!row) throw new Error("Invalid email or password");
  const roles = await assertCanLogin(row);

  if (await totpEnabled(String(row.id))) {
    await beginTotpLoginChallenge(row.email);
    return { needsCode: true as const, mfa: "totp" as const, email: row.email, mailFailed: false };
  }

  if (isElevated(roles)) {
    const s = await sessionFor(row);
    return { needsCode: false as const, session: s, email: row.email };
  }

  const sent = await sendLoginVerificationCode(row.email, `${origin}/staff/verify`);
  return {
    needsCode: true as const,
    email: row.email,
    pending: sent.pending,
    // Only surfaced when mail actually failed (offline/kiosk fallback); never
    // hand the one-time code back while it is also sitting in the inbox.
    code: sent.mailFailed ? sent.code : undefined,
    mailFailed: sent.mailFailed,
  };
}

export async function verifyLoginCode(email: string, code: string) {
  const address = email.trim().toLowerCase();
  const cleaned = code.replace(/\D/g, "").trim();
  const rows = await sql`
    select id, email, email_confirmed_at, login_code_hash, login_code_expires,
           totp_secret_enc, totp_enabled_at, totp_last_step
    from auth.users where lower(email) = ${address} limit 1
  `;
  const row = rows[0] as {
    id: string; email: string; email_confirmed_at: string | null;
    login_code_hash: string | null; login_code_expires: string | null;
    totp_secret_enc: string | null; totp_enabled_at: string | null; totp_last_step: string | number | null;
  } | undefined;
  if (row?.totp_enabled_at && row.totp_secret_enc) {
    if (!row.login_code_expires || new Date(row.login_code_expires).getTime() < Date.now()) {
      throw new Error("Sign-in window expired — enter your password again, then the authenticator code");
    }
    const secret = openSecret(row.totp_secret_enc);
    if (!secret) throw new Error("Authenticator secret unreadable — ask admin@kijabe.local to reset your MFA");
    const lastStep = row.totp_last_step === null ? null : Number(row.totp_last_step);
    const step = matchTotp(base32Decode(secret), cleaned, lastStep);
    if (step === null) {
      throw new Error("Incorrect authenticator code — enter the current 6-digit code from your app (it refreshes every 30 seconds)");
    }
    await assertCanLogin(row);
    await sql`
      update auth.users
      set totp_last_step = ${step},
          login_code_hash = null, login_code_expires = null, login_pending_token = null
      where id = ${row.id}::uuid
    `;
    return sessionFor(row);
  }
  if (!row?.login_code_hash || !row.login_code_expires) {
    throw new Error("No verification code pending — sign in again to get a new code");
  }
  if (new Date(row.login_code_expires).getTime() < Date.now()) {
    throw new Error("Verification code expired — sign in again for a fresh code (check Spam / Junk)");
  }
  if (row.login_code_hash !== codeHash(cleaned)) {
    throw new Error("Incorrect verification code — check the email (including Spam) or sign in again");
  }
  await assertCanLogin(row);
  await sql`
    update auth.users
    set login_code_hash = null, login_code_expires = null, login_pending_token = null
    where id = ${row.id}::uuid
  `;
  return sessionFor(row);
}

export async function completeLoginPending(email: string, pending: string) {
  const address = email.trim().toLowerCase();
  const rows = await sql`
    select id, email, email_confirmed_at, totp_enabled_at from auth.users
    where lower(email) = ${address}
      and login_pending_token = ${pending}
      and login_code_expires > now()
    limit 1
  `;
  const row = rows[0] as { id: string; email: string; email_confirmed_at: string | null; totp_enabled_at: string | null } | undefined;
  if (!row) throw new Error("Login link invalid or expired");
  // The emailed link must never bypass an enrolled authenticator.
  if (row.totp_enabled_at) {
    throw new Error("This account uses an authenticator app — sign in with your password and enter the 6-digit code");
  }
  await assertCanLogin(row);
  await sql`
    update auth.users
    set login_code_hash = null, login_code_expires = null, login_pending_token = null
    where id = ${row.id}::uuid
  `;
  await confirmStaffEmail(address);
  return sessionFor(row);
}

export async function completeSignupConfirm(email: string, signupToken?: string) {
  const address = email.trim().toLowerCase();
  await confirmStaffEmail(address, signupToken);
  const rows = await sql`
    select id, email, email_confirmed_at from auth.users where lower(email) = ${address} limit 1
  `;
  const row = rows[0] as { id: string; email: string; email_confirmed_at: string | null } | undefined;
  if (!row?.email_confirmed_at) throw new Error("Email not confirmed");
  const roles = await userRoles(String(row.id));
  if (isElevated(roles)) return { ...await sessionFor(row), awaitingApproval: false as const };
  const status = await staffStatus(String(row.id));
  if (status !== "approved") {
    return { user: { id: String(row.id), email: String(row.email) }, access_token: null as string | null, awaitingApproval: true as const };
  }
  return { ...await sessionFor(row), awaitingApproval: false as const };
}

export async function signUp(
  email: string,
  password: string,
  origin: string,
  profile?: { firstName?: string; lastName?: string; surname?: string; phone?: string },
) {
  if (password.length < 8) throw new Error("Password must be at least 8 characters");
  const fname = (profile?.firstName || "").trim().replace(/\s+/g, " ");
  const lname = (profile?.lastName || "").trim().replace(/\s+/g, " ");
  const sname = (profile?.surname || "").trim().replace(/\s+/g, " ");
  const phone = (profile?.phone || "").trim() || null;
  const fullName = [fname, lname, sname].filter(Boolean).join(" ") || email.split("@")[0] || "staff";
  if (fname && fname.length < 2) throw new Error("First name is required");
  const hash = await sql`select crypt(${password}, gen_salt('bf')) as h`;
  try {
    const rows = await sql`
      insert into auth.users (email, encrypted_password, email_confirmed_at)
      values (${email.trim().toLowerCase()}, ${hash[0]!.h}, null)
      returning id, email
    `;
    const user = { id: String(rows[0]!.id), email: String(rows[0]!.email) };
    await sql`
      insert into public.user_roles(user_id, role)
      values (${user.id}::uuid, 'staff')
      on conflict (user_id, role) do nothing
    `;
    // New accounts stay pending until a superadmin approves (security)
    await sql`
      insert into public.staff_profiles(user_id, full_name, first_name, last_name, surname, phone, status)
      values (
        ${user.id}::uuid, ${fullName},
        ${fname || null}, ${lname || null}, ${sname || null}, ${phone},
        'pending'
      )
      on conflict (user_id) do update set
        full_name = excluded.full_name,
        first_name = excluded.first_name,
        last_name = excluded.last_name,
        surname = excluded.surname,
        phone = coalesce(excluded.phone, staff_profiles.phone)
    `;
    if (user.email.endsWith(".local") && user.email !== "admin@kijabe.local") {
      await sql`update auth.users set email_confirmed_at = now() where id = ${user.id}::uuid`;
      return {
        user,
        access_token: null as string | null,
        needsConfirmation: false as const,
        awaitingApproval: true as const,
      };
    }
    if (user.email === "admin@kijabe.local") {
      await sql`update auth.users set email_confirmed_at = now() where id = ${user.id}::uuid`;
      await sql`
        insert into public.user_roles(user_id, role) values (${user.id}::uuid, 'superadmin')
        on conflict do nothing
      `;
      await sql`update public.staff_profiles set status = 'approved', approved_at = now() where user_id = ${user.id}::uuid`;
      return { user, access_token: signToken({ ...user, roles: ["superadmin", "staff"] }), needsConfirmation: false as const };
    }
    // Mark confirmed in Postgres immediately: on LAN, Firebase continueUrl cannot point at a private IP,
    // so clicking the mail link would never update our DB. Superadmin approval + login codes remain the gates.
    try {
      await sendStaffConfirmEmail(user.email, `${origin}/staff/verify`);
      await sql`update auth.users set email_confirmed_at = now() where id = ${user.id}::uuid`;
      return {
        user,
        access_token: null as string | null,
        needsConfirmation: true as const,
        awaitingApproval: true as const,
      };
    } catch (mailErr) {
      console.warn("Staff confirm email failed", mailErr);
      await sql`update auth.users set email_confirmed_at = now() where id = ${user.id}::uuid`;
      return {
        user,
        access_token: null as string | null,
        needsConfirmation: false as const,
        awaitingApproval: true as const,
        mailFailed: true as const,
      };
    }
  } catch (e) {
    const msg = String((e as Error)?.message || e);
    if (/unique|duplicate/i.test(msg)) throw new Error("Email already registered");
    throw e;
  }
}

/* ---- account recovery: password reset and email change ---------------------
 * Both start with a 6-digit code mailed by Firebase, end with a single-use
 * ticket the browser carries to the next page. Codes and tickets are stored
 * as hashes with a short expiry.
 */

function sixDigits() {
  return String(randomInt(100000, 999999));
}

function normalizeEmail(raw: string) {
  return (raw || "").trim().toLowerCase();
}

async function accountRow(email: string) {
  const rows = await sql`
    select id, email from auth.users where lower(email) = ${normalizeEmail(email)} limit 1
  `;
  return rows[0] as { id: string; email: string } | undefined;
}

export async function requestPasswordReset(email: string, origin: string) {
  const row = await accountRow(email);
  if (!row) throw new Error("No staff account uses that email");
  const code = sixDigits();
  await sql`
    update auth.users
    set reset_code_hash = ${codeHash(code)},
        reset_code_expires = now() + interval '10 minutes',
        reset_ticket_hash = null,
        reset_ticket_expires = null
    where id = ${row.id}::uuid
  `;
  const sent = await sendPasswordResetCode(String(row.email), code, `${origin}/staff/code?purpose=reset`);
  return {
    email: String(row.email),
    code: sent.mailFailed ? sent.code : undefined,
    mailFailed: !!sent.mailFailed,
  };
}

export async function verifyPasswordResetCode(email: string, code: string) {
  const address = normalizeEmail(email);
  const cleaned = (code || "").replace(/\D/g, "").trim();
  const rows = await sql`
    select id, email, reset_code_hash, reset_code_expires
    from auth.users where lower(email) = ${address} limit 1
  `;
  const row = rows[0] as {
    id: string; email: string;
    reset_code_hash: string | null; reset_code_expires: string | null;
  } | undefined;
  if (!row?.reset_code_hash || !row.reset_code_expires) {
    throw new Error("No reset code pending — request a new one");
  }
  if (new Date(row.reset_code_expires).getTime() < Date.now()) {
    throw new Error("Reset code expired — request a new one (check Spam / Junk)");
  }
  if (row.reset_code_hash !== codeHash(cleaned)) {
    throw new Error("Incorrect code — check the email (including Spam) or request a new one");
  }
  const ticket = randomBytes(24).toString("base64url");
  await sql`
    update auth.users
    set reset_code_hash = null,
        reset_code_expires = null,
        reset_ticket_hash = ${codeHash(ticket)},
        reset_ticket_expires = now() + interval '20 minutes'
    where id = ${row.id}::uuid
  `;
  return { email: String(row.email), ticket };
}

export async function completePasswordReset(email: string, ticket: string, password: string) {
  if (!password || password.length < 8) throw new Error("Password must be at least 8 characters");
  const address = normalizeEmail(email);
  const rows = await sql`
    select id, reset_ticket_hash, reset_ticket_expires
    from auth.users where lower(email) = ${address} limit 1
  `;
  const row = rows[0] as {
    id: string; reset_ticket_hash: string | null; reset_ticket_expires: string | null;
  } | undefined;
  if (!row?.reset_ticket_hash || !row.reset_ticket_expires) {
    throw new Error("Start the reset again — the code step has expired");
  }
  if (new Date(row.reset_ticket_expires).getTime() < Date.now()) {
    throw new Error("Reset session expired — request a new code");
  }
  if (row.reset_ticket_hash !== codeHash((ticket || "").trim())) {
    throw new Error("Reset session is not valid — request a new code");
  }
  const hash = await sql`select crypt(${password}, gen_salt('bf')) as h`;
  await sql`
    update auth.users
    set encrypted_password = ${hash[0]!.h},
        reset_code_hash = null,
        reset_code_expires = null,
        reset_ticket_hash = null,
        reset_ticket_expires = null,
        login_code_hash = null,
        login_code_expires = null,
        login_pending_token = null,
        updated_at = now()
    where id = ${row.id}::uuid
  `;
  return { email: address };
}

export async function requestEmailChangeCode(email: string, origin: string) {
  const row = await accountRow(email);
  if (!row) throw new Error("No staff account uses that email");
  const code = sixDigits();
  await sql`
    update auth.users
    set email_change_code_hash = ${codeHash(code)},
        email_change_code_expires = now() + interval '10 minutes',
        email_change_ticket_hash = null,
        email_change_ticket_expires = null
    where id = ${row.id}::uuid
  `;
  const sent = await sendEmailChangeCode(String(row.email), code, `${origin}/staff/code?purpose=change-email`);
  return {
    email: String(row.email),
    code: sent.mailFailed ? sent.code : undefined,
    mailFailed: !!sent.mailFailed,
  };
}

export async function verifyEmailChangeCode(email: string, code: string) {
  const address = normalizeEmail(email);
  const cleaned = (code || "").replace(/\D/g, "").trim();
  const rows = await sql`
    select id, email, email_change_code_hash, email_change_code_expires
    from auth.users where lower(email) = ${address} limit 1
  `;
  const row = rows[0] as {
    id: string; email: string;
    email_change_code_hash: string | null; email_change_code_expires: string | null;
  } | undefined;
  if (!row?.email_change_code_hash || !row.email_change_code_expires) {
    throw new Error("No email change code pending — request a new one");
  }
  if (new Date(row.email_change_code_expires).getTime() < Date.now()) {
    throw new Error("Code expired — request a new one (check Spam / Junk)");
  }
  if (row.email_change_code_hash !== codeHash(cleaned)) {
    throw new Error("Incorrect code — check the email (including Spam) or request a new one");
  }
  const ticket = randomBytes(24).toString("base64url");
  await sql`
    update auth.users
    set email_change_code_hash = null,
        email_change_code_expires = null,
        email_change_ticket_hash = ${codeHash(ticket)},
        email_change_ticket_expires = now() + interval '20 minutes'
    where id = ${row.id}::uuid
  `;
  return { email: String(row.email), ticket };
}

/** Step after the code: ask for the new address, then mail a confirmation link to it. */
export async function beginEmailChange(email: string, ticket: string, newEmail: string, origin: string) {
  const address = normalizeEmail(email);
  const next = normalizeEmail(newEmail);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next)) throw new Error("Enter a valid email address");
  if (next.endsWith(".local")) throw new Error("Use an email address you can open");
  const rows = await sql`
    select id, email_change_ticket_hash, email_change_ticket_expires
    from auth.users where lower(email) = ${address} limit 1
  `;
  const row = rows[0] as {
    id: string; email_change_ticket_hash: string | null; email_change_ticket_expires: string | null;
  } | undefined;
  if (!row?.email_change_ticket_hash || !row.email_change_ticket_expires) {
    throw new Error("Start the change again — the code step has expired");
  }
  if (new Date(row.email_change_ticket_expires).getTime() < Date.now()) {
    throw new Error("Change session expired — request a new code");
  }
  if (row.email_change_ticket_hash !== codeHash((ticket || "").trim())) {
    throw new Error("Change session is not valid — request a new code");
  }
  if (next === address) throw new Error("That is already your email");
  const clash = await sql`select id from auth.users where lower(email) = ${next} limit 1`;
  if (clash.length) throw new Error("Another staff account already uses that email");

  const token = randomBytes(24).toString("base64url");
  const sent = await sendEmailChangeVerification(
    address,
    next,
    `${origin}/staff/verify?changeEmail=${encodeURIComponent(token)}`,
  );
  await sql`
    update auth.users
    set email_change_code_hash = null,
        email_change_code_expires = null,
        email_change_ticket_hash = null,
        email_change_ticket_expires = null,
        email_change_new_email = ${next},
        email_change_confirm_token = ${codeHash(token)},
        email_change_confirm_expires = now() + interval '2 days',
        email_change_fb_local_id = ${sent.firebaseLocalId ?? null},
        email_change_fb_secret = ${sent.firebaseSecret ?? null}
    where id = ${row.id}::uuid
  `;
  return { email: next, mailFailed: !!sent.mailFailed };
}

/** The link mailed to the new address: only now does the address change. */
export async function confirmEmailChange(token: string) {
  const raw = (token || "").trim();
  if (!raw) throw new Error("Verification link is invalid");
  const rows = await sql`
    select id, email, email_change_new_email, email_change_confirm_expires,
           email_change_fb_local_id, email_change_fb_secret
    from auth.users where email_change_confirm_token = ${codeHash(raw)} limit 1
  `;
  const row = rows[0] as {
    id: string; email: string; email_change_new_email: string | null;
    email_change_confirm_expires: string | null;
    email_change_fb_local_id: string | null; email_change_fb_secret: string | null;
  } | undefined;
  if (!row?.email_change_new_email) {
    throw new Error("This verification link was already used — start the change again");
  }
  if (!row.email_change_confirm_expires || new Date(row.email_change_confirm_expires).getTime() < Date.now()) {
    throw new Error("This verification link expired — start the change again");
  }
  const next = String(row.email_change_new_email).toLowerCase();
  const clash = await sql`
    select id from auth.users where lower(email) = ${next} and id <> ${row.id}::uuid limit 1
  `;
  if (clash.length) throw new Error("Another staff account already uses that email");

  await purgeFirebaseAccount(String(row.email));
  try {
    await sql`
      update auth.users
      set email = ${next},
          email_confirmed_at = coalesce(email_confirmed_at, now()),
          firebase_local_id = ${row.email_change_fb_local_id},
          firebase_purge_secret = ${row.email_change_fb_secret},
          email_change_code_hash = null,
          email_change_code_expires = null,
          email_change_ticket_hash = null,
          email_change_ticket_expires = null,
          email_change_new_email = null,
          email_change_confirm_token = null,
          email_change_confirm_expires = null,
          email_change_fb_local_id = null,
          email_change_fb_secret = null,
          updated_at = now()
      where id = ${row.id}::uuid
    `;
  } catch (e) {
    const msg = String((e as Error)?.message || e);
    if (/unique|duplicate/i.test(msg)) throw new Error("Another staff account already uses that email");
    throw e;
  }
  return { email: next };
}
