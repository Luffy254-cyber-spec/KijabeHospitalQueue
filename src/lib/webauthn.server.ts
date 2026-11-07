import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticatorTransportFuture,
  type RegistrationResponseJSON,
  type AuthenticationResponseJSON,
} from "@simplewebauthn/server";
import { sql } from "@/lib/db.server";
import { findUserByWorkId, signToken, type SessionUser } from "@/lib/local-auth.server";

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

function rpFromOrigin(origin: string) {
  let hostname = "localhost";
  try {
    hostname = new URL(origin).hostname;
  } catch {
    /* keep localhost */
  }
  return {
    rpID: hostname,
    rpName: "AIC Kijabe Hospital Queue",
    origin: origin.replace(/\/$/, ""),
  };
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
  return "approved";
}

function isElevated(roles: string[]) {
  return roles.includes("superadmin") || roles.includes("admin");
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

async function sessionFor(row: { id: string; email: string }) {
  const roles = await userRoles(String(row.id));
  const user: SessionUser = { id: String(row.id), email: String(row.email), roles };
  return { user, access_token: signToken(user) };
}

async function saveChallenge(email: string, purpose: "register" | "login", challenge: string, userId?: string | null) {
  const address = email.trim().toLowerCase();
  await sql`delete from public.webauthn_challenges where lower(email) = ${address} and purpose = ${purpose}`;
  await sql`
    insert into public.webauthn_challenges(email, user_id, purpose, challenge, expires_at)
    values (
      ${address},
      ${userId ?? null}::uuid,
      ${purpose},
      ${challenge},
      ${new Date(Date.now() + CHALLENGE_TTL_MS).toISOString()}::timestamptz
    )
  `;
}

async function takeChallenge(email: string, purpose: "register" | "login") {
  const address = email.trim().toLowerCase();
  const rows = await sql`
    select id, challenge, user_id, expires_at
    from public.webauthn_challenges
    where lower(email) = ${address} and purpose = ${purpose}
    order by created_at desc
    limit 1
  `;
  const row = rows[0] as
    | { id: string; challenge: string; user_id: string | null; expires_at: string }
    | undefined;
  if (!row) throw new Error("Biometric challenge expired — try again");
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await sql`delete from public.webauthn_challenges where id = ${row.id}::uuid`;
    throw new Error("Biometric challenge expired — try again");
  }
  await sql`delete from public.webauthn_challenges where id = ${row.id}::uuid`;
  return row;
}

async function findUserByEmail(email: string) {
  const address = email.trim().toLowerCase();
  const rows = await sql`
    select id, email, email_confirmed_at from auth.users where lower(email) = ${address} limit 1
  `;
  return rows[0] as { id: string; email: string; email_confirmed_at: string | null } | undefined;
}

async function credentialsForUser(userId: string) {
  const rows = await sql`
    select credential_id, transports
    from public.staff_webauthn_credentials
    where user_id = ${userId}::uuid
  `;
  return rows.map((r) => ({
    id: String(r.credential_id),
    transports: (r.transports as AuthenticatorTransportFuture[] | null) ?? undefined,
  }));
}

/** Begin biometric enrollment (requires authenticated staff session). */
export async function webauthnRegisterOptions(user: SessionUser, origin: string) {
  const { rpID, rpName } = rpFromOrigin(origin);
  const exclude = await credentialsForUser(user.id);
  const options = await generateRegistrationOptions({
    rpName,
    rpID,
    userName: user.email,
    userDisplayName: user.email.split("@")[0] || "Staff",
    userID: new TextEncoder().encode(user.id),
    attestationType: "none",
    excludeCredentials: exclude,
    authenticatorSelection: {
      authenticatorAttachment: "platform",
      userVerification: "required",
      residentKey: "preferred",
      requireResidentKey: false,
    },
  });
  await saveChallenge(user.email, "register", options.challenge, user.id);
  return options;
}

export async function webauthnRegisterVerify(
  user: SessionUser,
  origin: string,
  response: RegistrationResponseJSON,
  friendlyName?: string,
) {
  const { rpID, origin: expectedOrigin } = rpFromOrigin(origin);
  const challenge = await takeChallenge(user.email, "register");
  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge: challenge.challenge,
    expectedOrigin,
    expectedRPID: rpID,
    requireUserVerification: true,
  });
  if (!verification.verified || !verification.registrationInfo) {
    throw new Error("Biometric registration failed");
  }
  const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
  const credentialId = credential.id;
  const publicKey = Buffer.from(credential.publicKey).toString("base64url");
  const transports = (response.response.transports ?? []) as string[];

  await sql`
    insert into public.staff_webauthn_credentials(
      user_id, credential_id, public_key, counter, transports, device_type, backed_up, friendly_name
    ) values (
      ${user.id}::uuid,
      ${credentialId},
      ${publicKey},
      ${credential.counter},
      ${sql.array(transports.length ? transports : ["internal"])},
      ${credentialDeviceType ?? null},
      ${!!credentialBackedUp},
      ${friendlyName?.trim() || "Device biometric"}
    )
    on conflict (credential_id) do update set
      public_key = excluded.public_key,
      counter = excluded.counter,
      transports = excluded.transports,
      last_used_at = now()
  `;

  return { ok: true as const, credentialId };
}

