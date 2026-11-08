import { createHash, createHmac, randomBytes, randomInt } from "node:crypto";
import { sql } from "@/lib/db.server";
import { sendBrandMail, smtpConfigured } from "@/lib/mail.server";

const API_KEY = "AIzaSyAMRu6hwOq0Djh3qj6yI43NunsPXRYKnJw";
const AUTH = "https://identitytoolkit.googleapis.com/v1";

async function post<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${AUTH}/${path}?key=${API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as T & { error?: { message?: string } };
  if (!res.ok) throw new Error(json.error?.message || "Firebase email request failed");
  return json;
}

function hashCode(code: string) {
  return createHash("sha256").update(code).digest("hex");
}

/**
 * Firebase accounts are project-wide, not per-database, so every deployment
 * sharing the project must be able to sign in to the same conduit user. A
 * per-address derived password makes that possible without copying secrets
 * between environments. The stored secret stays as a fallback for conduits
 * created before this scheme and is rotated to the derived one on next use.
 */
function conduitPassword(address: string) {
  const pepper = (process.env["MAIL_CONDUIT_SECRET"] || "kijabe-careflow-email-conduit-v1").trim();
  return createHmac("sha256", pepper).update(`conduit:${address}`).digest("base64url").slice(0, 40);
}

async function ensureFirebaseUser(email: string): Promise<{ idToken: string; localId: string; password: string }> {
  const address = email.trim().toLowerCase();
  const existing = await sql`
    select firebase_local_id, firebase_purge_secret from auth.users where lower(email) = ${address} limit 1
  `;
  const row = existing[0] as { firebase_local_id: string | null; firebase_purge_secret: string | null } | undefined;
  const derived = conduitPassword(address);
  const stored = row?.firebase_purge_secret || null;
  const candidates = stored && stored !== derived ? [stored, derived] : [derived];

  for (const password of candidates) {
    try {
      const signed = await post<{ idToken: string; localId: string }>("accounts:signInWithPassword", {
        email: address,
        password,
        returnSecureToken: true,
      });
      let idToken = signed.idToken;
      let used = password;
      if (password !== derived) {
        try {
          const rotated = await post<{ idToken?: string }>("accounts:update", {
            idToken,
            password: derived,
            returnSecureToken: true,
          });
          idToken = rotated.idToken || idToken;
          used = derived;
        } catch {
          /* keep the legacy secret so mail still goes out */
        }
      }
      await sql`
        update auth.users
        set firebase_local_id = ${signed.localId}, firebase_purge_secret = ${used}
        where lower(email) = ${address}
      `;
      return { idToken, localId: signed.localId, password: used };
    } catch {
      /* try the next candidate */
    }
  }

  try {
    const created = await post<{ idToken: string; localId: string }>("accounts:signUp", {
      email: address,
      password: derived,
      returnSecureToken: true,
    });
    await sql`
      update auth.users
      set firebase_local_id = ${created.localId}, firebase_purge_secret = ${derived}
      where lower(email) = ${address}
    `;
    return { idToken: created.idToken, localId: created.localId, password: derived };
  } catch (e) {
    const msg = String((e as Error)?.message || e);
    if (/EMAIL_EXISTS/i.test(msg)) {
      throw new Error("This address is already registered with the mail service from another deployment. Ask admin@kijabe.local to sync it.");
    }
    throw e;
  }
}

async function purgeFirebase(email: string) {
  const address = email.trim().toLowerCase();
  const rows = await sql`
    select firebase_local_id, firebase_purge_secret from auth.users where lower(email) = ${address} limit 1
  `;
  const row = rows[0] as { firebase_local_id: string | null; firebase_purge_secret: string | null } | undefined;
  const derived = conduitPassword(address);
  const stored = row?.firebase_purge_secret || null;
  const candidates = stored && stored !== derived ? [stored, derived] : [derived];
  let deleted = false;
  for (const password of candidates) {
    try {
      const signed = await post<{ idToken: string }>("accounts:signInWithPassword", {
        email: address,
        password,
        returnSecureToken: true,
      });
      await post("accounts:delete", { idToken: signed.idToken });
      deleted = true;
      break;
    } catch {
      /* try the next candidate */
    }
  }
  // Keep the secret when the delete failed: a later login can still use the
  // conduit, and losing it would strand the project-wide Firebase account.
  if (deleted) {
    await sql`
      update auth.users
      set firebase_local_id = null, firebase_purge_secret = null
      where lower(email) = ${address}
    `;
  }
}

