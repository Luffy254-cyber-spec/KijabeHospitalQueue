/**
 * Platform biometrics (fingerprint / face) via WebAuthn.
 * Stays inactive until the device reports a user-verifying platform authenticator.
 */

import {
  startAuthentication,
  startRegistration,
  browserSupportsWebAuthn,
} from "@simplewebauthn/browser";
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/browser";

export type BiometricSupport = "checking" | "inactive" | "ready";

export type BiometricProbe = {
  support: BiometricSupport;
  /** Browser has WebAuthn API */
  webauthn: boolean;
  /** Fingerprint / Face ID / Windows Hello available on this machine */
  platformAuthenticator: boolean;
  reason: string;
};

async function authFetch(body: Record<string, unknown>, token?: string | null) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch("/api/local/auth", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { res, json };
}

/** Probe once whether this device can use fingerprint / face unlock. */
export async function probeBiometrics(): Promise<BiometricProbe> {
  if (typeof window === "undefined") {
    return {
      support: "inactive",
      webauthn: false,
      platformAuthenticator: false,
      reason: "Biometrics unavailable on server render",
    };
  }

  const webauthn = browserSupportsWebAuthn();
  if (!webauthn) {
    return {
      support: "inactive",
      webauthn: false,
      platformAuthenticator: false,
      reason: "This browser does not support biometric sign-in",
    };
  }

  let platformAuthenticator = false;
  try {
    platformAuthenticator = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    platformAuthenticator = false;
  }

  if (!platformAuthenticator) {
    return {
      support: "inactive",
      webauthn: true,
      platformAuthenticator: false,
      reason: "Inactive until this device has fingerprint or face unlock",
    };
  }

  return {
    support: "ready",
    webauthn: true,
    platformAuthenticator: true,
    reason: "Fingerprint or face unlock is ready on this device",
  };
}

export async function checkBiometricEnrolled(email: string): Promise<boolean> {
  if (!email.trim()) return false;
  const { res, json } = await authFetch({ action: "webauthn-status", email: email.trim() });
  if (!res.ok) return false;
  return !!json.enrolled;
}

/** Enroll fingerprint / face for the currently signed-in staff user. */
export async function enrollBiometrics(accessToken: string, friendlyName?: string) {
  const { res, json } = await authFetch({ action: "webauthn-register-options" }, accessToken);
  if (!res.ok) throw new Error(String(json.error || "Could not start biometric enrollment"));
  const options = json.options as PublicKeyCredentialCreationOptionsJSON;
  let credential: RegistrationResponseJSON;
  try {
    credential = await startRegistration({ optionsJSON: options });
  } catch (e) {
    const name = e instanceof Error ? e.name : "";
    if (name === "NotAllowedError") throw new Error("Biometric prompt was cancelled");
    throw new Error(e instanceof Error ? e.message : "Biometric enrollment cancelled");
  }
  const verify = await authFetch(
    { action: "webauthn-register-verify", credential, friendlyName },
    accessToken,
  );
  if (!verify.res.ok) throw new Error(String(verify.json.error || "Could not save biometric"));
  return verify.json;
}

/** Sign in with fingerprint / face using the superadmin-assigned staff work ID. */
export async function signInWithBiometricsWorkId(workId: string) {
  const id = workId.trim();
  if (!id) throw new Error("Enter your work ID first");
  const { res, json } = await authFetch({ action: "webauthn-login-options-workid", workId: id });
  if (!res.ok) throw new Error(String(json.error || "Biometric sign-in unavailable"));
  const options = json.options as PublicKeyCredentialRequestOptionsJSON;
  let credential: AuthenticationResponseJSON;
  try {
    credential = await startAuthentication({ optionsJSON: options });
  } catch (e) {
    const name = e instanceof Error ? e.name : "";
    if (name === "NotAllowedError") throw new Error("Biometric prompt was cancelled");
    throw new Error(e instanceof Error ? e.message : "Biometric sign-in cancelled");
  }
  const verify = await authFetch({
    action: "webauthn-login-verify-workid",
    workId: id,
    credential,
  });
  if (!verify.res.ok) throw new Error(String(verify.json.error || "Biometric sign-in failed"));
  return verify.json.session as { access_token: string; user: { id: string; email: string } };
}

/** Sign in with fingerprint / face for an enrolled account. */
export async function signInWithBiometrics(email: string) {
  const address = email.trim().toLowerCase();
  if (!address) throw new Error("Enter your email first");
  const { res, json } = await authFetch({ action: "webauthn-login-options", email: address });
  if (!res.ok) throw new Error(String(json.error || "Biometric sign-in unavailable"));
  const options = json.options as PublicKeyCredentialRequestOptionsJSON;
  let credential: AuthenticationResponseJSON;
  try {
    credential = await startAuthentication({ optionsJSON: options });
  } catch (e) {
    const name = e instanceof Error ? e.name : "";
    if (name === "NotAllowedError") throw new Error("Biometric prompt was cancelled");
    throw new Error(e instanceof Error ? e.message : "Biometric sign-in cancelled");
  }
  const verify = await authFetch({
    action: "webauthn-login-verify",
    email: String(json.email || address),
    credential,
  });
  if (!verify.res.ok) throw new Error(String(verify.json.error || "Biometric sign-in failed"));
  return verify.json.session as { access_token: string; user: { id: string; email: string } };
}
