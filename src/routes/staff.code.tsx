import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { StaffOceanScene } from "@/components/staff-ocean-scene";
import { HopeMusic } from "@/components/hope-music";
import { MoonPhaseLive } from "@/lib/moon-phase";

const PENDING_KEY = "kh-login-pending";
const CODE_TTL_MS = 10 * 60 * 1000;

type Pending = { email: string; sentAt: number };

export const Route = createFileRoute("/staff/code")({
  head: () => ({
    meta: [
      { title: "Enter login code — Kijabe Queue" },
      { name: "description", content: "Enter the 6-digit staff verification code emailed to you." },
    ],
  }),
  validateSearch: (search: Record<string, unknown>) => ({
    email: typeof search.email === "string" ? search.email.trim().toLowerCase() : "",
  }),
  component: StaffCodePage,
});

function welcomeName(email: string) {
  const local = email.split("@")[0] || "staff";
  return local.replace(/[._-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function readPending(email: string): Pending | null {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Pending;
    if (!p?.email || p.email.toLowerCase() !== email.toLowerCase()) return null;
    return p;
  } catch {
    return null;
  }
}

function StaffCodePage() {
  const { email: emailQ } = Route.useSearch();
  const navigate = useNavigate();
  const [email] = useState(() => {
    if (emailQ) return emailQ;
    try {
      const raw = sessionStorage.getItem(PENDING_KEY);
      if (!raw) return "";
      return (JSON.parse(raw) as Pending).email || "";
    } catch {
      return "";
    }
  });
  // Always start empty — never auto-fill/auto-login from the emailed code
  const [digits, setDigits] = useState<string[]>(["", "", "", "", "", ""]);
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState(false);
  const [shake, setShake] = useState(false);
  const typedRef = useRef(false);
  const [now, setNow] = useState(() => Date.now());
  const [sound, setSound] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("kh-staff-login-sound") === "1";
  });
  const inputs = useRef<(HTMLInputElement | null)[]>([]);
  const pending = email ? readPending(email) : null;
  const sentAt = pending?.sentAt ?? Date.now();
  const leftMs = Math.max(0, CODE_TTL_MS - (now - sentAt));
  const leftMin = Math.floor(leftMs / 60000);
  const leftSec = Math.floor((leftMs % 60000) / 1000);
  const code = digits.join("");
  const filled = code.length === 6;

  useEffect(() => {
    if (!emailQ && !pending?.email) {
      navigate({ to: "/staff" });
      return;
    }
    if (!emailQ && pending?.email) {
      navigate({ to: "/staff/code", search: { email: pending.email }, replace: true });
    }
  }, [emailQ, pending?.email, navigate]);

  useEffect(() => {
    const i = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(i);
  }, []);

  useEffect(() => {
    inputs.current[0]?.focus();
  }, []);

  const enableSound = () => {
    setSound(true);
    localStorage.setItem("kh-staff-login-sound", "1");
    window.dispatchEvent(new Event("kh-hope-unlock"));
  };
  const disableSound = () => {
    setSound(false);
    localStorage.setItem("kh-staff-login-sound", "0");
  };

  const confirm = useCallback(async (value: string) => {
    if (busy || ok || value.length < 6) return;
    if (!email) {
      toast.error("Missing email — sign in again");
      navigate({ to: "/staff" });
      return;
    }
    setBusy(true);
    try {
      const res = await supabase.auth.verifyLoginCode({ email, code: value });
      if (res.error) {
        setShake(true);
        window.setTimeout(() => setShake(false), 520);
        toast.error(res.error.message);
        setDigits(["", "", "", "", "", ""]);
        inputs.current[0]?.focus();
        return;
      }
      try { sessionStorage.removeItem(PENDING_KEY); } catch { /* */ }
      setOk(true);
      toast.success(`Welcome back, ${welcomeName(email)}!`);
      try {
        const pendingBio = localStorage.getItem("kh-biometric-enroll-pending");
        const token = res.data.session?.access_token;
        if (pendingBio && pendingBio === email.trim().toLowerCase() && token) {
          const { probeBiometrics, enrollBiometrics } = await import("@/lib/biometrics");
          const probe = await probeBiometrics();
          if (probe.support === "ready") {
            localStorage.removeItem("kh-biometric-enroll-pending");
            await enrollBiometrics(token, "Staff console");
            toast.success("Fingerprint / face unlock saved for this device");
          }
        }
      } catch {
        /* enrollment optional — password/OTP already succeeded */
      }
      window.setTimeout(() => navigate({ to: "/staff" }), 900);
    } finally {
      setBusy(false);
    }
  }, [busy, ok, email, navigate]);

  useEffect(() => {
    // Only auto-submit after the staff member typed/pasted the code themselves
    if (filled && typedRef.current && !busy && !ok) void confirm(code);
  }, [filled, code, busy, ok, confirm]);

  const setAt = (index: number, raw: string) => {
    const ch = raw.replace(/\D/g, "").slice(-1);
    typedRef.current = true;
    setDigits((prev) => {
      const next = [...prev];
      next[index] = ch;
      return next;
    });
    if (ch && index < 5) inputs.current[index + 1]?.focus();
  };

  const onKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !digits[index] && index > 0) {
      inputs.current[index - 1]?.focus();
      setDigits((prev) => {
        const next = [...prev];
        next[index - 1] = "";
        return next;
      });
    }
    if (e.key === "ArrowLeft" && index > 0) inputs.current[index - 1]?.focus();
    if (e.key === "ArrowRight" && index < 5) inputs.current[index + 1]?.focus();
  };

  const onPaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (!pasted) return;
    typedRef.current = true;
    const next = Array.from({ length: 6 }, (_, i) => pasted[i] || "");
    setDigits(next);
    const focusAt = Math.min(pasted.length, 5);
    inputs.current[focusAt]?.focus();
  };

  const tidePct = Math.max(4, Math.min(100, (leftMs / CODE_TTL_MS) * 100));

  if (!email) {
    return <main className="min-h-screen bg-background" />;
  }

  return (
    <StaffOceanScene showSeaSounds={false} ambientActive={sound} calmAmbient>
      <form
        className={`staff-ocean-card staff-code-card${shake ? " staff-code-shake" : ""}${ok ? " staff-code-ok" : ""}`}
        onSubmit={(e) => {
          e.preventDefault();
          void confirm(code);
        }}
      >
        <div className="mb-3 flex justify-center">
          <MoonPhaseLive className="border-white/30 bg-white/15 text-[#0b2c40] shadow-none backdrop-blur" />
        </div>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] opacity-80">AIC Kijabe Hospital</p>
        <h1 className="mt-2 text-3xl font-bold">
          {ok ? "Tide opens — welcome" : "Code on the tide"}
        </h1>
        <p className="mt-2 text-sm opacity-85">
          {ok
            ? "Signing you into your desk…"
            : <>A 6-digit code was cast to <b className="break-all">{email}</b>. Enter it below.</>}
        </p>

        <div className="mt-3 flex justify-center">
          {!sound ? (
            <Button type="button" size="sm" variant="secondary" onClick={enableSound}>
              Enable hope music
            </Button>
          ) : (
            <button type="button" className="staff-ocean-link text-xs underline opacity-80" onClick={disableSound}>
              Hope music on · tap to mute
            </button>
          )}
        </div>

        {!ok && (
          <>
            <div className="staff-code-tide mt-5" aria-hidden>
              <div className="staff-code-tide-fill" style={{ width: `${tidePct}%` }} />
            </div>
            <p className="mt-1.5 text-center text-[11px] opacity-70 tabular-nums">
              Code expires in {leftMin}:{String(leftSec).padStart(2, "0")}
            </p>

            <div className="staff-code-slots mt-6" onPaste={onPaste}>
              {digits.map((d, i) => (
                <input
                  key={i}
                  ref={(el) => { inputs.current[i] = el; }}
                  className={`staff-code-slot${d ? " is-filled" : ""}`}
                  inputMode="numeric"
                  autoComplete={i === 0 ? "one-time-code" : "off"}
                  maxLength={1}
                  value={d}
                  aria-label={`Digit ${i + 1}`}
                  disabled={busy || ok}
                  onChange={(e) => setAt(i, e.target.value)}
                  onKeyDown={(e) => onKeyDown(i, e)}
                  onFocus={(e) => e.target.select()}
                />
              ))}
            </div>

            <p className="mt-4 rounded-lg bg-amber-500/20 px-3 py-2 text-xs leading-relaxed">
              <b>Email missing?</b> Open <b>Spam</b>, <b>Junk</b>, and <b>Promotions</b> — Firebase verification mail often lands there.
              Greeting looks like “Kijabe login code …”. Still quiet after ~60s? Go back and sign in again for a fresh code.
            </p>

            <Button className="mt-5 w-full" disabled={busy || !filled}>
              {busy ? "Confirming…" : "Confirm & sign in"}
            </Button>

            <Link to="/staff" className="staff-ocean-link mt-4 block w-full text-center text-sm underline">
              ← Back to password · new code
            </Link>
          </>
        )}

        {ok && (
          <div className="staff-code-success mt-8 text-center" aria-live="polite">
            <div className="staff-code-ripple" />
            <p className="font-display text-lg font-bold">Desk unlocked</p>
          </div>
        )}
      </form>
      <HopeMusic active={sound} oceanOn={sound} />
    </StaffOceanScene>
  );
}