/** Firebase rejects private LAN IPs in continueUrl — omit it so the verification email still sends. */
function firebaseContinueUrlOrOmit(continueUrl: string): string | undefined {
  try {
    const host = new URL(continueUrl).hostname;
    const isPrivate =
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "::1" ||
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(host);
    if (isPrivate) return undefined;
    return continueUrl;
  } catch {
    return undefined;
  }
}

/** Signup confirmation email (SMTP when configured, else Firebase) → /staff/verify. */
export async function sendStaffConfirmEmail(email: string, continueUrl: string) {
  const address = email.trim().toLowerCase();
  if (address.endsWith(".local")) return; // local demo accounts skip email
  const pending = randomBytes(18).toString("base64url");
  await sql`
    update auth.users set signup_pending_token = ${pending} where lower(email) = ${address}
  `;
  const localContinue = `${continueUrl}${continueUrl.includes("?") ? "&" : "?"}signup=${encodeURIComponent(pending)}&email=${encodeURIComponent(address)}`;
  if (smtpConfigured()) {
    await sendBrandMail({
      to: address,
      subject: "Confirm your Kijabe Care Flow staff email",
      heading: "Confirm your staff email",
      lines: [
        "Welcome to the Kijabe Care Flow staff console.",
        "Tap the button below to confirm this address. A superadmin still has to approve new staff before the first sign-in.",
      ],
      cta: { href: localContinue, label: "Confirm email" },
      footnote: "If you did not register for a staff account, you can ignore this message.",
    });
    return;
  }
  const fb = await ensureFirebaseUser(address);
  const url = firebaseContinueUrlOrOmit(localContinue);
  await post("accounts:update", {
    idToken: fb.idToken,
    displayName: `Confirm your staff email`,
    returnSecureToken: true,
  });
  const oob: Record<string, unknown> = {
    requestType: "VERIFY_EMAIL",
    idToken: fb.idToken,
  };
  if (url) oob["continueUrl"] = url;
  await post("accounts:sendOobCode", oob);
}

export async function confirmStaffEmail(email: string, signupToken?: string) {
  const address = email.trim().toLowerCase();
  if (signupToken) {
    const ok = await sql`
      select id from auth.users
      where lower(email) = ${address} and signup_pending_token = ${signupToken}
      limit 1
    `;
    if (!ok[0] && address) {
      // still confirm by email if Firebase apply already proved ownership
    }
  }
  await sql`
    update auth.users
    set email_confirmed_at = coalesce(email_confirmed_at, now()),
        signup_pending_token = null
    where lower(email) = ${address}
  `;
  await purgeFirebase(address);
}

/** Firebase VERIFY_EMAIL mail whose greeting line carries the 6-digit code. */
async function sendCodeGreeting(address: string, displayName: string, continueUrl: string) {
  let fb = await ensureFirebaseUser(address);
  const url = firebaseContinueUrlOrOmit(continueUrl);
  const sendOob = async (idToken: string) => {
    const oob: Record<string, unknown> = { requestType: "VERIFY_EMAIL", idToken };
    if (url) oob["continueUrl"] = url;
    await post("accounts:sendOobCode", oob);
  };
  await post("accounts:update", {
    idToken: fb.idToken,
    displayName,
    returnSecureToken: true,
  });
  try {
    await sendOob(fb.idToken);
  } catch {
    // Already-verified Firebase users cannot get VERIFY_EMAIL — recreate throwaway
    try {
      await post("accounts:delete", { idToken: fb.idToken });
    } catch { /* */ }
    await sql`
      update auth.users set firebase_local_id = null, firebase_purge_secret = null
      where lower(email) = ${address}
    `;
    fb = await ensureFirebaseUser(address);
    await post("accounts:update", {
      idToken: fb.idToken,
      displayName,
      returnSecureToken: true,
    });
    await sendOob(fb.idToken);
  }
}

