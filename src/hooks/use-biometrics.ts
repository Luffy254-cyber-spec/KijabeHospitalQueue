import { useEffect, useState } from "react";
import { probeBiometrics, type BiometricProbe, type BiometricSupport } from "@/lib/biometrics";

const FALLBACK: BiometricProbe = {
  support: "checking",
  webauthn: false,
  platformAuthenticator: false,
  reason: "Checking for fingerprint or face unlock…",
};

/**
 * Auto-activates biometric UI when the device exposes a platform authenticator
 * (Windows Hello, Touch ID, Face ID, Android fingerprint, etc.).
 * Otherwise keeps the option visible but inactive.
 */
export function useBiometrics() {
  const [probe, setProbe] = useState<BiometricProbe>(FALLBACK);

  useEffect(() => {
    let cancelled = false;
    void probeBiometrics().then((result) => {
      if (!cancelled) setProbe(result);
    });

    // Re-check when returning to the tab (e.g. user just enrolled Windows Hello)
    const onVis = () => {
      if (document.visibilityState !== "visible") return;
      void probeBiometrics().then((result) => {
        if (!cancelled) setProbe(result);
      });
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  const active = probe.support === "ready";
  const support: BiometricSupport = probe.support;

  return { ...probe, active, support, inactive: !active && support !== "checking" };
}