/** Begin passwordless biometric sign-in for an existing enrolled account. */
export async function webauthnLoginOptions(email: string, origin: string) {
  const row = await findUserByEmail(email);
  if (!row) throw new Error("No account found for that email");
  await assertCanLogin(row);
  const allow = await credentialsForUser(String(row.id));
  if (!allow.length) {
    throw new Error("No fingerprint / face login enrolled for this account yet");
  }
  const { rpID } = rpFromOrigin(origin);
  const options = await generateAuthenticationOptions({
    rpID,
    allowCredentials: allow,
    userVerification: "required",
  });
  await saveChallenge(row.email, "login", options.challenge, String(row.id));
  return { options, email: row.email };
}

export async function webauthnLoginVerify(
  email: string,
  origin: string,
  response: AuthenticationResponseJSON,
) {
  const row = await findUserByEmail(email);
  if (!row) throw new Error("No account found for that email");
  await assertCanLogin(row);
  return verifyLoginForRow(row, origin, response);
}

/** Begin biometric sign-in using the staff work ID (superadmin-assigned) instead of email. */
export async function webauthnLoginOptionsByWorkId(workId: string, origin: string) {
  const row = await findUserByWorkId(workId);
  if (!row) throw new Error("Work ID not recognised — ask the superadmin");
  await assertCanLogin(row);
  const allow = await credentialsForUser(String(row.id));
  if (!allow.length) {
    throw new Error("No fingerprint / face login enrolled for this work ID yet — sign in with email once and enroll");
  }
  const { rpID } = rpFromOrigin(origin);
  const options = await generateAuthenticationOptions({
    rpID,
    allowCredentials: allow,
    userVerification: "required",
  });
  await saveChallenge(row.email, "login", options.challenge, String(row.id));
  return { options, email: row.email };
}

export async function webauthnLoginVerifyByWorkId(
  workId: string,
  origin: string,
  response: AuthenticationResponseJSON,
) {
  const row = await findUserByWorkId(workId);
  if (!row) throw new Error("Work ID not recognised — ask the superadmin");
  await assertCanLogin(row);
  return verifyLoginForRow(row, origin, response);
}

async function verifyLoginForRow(
  row: { id: string; email: string; email_confirmed_at: string | null },
  origin: string,
  response: AuthenticationResponseJSON,
) {
  const challenge = await takeChallenge(row.email, "login");
  const { rpID, origin: expectedOrigin } = rpFromOrigin(origin);

  const credRows = await sql`
    select id, credential_id, public_key, counter, transports
    from public.staff_webauthn_credentials
    where user_id = ${row.id}::uuid and credential_id = ${response.id}
    limit 1
  `;
  const cred = credRows[0] as
    | {
        id: string;
        credential_id: string;
        public_key: string;
        counter: string | number;
        transports: string[] | null;
      }
    | undefined;
  if (!cred) throw new Error("Unknown biometric credential");

  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge: challenge.challenge,
    expectedOrigin,
    expectedRPID: rpID,
    requireUserVerification: true,
    credential: {
      id: cred.credential_id,
      publicKey: Buffer.from(cred.public_key, "base64url"),
      counter: Number(cred.counter) || 0,
      transports: (cred.transports as AuthenticatorTransportFuture[] | null) ?? undefined,
    },
  });

  if (!verification.verified) throw new Error("Biometric sign-in failed");

  const newCounter = verification.authenticationInfo.newCounter;
  await sql`
    update public.staff_webauthn_credentials
    set counter = ${newCounter}, last_used_at = now()
    where id = ${cred.id}::uuid
  `;

  return sessionFor(row);
}

export async function webauthnHasCredentials(email: string) {
  const row = await findUserByEmail(email);
  if (!row) return false;
  const rows = await sql`
    select 1 from public.staff_webauthn_credentials where user_id = ${row.id}::uuid limit 1
  `;
  return rows.length > 0;
}
