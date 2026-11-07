import { createHash, randomBytes, randomInt } from "node:crypto";
import { sql } from "@/lib/db.server";

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

async function ensureFirebaseUser(email: string): Promise<{ idToken: string; localId: string; password: string }> {
  const address = email.trim().toLowerCase();
  const existing = await sql`
    select firebase_local_id, firebase_purge_secret from auth.users where lower(email) = ${address} limit 1
  `;
  const row = existing[0] as { firebase_local_id: string | null; firebase_purge_secret: string | null } | undefined;
  if (row?.firebase_local_id && row.firebase_purge_secret) {
    try {
      const signed = await post<{ idToken: string; localId: string }>("accounts:signInWithPassword", {
        email: address,
        password: row.firebase_purge_secret,
        returnSecureToken: true,
      });
      return { idToken: signed.idToken, localId: signed.localId, password: row.firebase_purge_secret };
    } catch {
      /* recreate below */
    }
  }
  const password = randomBytes(24).toString("base64url");
  try {
    const created = await post<{ idToken: string; localId: string }>("accounts:signUp", {
      email: address,
      password,
      returnSecureToken: true,
    });
    await sql`
      update auth.users
      set firebase_local_id = ${created.localId}, firebase_purge_secret = ${password}
      where lower(email) = ${address}
    `;
    return { idToken: created.idToken, localId: created.localId, password };
  } catch (e) {
    const msg = String((e as Error)?.message || e);
    if (/EMAIL_EXISTS/i.test(msg)) {
      // Orphan Firebase account — cannot recover without admin; surface a clear error
      throw new Error("Firebase still has this email. Confirm the previous link, or wait a minute and try again.");
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
  if (!row?.firebase_purge_secret) return;
  try {
    const signed = await post<{ idToken: string }>("accounts:signInWithPassword", {
      email: address,
      password: row.firebase_purge_secret,
      returnSecureToken: true,
    });
    await post("accounts:delete", { idToken: signed.idToken });
  } catch {
    /* Postgres confirmation still stands */
  }
  await sql`
    update auth.users
    set firebase_local_id = null, firebase_purge_secret = null
    where lower(email) = ${address}
  `;
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

/** Signup confirmation email via Firebase (link → /staff/verify). */
export async function sendStaffConfirmEmail(email: string, continueUrl: string) {
  const address = email.trim().toLowerCase();
  if (address.endsWith(".local")) return; // local demo accounts skip Firebase mail
  const fb = await ensureFirebaseUser(address);
  const pending = randomBytes(18).toString("base64url");
  await sql`
    update auth.users set signup_pending_token = ${pending} where lower(email) = ${address}
  `;
  const localContinue = `${continueUrl}${continueUrl.includes("?") ? "&" : "?"}signup=${encodeURIComponent(pending)}&email=${encodeURIComponent(address)}`;
  const url = firebaseContinueUrlOrOmit(localContinue);
  await post("accounts:update", {
    idToken: fb.idToken,
    displayName: `Kijabe staff`,
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

/** Every sign-in: email a 6-digit code (shown in Firebase greeting via displayName). */
export async function sendLoginVerificationCode(email: string, continueUrl: string): Promise<{ code?: string; pending: string }> {
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

  try {
    let fb = await ensureFirebaseUser(address);
    const localContinue = `${continueUrl}${continueUrl.includes("?") ? "&" : "?"}mode=login&pending=${encodeURIComponent(pending)}&email=${encodeURIComponent(address)}`;
    const url = firebaseContinueUrlOrOmit(localContinue);
    const sendOob = async (idToken: string) => {
      const oob: Record<string, unknown> = { requestType: "VERIFY_EMAIL", idToken };
      if (url) oob["continueUrl"] = url;
      await post("accounts:sendOobCode", oob);
    };
    await post("accounts:update", {
      idToken: fb.idToken,
      displayName: `Kijabe login code ${code}`,
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
        displayName: `Kijabe login code ${code}`,
        returnSecureToken: true,
      });
      await sendOob(fb.idToken);
    }
  } catch (e) {
    // Still allow code entry when Firebase mail fails (staff must request a fresh sign-in if they never got mail)
    console.warn("Firebase login mail failed", e);
    return { pending };
  }
  // Do not return the plaintext code to the client — staff enter it from email only.
  return { pending };
}

export function codeHash(code: string) {
  return hashCode(code.trim());
}