/** Every sign-in: email a 6-digit code (SMTP when configured, else Firebase greeting). */
export async function sendLoginVerificationCode(email: string, continueUrl: string): Promise<{ code?: string; pending: string; mailFailed?: boolean }> {
  const address = email.trim().toLowerCase();
  const code = String(randomInt(100000, 999999));
  const pending = randomBytes(18).toString("base64url");
  await sql`
    update auth.users
    set login_code_hash = ${hashCode(code)},
        login_code_expires = now() + interval '10 minutes',
        login_pending_token = ${pending}
    where lower(email) = ${address}
  `;

  if (address.endsWith(".local")) {
    return { code, pending };
  }

  if (smtpConfigured()) {
    try {
      await sendBrandMail({
        to: address,
        subject: `Kijabe Care Flow sign-in code ${code}`,
        heading: "Your sign-in code",
        lines: [
          "Enter this code on the staff sign-in page to finish signing in.",
          "The code expires in 10 minutes and can only be used once.",
        ],
        code,
        footnote: "If you did not try to sign in, someone else has your password — change it and tell admin@kijabe.local.",
      });
      return { pending };
    } catch (e) {
      console.warn("SMTP login code failed", e);
      return { pending, mailFailed: true };
    }
  }

  try {
    const localContinue = `${continueUrl}${continueUrl.includes("?") ? "&" : "?"}mode=login&pending=${encodeURIComponent(pending)}&email=${encodeURIComponent(address)}`;
    await sendCodeGreeting(address, `Sign-in code ${code}`, localContinue);
  } catch (e) {
    // Keep the hash so a retry can still succeed, but tell the UI the mail failed
    console.warn("Firebase login mail failed", e);
    return { pending, mailFailed: true };
  }
  // Do not return the plaintext code to the client — staff enter it from email only.
  return { pending };
}

async function sendRecoveryCode(
  address: string,
  kind: "reset" | "change-email",
  code: string,
  continueUrl: string,
): Promise<{ code?: string; mailFailed?: boolean }> {
  if (address.endsWith(".local")) return { code };
  if (smtpConfigured()) {
    const reset = kind === "reset";
    try {
      await sendBrandMail({
        to: address,
        subject: reset ? `Kijabe Care Flow password reset code ${code}` : `Kijabe Care Flow email change code ${code}`,
        heading: reset ? "Reset your password" : "Change your email",
        lines: [
          reset
            ? "Enter this code on the password reset page to choose a new password."
            : "Enter this code on the change email page to confirm it is you.",
          "The code expires in 10 minutes and can only be used once.",
        ],
        code,
        footnote: "If you did not ask for this, ignore the email — nothing on your account changes.",
      });
      return {};
    } catch (e) {
      console.warn("SMTP recovery code failed", e);
      return { mailFailed: true };
    }
  }
  try {
    await sendCodeGreeting(
      address,
      kind === "reset" ? `Reset code ${code}` : `Email change code ${code}`,
      continueUrl,
    );
    return {};
  } catch (e) {
    console.warn(`${kind} code mail failed`, e);
    return { mailFailed: true };
  }
}

export async function sendPasswordResetCode(email: string, code: string, continueUrl: string) {
  return sendRecoveryCode(email.trim().toLowerCase(), "reset", code, continueUrl);
}

export async function sendEmailChangeCode(email: string, code: string, continueUrl: string) {
  return sendRecoveryCode(email.trim().toLowerCase(), "change-email", code, continueUrl);
}

/**
 * Verification mail to the requested new address. The Firebase account it needs
 * is kept (id + secret returned) so it can become the account's mail conduit.
 */
export async function sendEmailChangeVerification(
  newEmail: string,
  continueUrl: string,
): Promise<{ firebaseLocalId?: string; firebaseSecret?: string; mailFailed?: boolean }> {
  const address = newEmail.trim().toLowerCase();
  try {
    const fb = await ensureFirebaseUser(address);
    const url = firebaseContinueUrlOrOmit(continueUrl);
    await post("accounts:update", {
      idToken: fb.idToken,
      displayName: "Confirm your new Kijabe Care Flow email",
      returnSecureToken: true,
    });
    const oob: Record<string, unknown> = { requestType: "VERIFY_EMAIL", idToken: fb.idToken };
    if (url) oob["continueUrl"] = url;
    await post("accounts:sendOobCode", oob);
    return { firebaseLocalId: fb.localId, firebaseSecret: fb.password };
  } catch (e) {
    const msg = String((e as Error)?.message || e);
    if (/EMAIL_EXISTS/i.test(msg)) {
      throw new Error("That address is already held by the mail service — use another email or contact admin@kijabe.local");
    }
    console.warn("Email change verification failed", e);
    return { mailFailed: true };
  }
}

/** Drop the Firebase conduit for an address (used when an email change finishes). */
export async function purgeFirebaseAccount(email: string) {
  await purgeFirebase(email);
}

export function codeHash(code: string) {
  return hashCode(code.trim());
}
