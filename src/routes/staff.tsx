import { createFileRoute, Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { toast } from "sonner";
import { Megaphone, RotateCcw, Play, Check, UserX, ArrowRightLeft, LogOut, Undo2, UserPlus, Eye, EyeOff, Bell, Fingerprint, ScanFace } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useServerFn } from "@tanstack/react-start";
import { Textarea } from "@/components/ui/textarea";
import { suggestWorkflow } from "@/lib/advisor.functions";
import { isLongWait, isSurge, sortQueue, formatWaitDuration, PRIORITY_LABEL, PAYMENT_LABEL, ACTION_LABEL, PRIORITY_CHANGE_REASONS, COVER_DESK_CODES, RELEASE_DESK_CODES, REASON_DESK_CODES } from "@/lib/queue";
import { BillingPanel } from "@/components/billing-panel";
import { StaffOceanScene } from "@/components/staff-ocean-scene";
import { ambientEnabled, setAmbientEnabled, startAmbient, subscribeAmbient } from "@/lib/ambient-music";
import { MoonPhaseLive } from "@/lib/moon-phase";
import { capitalizeName } from "@/lib/names";
import { useIdleLogout } from "@/hooks/use-idle-logout";
import { useBiometrics } from "@/hooks/use-biometrics";
import { Turnstile } from "@/components/turnstile";
import { checkBiometricEnrolled, enrollBiometrics, signInWithBiometrics, signInWithBiometricsWorkId } from "@/lib/biometrics";

const LOGIN_PENDING_KEY = "kh-login-pending";
const BIOMETRIC_ENROLL_PENDING_KEY = "kh-biometric-enroll-pending";

export const Route = createFileRoute("/staff")({
  head: () => ({
    meta: [
      { title: "Staff Console — Kijabe Care Flow" },
      { name: "description", content: "Call, serve and transfer outpatient tickets at AIC Kijabe Hospital." },
      { property: "og:title", content: "Staff Console — Kijabe Care Flow" },
      { property: "og:description", content: "Call, serve and transfer outpatient tickets at AIC Kijabe Hospital." },
    ],
  }),
  component: StaffPage,
});

function StaffPage() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isChild = pathname !== "/staff" && pathname.startsWith("/staff/");
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setReady(true); });
    return () => sub.subscription.unsubscribe();
  }, []);
  if (isChild) return <Outlet />;
  if (!ready) return <main className="min-h-screen bg-background" />;
  return session ? <Console email={session.user.email ?? ""} userId={session.user.id} /> : <Login />;
}

function welcomeName(email: string) {
  const local = email.split("@")[0] || "staff";
  return local.replace(/[._-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function Login() {
  const navigate = useNavigate();
  const biometrics = useBiometrics();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [surname, setSurname] = useState("");
  const [phone, setPhone] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [mode, setMode] = useState<"in" | "up">("in");
  const [loginMode, setLoginMode] = useState<"email" | "workid">("email");
  const [workId, setWorkId] = useState("");
  const [busy, setBusy] = useState(false);
  const [bioBusy, setBioBusy] = useState(false);
  const [enrollBiometric, setEnrollBiometric] = useState(false);
  const [bioEnrolled, setBioEnrolled] = useState(false);
  const [sound, setSound] = useState(() => {
    if (typeof window === "undefined") return false;
    return ambientEnabled();
  });
  const [turnstileToken, setTurnstileToken] = useState("");

  useEffect(() => subscribeAmbient(() => setSound(ambientEnabled())), []);

  useEffect(() => {
    if (!biometrics.active) {
      setEnrollBiometric(false);
      setBioEnrolled(false);
      return;
    }
    const address = email.trim().toLowerCase();
    if (!address || mode !== "in") {
      setBioEnrolled(false);
      return;
    }
    let cancelled = false;
    void checkBiometricEnrolled(address).then((ok) => {
      if (!cancelled) setBioEnrolled(ok);
    });
    return () => {
      cancelled = true;
    };
  }, [email, mode, biometrics.active]);

  const enableSound = () => {
    setSound(true);
    startAmbient();
  };

  const disableSound = () => {
    setSound(false);
    setAmbientEnabled(false);
  };

  const tryEnrollAfterAuth = async (accessToken: string) => {
    if (!biometrics.active) return;
    try {
      await enrollBiometrics(accessToken, "Staff console");
      toast.success("Fingerprint / face unlock saved for this device");
    } catch (err) {
      toast.message("Account ready — biometric not saved yet", {
        description: err instanceof Error ? err.message : "You can enroll later from the console",
        duration: 8000,
      });
    }
  };

  const biometricSignIn = async () => {
    if (!biometrics.active) {
      toast.message("Biometrics inactive", { description: biometrics.reason, duration: 7000 });
      return;
    }
    if (!email.trim()) {
      toast.error("Enter your email, then use fingerprint / face");
      return;
    }
    setBioBusy(true);
    try {
      const session = await signInWithBiometrics(email);
      await supabase.auth.acceptSession(session);
      toast.success(`Welcome back, ${welcomeName(session.user.email)}!`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Biometric sign-in failed");
    } finally {
      setBioBusy(false);
    }
  };

  const workIdSignIn = async () => {
    if (!biometrics.active) {
      toast.message("Biometrics inactive", { description: biometrics.reason, duration: 7000 });
      return;
    }
    if (!workId.trim()) {
      toast.error("Enter your work ID, then use fingerprint / face");
      return;
    }
    setBioBusy(true);
    try {
      const session = await signInWithBiometricsWorkId(workId);
      await supabase.auth.acceptSession(session);
      toast.success(`Welcome back, ${welcomeName(session.user.email)}!`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Biometric sign-in failed");
    } finally {
      setBioBusy(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === "in" && loginMode === "workid") {
      await workIdSignIn();
      return;
    }
    setBusy(true);
    try {
      if (mode === "up") {
        if (firstName.trim().length < 2) {
          toast.error("Enter your first name");
          setBusy(false);
          return;
        }
        const wantBio = enrollBiometric && biometrics.active;
        const res = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${window.location.origin}/staff/verify` },
          firstName: firstName.trim(),
          lastName: lastName.trim() || undefined,
          surname: surname.trim() || undefined,
          phone: phone.length === 9 ? `+254${phone}` : undefined,
          turnstileToken,
        }) as Awaited<ReturnType<typeof supabase.auth.signUp>> & {
          needsConfirmation?: boolean;
          awaitingApproval?: boolean;
          mailFailed?: boolean;
        };
        if (res.error) toast.error(res.error.message);
        else if (res.data.session) {
          toast.success(`Welcome, ${welcomeName(email)}!`);
          if (wantBio) await tryEnrollAfterAuth(res.data.session.access_token);
        } else if (res.mailFailed && res.awaitingApproval) {
          if (wantBio) {
            try {
              localStorage.setItem(BIOMETRIC_ENROLL_PENDING_KEY, email.trim().toLowerCase());
            } catch { /* ignore */ }
          }
          toast.message("Account created — awaiting superadmin approval", {
            description:
              "Verification email could not be sent. Your email was confirmed on this hospital network — ask admin@kijabe.local to approve you, then sign in. If a mail arrives later, also check Spam / Junk / Promotions.",
            duration: 14000,
            className: "staff-notice-toast",
          });
        } else if (res.awaitingApproval) {
          if (wantBio) {
            try {
              localStorage.setItem(BIOMETRIC_ENROLL_PENDING_KEY, email.trim().toLowerCase());
            } catch { /* ignore */ }
          }
          toast.message("Account created — confirm email, then await approval", {
            description:
              "Open the confirmation link in your inbox. Missing? Check Spam, Junk, and Promotions first — verification mail often lands there. After confirming, wait for admin@kijabe.local to approve you before sign-in works.",
            duration: 14000,
            className: "staff-notice-toast",
          });
        } else {
          if (wantBio) {
            try {
              localStorage.setItem(BIOMETRIC_ENROLL_PENDING_KEY, email.trim().toLowerCase());
            } catch { /* ignore */ }
          }
          toast.success("Confirmation launched across the waves", {
            description:
              "Open the link in your inbox. Not there? Check Spam / Junk / Promotions — mail sometimes docks in the wrong bay. A superadmin must still approve new staff.",
            duration: 12000,
          });
        }
        return;
      }
      const res = await supabase.auth.signInWithPassword({ email, password, turnstileToken }) as Awaited<
        ReturnType<typeof supabase.auth.signInWithPassword>
      > & { needsCode?: boolean; code?: string; email?: string; mailFailed?: boolean };
      if (res.error) toast.error(res.error.message);
      else if (res.data.session) {
        toast.success(`Welcome back, ${welcomeName(email)}!`);
        try {
          const pending = localStorage.getItem(BIOMETRIC_ENROLL_PENDING_KEY);
          if (pending && pending === email.trim().toLowerCase() && biometrics.active) {
            localStorage.removeItem(BIOMETRIC_ENROLL_PENDING_KEY);
            await tryEnrollAfterAuth(res.data.session.access_token);
          }
        } catch { /* ignore */ }
      } else if (res.needsCode) {
        const address = (res.email || email).trim().toLowerCase();
        if (res.mailFailed) {
          toast.error("Sign-in code could not be sent", {
            description:
              "The mail service did not accept the message. Try again in a minute; if it keeps failing, ask admin@kijabe.local to check the account-mail settings.",
            duration: 12000,
            classNames: {
              toast: "!border-rose-300 !bg-rose-700 !text-white !shadow-lg",
              title: "!text-white !font-semibold",
              description: "!text-rose-50",
              icon: "!text-white",
            },
          });
          return;
        }
        try {
          sessionStorage.setItem(
            LOGIN_PENDING_KEY,
            JSON.stringify({
              email: address,
              sentAt: Date.now(),
            }),
          );
        } catch {
          /* ignore */
        }
        toast.success("Verification code cast into your inbox", {
          description: "Look for “Kijabe Care Flow — Sign-in code …” in your email. Missing? Check Spam, Junk, and Promotions.",
          duration: 9000,
          classNames: {
            toast: "!border-emerald-300 !bg-emerald-600 !text-white !shadow-lg",
            title: "!text-white !font-semibold",
            description: "!text-emerald-50",
            icon: "!text-white",
          },
        });
        void navigate({ to: "/staff/code", search: { email: address } });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <StaffOceanScene
      showSeaSounds={false}
      ambientActive={sound}
      calmAmbient
    >
      <form onSubmit={submit} className="staff-ocean-card">
        <div className="mb-3 flex justify-center">
          <MoonPhaseLive className="border-white/30 bg-white/15 text-[#0b2c40] shadow-none backdrop-blur" />
        </div>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] opacity-80">AIC Kijabe Hospital</p>
        <h1 className="mt-2 text-3xl font-bold">
          {mode === "up" ? "Staff sign up" : "Staff sign in"}
        </h1>
        <div className="mt-3 flex justify-center">
          {!sound ? (
            <Button type="button" size="sm" variant="secondary" onClick={enableSound}>
              Enable hope music
            </Button>
          ) : (
            <button
              type="button"
              className="staff-ocean-link text-xs underline opacity-80"
              onClick={disableSound}
            >
              Hope music on · tap to mute
            </button>
          )}
        </div>
        {mode === "in" && (
          <div className="mt-6 grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant={loginMode === "email" ? "default" : "outline"}
              size="sm"
              onClick={() => setLoginMode("email")}
            >
              Email + password
            </Button>
            <Button
              type="button"
              variant={loginMode === "workid" ? "default" : "outline"}
              size="sm"
              onClick={() => setLoginMode("workid")}
            >
              Work ID (biometrics)
            </Button>
          </div>
        )}
        {mode === "up" && (
          <div className="mt-6 space-y-2">
            <Input placeholder="First name" value={firstName} onChange={(e) => setFirstName(capitalizeName(e.target.value))} required minLength={2} autoComplete="given-name" />
            <Input placeholder="Last / middle name" value={lastName} onChange={(e) => setLastName(capitalizeName(e.target.value))} autoComplete="additional-name" />
            <Input placeholder="Surname / family name" value={surname} onChange={(e) => setSurname(capitalizeName(e.target.value))} autoComplete="family-name" />
            <div className="flex items-center gap-2">
              <span className="text-sm opacity-70">+254</span>
              <Input
                inputMode="numeric"
                placeholder="Phone (optional)"
                value={phone}
                onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").replace(/^0/, "").slice(0, 9))}
                autoComplete="tel"
              />
            </div>
          </div>
        )}
        {(mode === "up" || loginMode === "email") && (
          <>
            <Input className={mode === "up" ? "mt-2" : "mt-6"} type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="username" />
            <div className="relative mt-3">
              <Input
                type={showPassword ? "text" : "password"}
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                autoComplete={mode === "in" ? "current-password" : "new-password"}
                className="pr-11"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute inset-y-0 right-0 flex items-center px-3 opacity-70 hover:opacity-100"
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <p className="mt-3 rounded-lg bg-black/10 px-3 py-2 text-xs leading-relaxed opacity-90">
              {mode === "in"
                ? "After Send verification code you’ll open a dedicated page to enter the 6-digit code. Missing mail? Check Spam / Junk / Promotions."
                : "New accounts need an email confirmation (check Spam / Junk / Promotions) and superadmin approval before the first sign-in."}
            </p>
          </>
        )}

        {(mode === "up" || loginMode === "email") && (
          <div
            className={`mt-4 rounded-xl border px-3 py-3 ${
              biometrics.active
                ? "border-emerald-400/50 bg-emerald-500/15"
                : "border-white/20 bg-black/10 opacity-70"
            }`}
          >
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex gap-1 text-[#0b2c40]">
              <Fingerprint className="h-5 w-5" aria-hidden />
              <ScanFace className="h-5 w-5" aria-hidden />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">
                {biometrics.support === "checking"
                  ? "Checking biometrics…"
                  : biometrics.active
                    ? "Biometrics active on this device"
                    : "Biometrics inactive"}
              </p>
              <p className="mt-0.5 text-xs leading-relaxed opacity-90">{biometrics.reason}</p>
              {mode === "up" && (
                <label
                  className={`mt-3 flex items-start gap-2 text-sm ${
                    biometrics.active ? "cursor-pointer" : "cursor-not-allowed opacity-60"
                  }`}
                >
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={enrollBiometric && biometrics.active}
                    disabled={!biometrics.active || busy}
                    onChange={(e) => setEnrollBiometric(e.target.checked)}
                  />
                  <span>
                    Also register fingerprint / face for faster sign-in
                    {!biometrics.active ? " (activates automatically when this PC/phone supports it)" : ""}
                  </span>
                </label>
              )}
              {mode === "in" && (
                <Button
                  type="button"
                  variant={biometrics.active ? "secondary" : "outline"}
                  className="mt-3 w-full"
                  disabled={!biometrics.active || bioBusy || busy || !email.trim()}
                  onClick={() => void biometricSignIn()}
                  title={biometrics.active ? undefined : biometrics.reason}
                >
                  <Fingerprint className="h-4 w-4" />
                  {bioBusy
                    ? "Waiting for sensor…"
                    : biometrics.active
                      ? bioEnrolled
                        ? "Sign in with fingerprint / face"
                        : "Sign in with fingerprint / face"
                      : "Fingerprint / face (inactive)"}
                </Button>
              )}
              {mode === "in" && biometrics.active && email.trim() && !bioEnrolled && (
                <p className="mt-2 text-[11px] leading-relaxed opacity-80">
                  No biometric enrolled for this email yet — sign in with password once, or create an account with biometrics checked.
                </p>
              )}
            </div>
          </div>
        </div>
        )}

        {mode === "in" && loginMode === "workid" && (
          <div
            className={`mt-6 rounded-xl border px-3 py-3 ${
              biometrics.active
                ? "border-emerald-400/50 bg-emerald-500/15"
                : "border-white/20 bg-black/10 opacity-70"
            }`}
          >
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex gap-1 text-[#0b2c40]">
                <Fingerprint className="h-5 w-5" aria-hidden />
                <ScanFace className="h-5 w-5" aria-hidden />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">Work ID sign in</p>
                <p className="mt-0.5 text-xs leading-relaxed opacity-90">
                  Key in the work ID your superadmin gave you, then use fingerprint / face.
                </p>
                <Input
                  className="mt-3"
                  placeholder="Work ID e.g. KJ-1042"
                  value={workId}
                  onChange={(e) => setWorkId(e.target.value.toUpperCase().replace(/[^A-Z0-9/-]/g, "").slice(0, 24))}
                  autoComplete="username"
                />
                <Button
                  type="button"
                  variant={biometrics.active ? "secondary" : "outline"}
                  className="mt-3 w-full"
                  disabled={!biometrics.active || bioBusy || busy || workId.trim().length < 4}
                  onClick={() => void workIdSignIn()}
                  title={biometrics.active ? undefined : biometrics.reason}
                >
                  <Fingerprint className="h-4 w-4" />
                  {bioBusy
                    ? "Waiting for sensor…"
                    : biometrics.active
                      ? "Sign in with fingerprint / face"
                      : "Fingerprint / face (inactive)"}
                </Button>
                <p className="mt-2 text-[11px] leading-relaxed opacity-80">
                  Enroll biometrics first: sign in with email once, then register your fingerprint / face from the console.
                </p>
              </div>
            </div>
          </div>
        )}

        {(mode === "up" || loginMode === "email") && (
          <>
            <Turnstile onToken={setTurnstileToken} className="mt-4" />
            <Button className="mt-4 w-full" disabled={busy || bioBusy || (mode === "up" && firstName.trim().length < 2)}>
              {busy ? "Please wait…" : mode === "in" ? "Send verification code" : "Create account"}
            </Button>
          </>
        )}
        <button
          type="button"
          onClick={() => { setMode(mode === "in" ? "up" : "in"); setLoginMode("email"); }}
          className="staff-ocean-link mt-4 w-full text-sm underline"
        >
          {mode === "in" ? "New staff member? Create an account" : "Have an account? Sign in"}
        </button>
        {mode === "in" && (
          <div className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs">
            <Link to="/staff/reset" className="underline">Forgot password?</Link>
            <Link to="/staff/change-email" className="underline">Change email</Link>
          </div>
        )}
        <p className="mt-3 text-center text-xs opacity-80">Superadmin (no verification): admin@kijabe.local / admin1234</p>
        <Link to="/admin" className="mt-1 block text-center text-sm underline">Superadmin command →</Link>
        <Link to="/" className="mt-2 block text-center text-sm underline">← Home</Link>
      </form>
    </StaffOceanScene>
  );
}

type Service = { id: string; code: string; name_en: string; avg_minutes: number; surge_threshold: number; category?: string };
type Counter = { id: string; name: string; service_id: string };
type Ticket = {
  id: string; token: string; status: string; priority: number; payment: string; visit_type: string;
  queued_at: string; counter_id: string | null; service_id: string; recall_count: number;
  triage_level: string; triage_note: string | null; care_path: string[]; path_step: number; appointment_at: string | null;
  payment_detail?: string | null; insurer_id?: string | null; insurer_name?: string | null;
  hospital_no?: string | null; patient_id?: string | null;
};

function Console({ email, userId }: { email: string; userId: string }) {
  const [services, setServices] = useState<Service[]>([]);
  const [counters, setCounters] = useState<Counter[]>([]);
  const [counterId, setCounterId] = useState<string>("");
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [transferTo, setTransferTo] = useState("");
  const [prioMode, setPrioMode] = useState<"escalate" | "escalate_priority" | "return_common" | null>(null);
  const [prioPicks, setPrioPicks] = useState<string[]>([]);
  const [prioOther, setPrioOther] = useState("");
  const [needsDbFix, setNeedsDbFix] = useState(false);
  const [isSuperadmin, setIsSuperadmin] = useState(false);
  const [summons, setSummons] = useState<{ id: string; message: string; created_at?: string; from_email?: string }[]>([]);
  const [notifications, setNotifications] = useState<{
    id: string; message: string; created_at: string; acknowledged_at: string | null; open: boolean; from_email?: string | null;
  }[]>([]);
  const [roomOccupancy, setRoomOccupancy] = useState<Record<string, { occupied: boolean; occupant: string | null }>>({});
  /** Hospital-wide waiting counts by service code — so staff see where patients actually are */
  const [waitingByService, setWaitingByService] = useState<Record<string, number>>({});
  const biometrics = useBiometrics();
  const [bioEnrollBusy, setBioEnrollBusy] = useState(false);
  const [bioEnrolledHere, setBioEnrolledHere] = useState(false);

  useIdleLogout(true);

  useEffect(() => {
    toast.success(`Welcome back, ${welcomeName(email)}!`, { duration: 4500 });
  }, [email]);

  useEffect(() => {
    if (!biometrics.active || !email) return;
    let cancelled = false;
    void checkBiometricEnrolled(email).then((ok) => {
      if (!cancelled) setBioEnrolledHere(ok);
    });
    return () => {
      cancelled = true;
    };
  }, [biometrics.active, email]);

  const enrollDeviceBiometrics = async () => {
    if (!biometrics.active) {
      toast.message("Biometrics inactive", { description: biometrics.reason, duration: 7000 });
      return;
    }
    setBioEnrollBusy(true);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error("Session expired — sign in again");
      await enrollBiometrics(token, "Staff console");
      setBioEnrolledHere(true);
      toast.success("Fingerprint / face unlock registered on this device");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not register biometrics");
    } finally {
      setBioEnrollBusy(false);
    }
  };

  useEffect(() => {
    supabase.rpc("ensure_staff_access").then(({ error }) => {
      if (error) {
        console.warn("ensure_staff_access", error.message);
        setNeedsDbFix(true);
        toast.error(error.message);
      }
    });
    const refreshAccess = () => {
      void supabase.rpc("get_my_access").then(({ data }) => {
        const a = data as {
          is_superadmin?: boolean;
          summons?: { id: string; message: string; created_at?: string; from_email?: string }[];
          rooms?: { counter_id: string; occupied: boolean; occupant: string | null }[];
        } | null;
        if (!a) return;
        setIsSuperadmin(!!a.is_superadmin);
        const open = a.summons ?? [];
        setSummons(open);
        const map: Record<string, { occupied: boolean; occupant: string | null }> = {};
        for (const r of a.rooms ?? []) {
          map[r.counter_id] = { occupied: !!r.occupied, occupant: r.occupant ?? null };
        }
        setRoomOccupancy(map);
      });
      void supabase.rpc("staff_my_notifications", { p_limit: 50 }).then(({ data, error }) => {
        if (error) {
          console.warn("staff_my_notifications", error.message);
          return;
        }
        setNotifications(Array.isArray(data) ? data : []);
      });
      // Pick up rooms the superadmin just added
      void supabase.from("counters").select("id,name,service_id").eq("active", true).order("name").then(({ data }) => {
        const list = data ?? [];
        setCounters(list);
        setCounterId((prev) => {
          if (prev && list.some((c) => c.id === prev)) return prev;
          const saved = localStorage.getItem("kh-counter") ?? "";
          if (saved && list.some((c) => c.id === saved)) return saved;
          return prev;
        });
      });
    };
    refreshAccess();
    const accessTimer = setInterval(refreshAccess, 20000);
    supabase.from("services").select("id,code,name_en,avg_minutes,surge_threshold,category").order("sort").then(({ data }) => setServices(data ?? []));
    return () => clearInterval(accessTimer);
  }, []);

  useEffect(() => {
    if (!counterId || isSuperadmin) return; // Superadmin observes only — never check in / claim the room
    void supabase.rpc("staff_check_in", { p_counter: counterId }).then(({ error }) => {
      if (error) console.warn("check-in", error.message);
    });
  }, [counterId, userId, isSuperadmin]);

  // Keep live presence for payroll hours (login windows + daily totals)
  useEffect(() => {
    if (!counterId || isSuperadmin) return;
    const ping = () => {
      void supabase.rpc("staff_session_ping", { p_counter: counterId }).then(({ error }) => {
        if (error) console.warn("session-ping", error.message);
      });
    };
    ping();
    const t = window.setInterval(ping, 60_000);
    const onHide = () => {
      if (document.visibilityState === "hidden") {
        void supabase.rpc("staff_session_ping", { p_counter: counterId });
      }
    };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.clearInterval(t);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [counterId, isSuperadmin]);

  const counter = counters.find((c) => c.id === counterId);
  const deskService = services.find((s) => s.id === counter?.service_id);
  const canSeeCover = !!deskService && COVER_DESK_CODES.has(deskService.code);
  const canRelease = !!deskService && RELEASE_DESK_CODES.has(deskService.code);
  const showPriorityReasons = !!deskService && (
    REASON_DESK_CODES.has(deskService.code) || deskService.category === "clinic"
  );

  const loadHospitalWaiting = useCallback(async () => {
    const { data } = await supabase.rpc("get_display_board");
    const queues = (data as { queues?: { code: string; waiting: number }[] } | null)?.queues ?? [];
    const map: Record<string, number> = {};
    for (const q of queues) {
      if (Number(q.waiting) > 0) map[q.code] = Number(q.waiting);
    }
    setWaitingByService(map);
  }, []);

  const load = useCallback(async () => {
    void loadHospitalWaiting();
    if (!counter) return;
    const { data, error } = await supabase.rpc("get_counter_queue", { p_counter: counter.id });
    if (!error && data) {
      const rows = (Array.isArray(data) ? data : []) as Ticket[];
      setTickets(rows.map((row) => ({
        triage_level: "green",
        triage_note: null,
        care_path: [],
        path_step: 0,
        appointment_at: null,
        ...row,
      })));
      return;
    }
    // Fallback if RPC not migrated yet
    if (error) {
      console.warn("get_counter_queue", error.message);
      if (/Could not find|does not exist|schema cache|404/i.test(error.message)) setNeedsDbFix(true);
    }
    const fullCols = "id,token,status,priority,payment,visit_type,queued_at,counter_id,service_id,recall_count,triage_level,triage_note,care_path,path_step,appointment_at";
    const basicCols = "id,token,status,priority,payment,visit_type,queued_at,counter_id,service_id,recall_count";
    const fetchBoth = async (cols: string) => Promise.all([
      supabase.from("tickets").select(cols).eq("service_id", counter.service_id).eq("status", "waiting").order("queued_at").limit(300),
      supabase.from("tickets").select(cols).eq("counter_id", counter.id).in("status", ["called", "serving"]).limit(20),
    ]);
    let [waitingRes, activeRes] = await fetchBoth(fullCols);
    if (waitingRes.error?.message?.includes("column") || activeRes.error?.message?.includes("column")) {
      [waitingRes, activeRes] = await fetchBoth(basicCols);
    }
    if (waitingRes.error) toast.error(waitingRes.error.message || "Could not load waiting patients");
    if (activeRes.error) toast.error(activeRes.error.message || "Could not load active ticket");
    const byId = new Map<string, Ticket>();
    for (const row of [...((waitingRes.data ?? []) as unknown as Ticket[]), ...((activeRes.data ?? []) as unknown as Ticket[])]) {
      byId.set(row.id, {
        triage_level: "green",
        triage_note: null,
        care_path: [],
        path_step: 0,
        appointment_at: null,
        ...row,
      });
    }
    setTickets([...byId.values()]);
  }, [counter, loadHospitalWaiting]);

  useEffect(() => {
    load();
    const poll = setInterval(load, 5000);
    const ch = supabase.channel(`staff-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "tickets" }, () => load())
      .subscribe();
    return () => { clearInterval(poll); supabase.removeChannel(ch); };
  }, [load]);

  const current = tickets.find((t) => t.counter_id === counter?.id && (t.status === "called" || t.status === "serving"));
  const waiting = sortQueue(tickets.filter((t) => t.status === "waiting"));
  const serviceName = (id: string) => services.find((s) => s.id === id)?.name_en ?? "";
  const serviceCode = (id: string) => services.find((s) => s.id === id)?.code ?? "";
  const svc = services.find((s) => s.id === counter?.service_id);
  const elsewhereWaiting = useMemo(() => {
    const myCode = svc?.code;
    return Object.entries(waitingByService)
      .filter(([code, n]) => n > 0 && code !== myCode)
      .map(([code, n]) => {
        const s = services.find((x) => x.code === code);
        const desk = counters.find((c) => c.service_id === s?.id);
        return { code, n, name: s?.name_en ?? code, counterId: desk?.id, counterName: desk?.name };
      })
      .sort((a, b) => b.n - a.n);
  }, [waitingByService, svc?.code, services, counters]);
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    setNowMs(Date.now());
    const i = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(i);
  }, []);
  const [lw, setLw] = useState<{ on: boolean; min: number }>({ on: true, min: 45 });
  useEffect(() => {
    if (!svc) return;
    supabase.from("automation_settings").select("long_wait_enabled,long_wait_min").eq("service_id", svc.id).single()
      .then(({ data }) => data && setLw({ on: data.long_wait_enabled, min: data.long_wait_min }));
  }, [svc]);
  const longWaits = svc && lw.on ? waiting.filter((t, i) => isLongWait(t.queued_at, nowMs, svc.avg_minutes, i, lw.min)).map((t) => t.id) : [];

  const resetPrioForm = () => {
    setPrioMode(null);
    setPrioPicks([]);
    setPrioOther("");
  };

  const act = async (action: string, target?: string, note?: string) => {
    if (isSuperadmin) { toast.message("Observation only — management disabled"); return; }
    if (!current) return;
    const token = current.token;
    const args: { p_ticket: string; p_action: string; p_target_service?: string; p_note?: string } = {
      p_ticket: current.id,
      p_action: action,
    };
    if (target) args.p_target_service = target;
    if (note) args.p_note = note;
    const { error } = await supabase.rpc("staff_action", args);
    if (error) toast.error(error.message);
    else {
      if (action === "recall") {
        toast.success(`Recalling ${token}`);
      }
      if (action === "transfer") { toast.success(`${token} sent to ${serviceName(target!)}`); setTransferTo(""); }
      if (action === "no_show") toast.success(`${token} returned to this department’s waiting list`);
      if (action === "escalate_priority") toast.success("Escalated to priority");
      if (action === "escalate") toast.success("Escalated to emergency");
      if (action === "return_common") toast.success("Returned to common (normal) queue");
      if (action === "complete") toast.success(`${token} released`);
      if (action === "escalate" || action === "escalate_priority" || action === "return_common") resetPrioForm();
      load();
    }
  };

  const submitPriorityChange = async () => {
    if (!prioMode) return;
    const detail = prioOther.trim();
    const picks = [...prioPicks];
    if (detail) picks.push(detail);
    const note = picks.join("; ").trim();
    if (!note) {
      toast.error("Select or type a reason for this priority change");
      return;
    }
    await act(prioMode, undefined, note.slice(0, 400));
  };
  const callNext = async () => {
    if (isSuperadmin) { toast.message("Observation only — management disabled"); return; }
    if (!counter) return;
    const { data, error } = await supabase.rpc("call_next", { p_counter: counter.id });
    if (error) toast.error(error.message);
    else if (!data) toast("No one waiting");
    load();
  };
  const callTicket = async (ticketId: string, token: string) => {
    if (isSuperadmin) { toast.message("Observation only — management disabled"); return; }
    if (!counter) return;
    if (current) { toast.error("Finish or return the patient at your desk first"); return; }
    const { data, error } = await supabase.rpc("call_ticket", { p_counter: counter.id, p_ticket: ticketId });
    if (error) toast.error(error.message);
    else {
      toast.success(`Calling ${token}`);
    }
    load();
  };

  return (
    <main className="min-h-screen bg-background">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b bg-card px-6 py-4">
        <div className="flex items-center gap-4">
          <Link to="/" className="flex items-center gap-2 font-display text-xl font-bold text-primary">
            <img src="/brand/kijabe-logo.png" alt="" className="h-9 w-auto object-contain" />
            Kijabe Care Flow
          </Link>
          <Select value={counterId} onValueChange={(v) => { setCounterId(v); localStorage.setItem("kh-counter", v); }}>
            <SelectTrigger className="w-72"><SelectValue placeholder="Choose any counter / room" /></SelectTrigger>
            <SelectContent>
              {counters.map((c) => {
                const occ = roomOccupancy[c.id];
                const w = waitingByService[serviceCode(c.service_id)] ?? 0;
                const tag = [
                  w > 0 ? `${w} waiting` : null,
                  occ ? (occ.occupied ? `Occupied${occ.occupant ? ` (${occ.occupant})` : ""}` : "Vacant") : null,
                ].filter(Boolean).join(" · ");
                return (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name} — {serviceName(c.service_id)}{tag ? ` · ${tag}` : ""}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
          {isSuperadmin && <Link to="/admin" className="font-semibold text-primary underline">Superadmin</Link>}
          <Link to="/automation" className="font-semibold text-primary underline">Automation settings</Link>
          <MoonPhaseLive className="hidden lg:inline-flex scale-90 origin-right" />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!biometrics.active || bioEnrollBusy || bioEnrolledHere}
            title={biometrics.active ? (bioEnrolledHere ? "Biometrics already enrolled" : "Register fingerprint or face") : biometrics.reason}
            onClick={() => void enrollDeviceBiometrics()}
          >
            <Fingerprint className="h-4 w-4" />
            {bioEnrollBusy
              ? "Sensor…"
              : bioEnrolledHere
                ? "Biometrics on"
                : biometrics.active
                  ? "Add biometrics"
                  : "Biometrics inactive"}
          </Button>
          {email}
          <Button variant="ghost" size="sm" onClick={async () => { await supabase.rpc("staff_check_out"); await supabase.auth.signOut(); }}><LogOut className="h-4 w-4" /> Sign out</Button>
        </div>
      </header>

      {isSuperadmin && (
        <div className="border-b border-primary/30 bg-primary/10 px-6 py-3">
          <p className="mx-auto max-w-6xl text-sm font-semibold text-primary">
            Superadmin observation mode — you can open any room and see every patient detail, but you cannot call,
            treat, transfer, register, or change the queue. Use Superadmin → Observe for the dedicated view.
          </p>
        </div>
      )}

      {!!summons.length && (
        <div className="border-b border-destructive/40 bg-destructive/10 px-6 py-3">
          {summons.map((s) => (
            <div key={s.id} className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
              <p className="font-semibold text-destructive">Admin summon: {s.message}</p>
              <Button size="sm" variant="destructive" onClick={async () => {
                await supabase.rpc("staff_ack_summon", { p_id: s.id });
                setSummons((prev) => prev.filter((x) => x.id !== s.id));
                setNotifications((prev) =>
                  prev.map((n) =>
                    n.id === s.id
                      ? { ...n, open: false, acknowledged_at: new Date().toISOString() }
                      : n,
                  ),
                );
                toast.success("Summon acknowledged");
              }}>Acknowledge</Button>
            </div>
          ))}
        </div>
      )}

      <Tabs defaultValue="desk" className="mx-auto max-w-6xl p-6">
        <TabsList className="flex h-auto flex-wrap">
          <TabsTrigger value="desk">{isSuperadmin ? "Observe desk" : "My desk"}</TabsTrigger>
          {canSeeCover && !isSuperadmin && <TabsTrigger value="registration">Registration</TabsTrigger>}
          {canSeeCover && !isSuperadmin && <TabsTrigger value="insurers">Insurers</TabsTrigger>}
          <TabsTrigger value="notifications" className="gap-1.5">
            <Bell className="h-3.5 w-3.5" />
            Notifications
            {summons.length > 0 && (
              <span className="ml-1 rounded-full bg-destructive px-1.5 py-0.5 text-[10px] font-bold text-destructive-foreground">
                {summons.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="advisor">Queue advisor</TabsTrigger>
          <TabsTrigger value="audit">Audit trail</TabsTrigger>
        </TabsList>

        <TabsContent value="desk">
          {needsDbFix && (
            <div className="mb-4 rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm">
              <p className="font-semibold text-destructive">Database fix required for staff queue</p>
              <p className="mt-1 text-muted-foreground">Your login works, but this account is not granted staff access in Supabase yet — so waiting patients stay hidden.</p>
              <Link to="/apply-db-fix" className="mt-2 inline-block font-semibold text-primary underline">Open one-step SQL fix →</Link>
            </div>
          )}
          {!counter ? (
            <div className="mt-10 space-y-4 text-center">
              <p className="text-lg text-muted-foreground">Choose your counter or room above to start.</p>
              {elsewhereWaiting.length > 0 && (
                <p className="text-sm text-primary">
                  Patients are waiting at: {elsewhereWaiting.map((e) => `${e.name} (${e.n})`).join(", ")}.
                  New kiosk tickets start at <b>Triage</b>.
                </p>
              )}
            </div>
          ) : (
            <div className="mt-4 grid gap-6 lg:grid-cols-[1.3fr_1fr]">
              <section className="rounded-2xl border bg-card p-6">
                <p className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">{counter.name} · {serviceName(counter.service_id)}</p>
                {!waiting.length && !current && elsewhereWaiting.length > 0 && (
                  <div className="mt-4 rounded-xl bg-accent/20 p-4 text-sm">
                    <p className="font-semibold">No patients at this desk right now.</p>
                    <p className="mt-1 text-muted-foreground">
                      Walk-in tickets begin at <b>Triage</b>, then move along the care path. Switch room to see them:
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {elsewhereWaiting.slice(0, 6).map((e) => (
                        <Button
                          key={e.code}
                          size="sm"
                          variant="outline"
                          disabled={!e.counterId}
                          onClick={() => {
                            if (!e.counterId) return;
                            setCounterId(e.counterId);
                            localStorage.setItem("kh-counter", e.counterId);
                          }}
                        >
                          {e.counterName || e.name} · {e.n}
                        </Button>
                      ))}
                    </div>
                  </div>
                )}
                {current ? (
                  <>
                    <div className="mt-4 flex items-end justify-between">
                      <p className="font-display text-7xl font-extrabold text-primary">{current.token}</p>
                      <span className={`rounded-full px-3 py-1 text-sm font-semibold ${current.status === "serving" ? "bg-success/20 text-success" : "bg-accent/30 text-accent-foreground"}`}>
                        {current.status === "serving" ? "Serving" : `Called${current.recall_count ? ` ×${current.recall_count + 1}` : ""}`}
                      </span>
                    </div>
                    <TriageBadge level={current.triage_level} priority={current.priority} />
                    {current.hospital_no && (
                      <p className="mt-2 rounded-lg bg-secondary px-3 py-2 text-sm">
                        Hospital number: <span className="font-display text-lg font-bold tracking-wide">{current.hospital_no}</span>
                      </p>
                    )}
                    {showPriorityReasons && (current.priority >= 1 || current.triage_level === "red" || current.triage_level === "orange" || current.triage_note) && (
                      <div className={`mt-3 rounded-xl border p-3 ${current.priority >= 2 || current.triage_level === "red" ? "border-destructive/40 bg-destructive/10" : "border-accent/50 bg-accent/20"}`}>
                        <p className="text-xs font-semibold uppercase tracking-wider">
                          {current.priority >= 2 ? "Emergency reasons" : "Priority / walk-in reasons"}
                        </p>
                        <p className="mt-1 text-sm font-semibold">
                          {current.triage_note || "Marked priority/emergency at walk-in — no free-text reason recorded."}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Level: {PRIORITY_LABEL[current.priority]}
                          {current.triage_level && current.triage_level !== "green" ? ` · triage ${current.triage_level}` : ""}
                        </p>
                      </div>
                    )}
                    {!showPriorityReasons && current.triage_note && (
                      <p className="mt-2 rounded-lg bg-muted p-2 text-sm">Reported: {current.triage_note}</p>
                    )}
                    {current.care_path?.length > 0 && (
                      <p className="mt-2 text-sm">Care path: {current.care_path.map((c, i) => <span key={i} className={i === current.path_step ? "font-bold text-primary" : "text-muted-foreground"}>{i ? " → " : ""}{c}</span>)}</p>
                    )}
                    <p className="mt-2 text-muted-foreground">
                      {PRIORITY_LABEL[current.priority]}
                      {canSeeCover
                        ? ` · ${PAYMENT_LABEL[current.payment] ?? current.payment}${current.payment_detail || current.insurer_name ? ` (${current.insurer_name || current.payment_detail})` : ""}`
                        : ""}
                      {" · "}{current.visit_type === "booked" ? "Appointment" : "Walk-in"}
                    </p>
                    {svc && ["cashier", "insurance", "sha"].includes(svc.code) && current.status === "serving" && !isSuperadmin && (
                      <BillingPanel ticketId={current.id} paymentMethod={current.payment} onPaid={load} />
                    )}
                    {!isSuperadmin ? (
                      <>
                        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
                          <Button variant="outline" onClick={() => act("recall")}><RotateCcw className="h-4 w-4" /> Recall</Button>
                          {current.status === "called" && <Button onClick={() => act("start")}><Play className="h-4 w-4" /> Start</Button>}
                          <Button variant="outline" onClick={() => act("requeue")}><Undo2 className="h-4 w-4" /> Back to queue</Button>
                          <Button variant="destructive" onClick={() => act("no_show")}><UserX className="h-4 w-4" /> No-show → waiting</Button>
                          {current.status === "called" && <Button variant="outline" onClick={async () => { await act("skip"); await callNext(); }}><UserX className="h-4 w-4" /> Not responding — call next</Button>}
                          {current.priority < 1 && (
                            <Button
                              variant={prioMode === "escalate_priority" ? "default" : "outline"}
                              onClick={() => { setPrioMode("escalate_priority"); setPrioPicks([]); setPrioOther(""); }}
                            >
                              Escalate to priority
                            </Button>
                          )}
                          {current.priority < 2 && (
                            <Button
                              variant="destructive"
                              className={prioMode === "escalate" ? "ring-2 ring-offset-2 ring-destructive" : undefined}
                              onClick={() => { setPrioMode("escalate"); setPrioPicks([]); setPrioOther(""); }}
                            >
                              Escalate to emergency
                            </Button>
                          )}
                          {(current.priority > 0 || (current.triage_level && current.triage_level !== "green")) && (
                            <Button
                              variant={prioMode === "return_common" ? "secondary" : "outline"}
                              className={prioMode === "return_common" ? "ring-2 ring-offset-2 ring-primary" : undefined}
                              onClick={() => { setPrioMode("return_common"); setPrioPicks([]); setPrioOther(""); }}
                              title="Downgrade to normal queue — reason required"
                            >
                              Return to common
                            </Button>
                          )}
                          {canRelease && (
                            <Button onClick={() => act("complete")}><Check className="h-4 w-4" /> Release patient</Button>
                          )}
                        </div>
                        {prioMode && (
                          <div className="mt-4 rounded-xl border border-accent/40 bg-accent/10 p-4">
                            <p className="text-sm font-semibold">
                              {prioMode === "escalate"
                                ? "Emergency — state reason(s)"
                                : prioMode === "escalate_priority"
                                  ? "Priority — state reason(s)"
                                  : "Return to common (normal) — state reason(s)"}
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              Reasons are saved on the ticket for audit and the next desk.
                            </p>
                            <div className="mt-3 flex flex-wrap gap-2">
                              {PRIORITY_CHANGE_REASONS[prioMode].map((r) => {
                                const on = prioPicks.includes(r);
                                return (
                                  <button
                                    key={r}
                                    type="button"
                                    onClick={() => setPrioPicks((prev) => on ? prev.filter((x) => x !== r) : [...prev, r])}
                                    className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                                      on
                                        ? "border-primary bg-primary text-primary-foreground"
                                        : "border-border bg-background hover:border-primary/50"
                                    }`}
                                  >
                                    {r}
                                  </button>
                                );
                              })}
                            </div>
                            <Textarea
                              className="mt-3 min-h-[64px]"
                              placeholder="Extra detail (optional if you picked reasons above)"
                              value={prioOther}
                              onChange={(e) => setPrioOther(e.target.value)}
                              maxLength={280}
                            />
                            <div className="mt-3 flex flex-wrap gap-2">
                              <Button onClick={() => void submitPriorityChange()} disabled={!prioPicks.length && !prioOther.trim()}>
                                Confirm {prioMode === "return_common" ? "return to common" : prioMode === "escalate" ? "emergency" : "priority"}
                              </Button>
                              <Button variant="ghost" onClick={resetPrioForm}>Cancel</Button>
                            </div>
                          </div>
                        )}
                        <div className="mt-6 rounded-xl border border-primary/30 bg-primary/5 p-4">
                          <p className="mb-1 font-semibold">Send to next department</p>
                          <p className="mb-3 text-xs text-muted-foreground">
                            {canRelease
                              ? "Optional — or use Release patient if this is their last step."
                              : "Required — choose the next department before the patient can leave your desk."}
                          </p>
                          <div className="flex gap-2">
                            <Select value={transferTo} onValueChange={setTransferTo}>
                              <SelectTrigger className="flex-1"><SelectValue placeholder="Choose department" /></SelectTrigger>
                              <SelectContent>
                                {services.filter((s) => s.id !== counter.service_id).map((s) => <SelectItem key={s.id} value={s.id}>{s.name_en}</SelectItem>)}
                              </SelectContent>
                            </Select>
                            <Button disabled={!transferTo} onClick={() => act("transfer", transferTo)}><ArrowRightLeft className="h-4 w-4" /> Send</Button>
                          </div>
                        </div>
                      </>
                    ) : (
                      <p className="mt-6 rounded-xl border border-dashed border-primary/40 bg-primary/5 p-4 text-sm font-semibold text-primary">
                        View only — management controls are hidden for superadmin.
                      </p>
                    )}
                  </>
                ) : (
                  <div className="py-10 text-center">
                    <p className="text-muted-foreground">No patient at this desk.</p>
                    {!isSuperadmin && (
                      <Button size="lg" className="mt-4 h-16 px-10 text-xl" onClick={callNext} disabled={!waiting.length}>
                        <Megaphone className="h-6 w-6" /> Call next
                      </Button>
                    )}
                  </div>
                )}
              </section>

              <section className="rounded-2xl border bg-card p-6">
                <h2 className="text-xl font-bold">Waiting ({waiting.length})</h2>
                {svc && isSurge(waiting.length, svc.surge_threshold) && (
                  <p className="mt-2 rounded-lg bg-destructive/10 p-2 text-sm font-semibold text-destructive">High demand — overflow desks open automatically. Consider sending extra staff.</p>
                )}
                {longWaits.length > 0 && <p className="mt-2 rounded-lg bg-accent/30 p-2 text-sm font-semibold">{longWaits.length} patient(s) waiting too long</p>}
                <ul className="mt-3 max-h-[60vh] divide-y overflow-auto">
                  {waiting.map((t) => (
                    <li key={t.id} className={`flex flex-wrap items-center justify-between gap-2 py-2 ${longWaits.includes(t.id) ? "bg-accent/20" : ""}`}>
                      <div className="min-w-0">
                        <span className="font-display text-lg font-bold">{t.token}{longWaits.includes(t.id) && <span className="ml-2 text-xs font-semibold text-destructive">LONG WAIT</span>}</span>
                        {t.hospital_no && <p className="text-xs font-semibold text-muted-foreground">Hosp. {t.hospital_no}</p>}
                        {showPriorityReasons && t.triage_note && (t.priority >= 1 || t.triage_level === "red" || t.triage_level === "orange") && (
                          <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{t.triage_note}</p>
                        )}
                      </div>
                      <span className="flex flex-wrap items-center justify-end gap-2 text-sm text-muted-foreground">
                        <TriageBadge level={t.triage_level} priority={t.priority} small />
                        {t.appointment_at && <span className="rounded bg-secondary px-2 py-0.5 text-xs">Appt {new Date(t.appointment_at).toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" })}</span>}
                        {canSeeCover ? `${PAYMENT_LABEL[t.payment] ?? t.payment} · ` : ""}
                        <span
                          className="font-display tabular-nums text-base font-bold text-foreground"
                          title={`Queued ${new Date(t.queued_at).toLocaleString("en-KE")}`}
                          aria-label={`Waiting ${formatWaitDuration(t.queued_at, nowMs)}`}
                        >
                          {formatWaitDuration(t.queued_at, nowMs)}
                        </span>
                        {!isSuperadmin && (
                          <Button
                            size="sm"
                            variant={current ? "outline" : "default"}
                            disabled={!!current}
                            onClick={() => callTicket(t.id, t.token)}
                            title={current ? "Finish the patient at your desk first" : `Treat ${t.token} next`}
                          >
                            Treat next
                          </Button>
                        )}
                      </span>
                    </li>
                  ))}
                  {!waiting.length && (
                    <li className="py-6 text-center text-muted-foreground">
                      Queue is empty at this desk
                      {elsewhereWaiting[0] ? (
                        <span className="mt-1 block text-sm text-primary">
                          {elsewhereWaiting[0].n} waiting at {elsewhereWaiting[0].name}
                          {elsewhereWaiting[0].code === "triage" ? " — open a Triage room" : ""}
                        </span>
                      ) : null}
                    </li>
                  )}
                </ul>
              </section>
            </div>
          )}
        </TabsContent>

        {canSeeCover && !isSuperadmin && <TabsContent value="registration"><StaffRegistration /></TabsContent>}
        {canSeeCover && !isSuperadmin && <TabsContent value="insurers"><InsurersAdmin /></TabsContent>}

        <TabsContent value="notifications" className="mt-4">
          <section className="rounded-2xl border bg-card p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="flex items-center gap-2 font-display text-xl font-bold">
                  <Bell className="h-5 w-5 text-primary" /> Notifications
                </h2>
                <p className="text-sm text-muted-foreground">
                  Admin summons and urgent calls. Open items also appear as the red banner above.
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  const { data, error } = await supabase.rpc("staff_my_notifications", { p_limit: 50 });
                  if (error) toast.error(error.message);
                  else setNotifications((data as typeof notifications) ?? []);
                }}
              >
                Refresh
              </Button>
            </div>

            <ul className="mt-4 divide-y">
              {notifications.map((n) => (
                <li key={n.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {n.open ? (
                        <span className="rounded-full bg-destructive/15 px-2 py-0.5 text-[10px] font-bold uppercase text-destructive">Open</span>
                      ) : (
                        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold uppercase text-muted-foreground">Acknowledged</span>
                      )}
                      <span className="text-xs text-muted-foreground">
                        {n.created_at ? new Date(n.created_at).toLocaleString("en-KE") : ""}
                        {n.from_email ? ` · from ${n.from_email}` : ""}
                      </span>
                    </div>
                    <p className={`mt-1 ${n.open ? "font-semibold text-destructive" : "text-foreground"}`}>{n.message}</p>
                  </div>
                  {n.open && (
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={async () => {
                        const { error } = await supabase.rpc("staff_ack_summon", { p_id: n.id });
                        if (error) toast.error(error.message);
                        else {
                          setSummons((prev) => prev.filter((x) => x.id !== n.id));
                          setNotifications((prev) =>
                            prev.map((x) =>
                              x.id === n.id
                                ? { ...x, open: false, acknowledged_at: new Date().toISOString() }
                                : x,
                            ),
                          );
                          toast.success("Acknowledged");
                        }
                      }}
                    >
                      Acknowledge
                    </Button>
                  )}
                </li>
              ))}
              {!notifications.length && (
                <li className="py-10 text-center text-muted-foreground">No notifications yet</li>
              )}
            </ul>
          </section>
        </TabsContent>

        <TabsContent value="advisor"><Advisor services={services} defaultService={counter?.service_id ?? ""} /></TabsContent>
        <TabsContent value="audit"><Audit /></TabsContent>
      </Tabs>
    </main>
  );
}

function InsurersAdmin() {
  type Row = { id: string; name: string; code: string | null; active: boolean; sort: number };
  const [rows, setRows] = useState<Row[]>([]);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () => {
    supabase.rpc("staff_list_insurers_all").then(({ data, error }) => {
      if (error) toast.error(error.message);
      else setRows((data as unknown as Row[]) ?? []);
    });
  };
  useEffect(() => { load(); }, []);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.rpc("staff_upsert_insurer", {
      p_id: null as unknown as string,
      p_name: name.trim(),
      p_code: code.trim() || (null as unknown as string),
      p_active: true,
      p_sort: 100,
    });
    setBusy(false);
    if (error) toast.error(error.message);
    else { toast.success("Insurer added"); setName(""); setCode(""); load(); }
  };

  const toggle = async (row: Row) => {
    const { error } = await supabase.rpc("staff_upsert_insurer", {
      p_id: row.id,
      p_name: row.name,
      p_code: row.code || (null as unknown as string),
      p_active: !row.active,
      p_sort: row.sort,
    });
    if (error) toast.error(error.message);
    else load();
  };

  return (
    <section className="mt-4 mx-auto max-w-2xl rounded-2xl border bg-card p-6">
      <h2 className="text-xl font-bold">Insurance providers</h2>
      <p className="text-sm text-muted-foreground">Shown on the kiosk for patients. Registration, insurance and billing desks can add or deactivate entries.</p>
      <form onSubmit={save} className="mt-4 flex flex-wrap gap-2">
        <Input className="flex-1 min-w-[12rem]" placeholder="Insurer name" value={name} onChange={(e) => setName(e.target.value)} required />
        <Input className="w-36" placeholder="Code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />
        <Button disabled={busy || name.trim().length < 2}>{busy ? "Saving…" : "Add"}</Button>
      </form>
      <ul className="mt-4 max-h-[50vh] divide-y overflow-auto">
        {rows.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-3 py-2 text-sm">
            <div>
              <p className="font-semibold">{r.name}</p>
              <p className="text-muted-foreground">{r.code || "—"} · sort {r.sort}</p>
            </div>
            <Button type="button" variant={r.active ? "outline" : "secondary"} size="sm" onClick={() => toggle(r)}>
              {r.active ? "Active" : "Inactive"}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function StaffRegistration() {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [surname, setSurname] = useState("");
  const [phone, setPhone] = useState("");
  const [nid, setNid] = useState("");
  const [hospitalNo, setHospitalNo] = useState("");
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<{ card_no: string; first_name: string; last_name?: string | null; surname?: string | null } | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const hno = hospitalNo.trim().toUpperCase().replace(/\s+/g, "");
    if (hno.length < 3) { toast.error("Type the hospital number — it is not generated automatically."); return; }
    if (firstName.trim().length < 2) { toast.error("Enter first name"); return; }
    setBusy(true);
    const { data, error } = await supabase.rpc("staff_register_patient", {
      p_first_name: firstName.trim(),
      p_last_name: lastName.trim() || (null as unknown as string),
      p_surname: surname.trim() || (null as unknown as string),
      p_phone: phone.length === 9 ? `+254${phone}` : (null as unknown as string),
      p_national_id: nid || (null as unknown as string),
      p_hospital_no: hno,
    });
    setBusy(false);
    if (error) {
      toast.error(error.message.includes("already") ? error.message : "Could not register patient.");
      return;
    }
    const row = data as unknown as { card_no: string; first_name: string; last_name?: string | null; surname?: string | null };
    setLast(row);
    const display = [row.first_name, row.last_name, row.surname].filter(Boolean).join(" ");
    toast.success(`Registered ${display} · ${row.card_no}`);
    setFirstName(""); setLastName(""); setSurname(""); setPhone(""); setNid(""); setHospitalNo("");
  };

  return (
    <section className="mt-4 mx-auto max-w-lg rounded-2xl border bg-card p-6">
      <div className="flex items-center gap-3">
        <UserPlus className="h-8 w-8 text-primary" />
        <div>
          <h2 className="text-xl font-bold">Issue hospital number</h2>
          <p className="text-sm text-muted-foreground">Key in the hospital number from the card register. Numbers are never auto-generated.</p>
        </div>
      </div>
      <form onSubmit={submit} className="mt-6 space-y-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className="mb-1 block text-sm font-semibold">First name</label>
                <Input value={firstName} onChange={(e) => setFirstName(capitalizeName(e.target.value))} required minLength={2} maxLength={40} placeholder="Mary" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-semibold">Last / middle</label>
                <Input value={lastName} onChange={(e) => setLastName(capitalizeName(e.target.value))} maxLength={40} placeholder="Wanjiku" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-semibold">Surname</label>
                <Input value={surname} onChange={(e) => setSurname(capitalizeName(e.target.value))} maxLength={40} placeholder="Kamau" />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-sm font-semibold">Hospital number</label>
          <Input
            value={hospitalNo}
            onChange={(e) => setHospitalNo(e.target.value.toUpperCase().replace(/[^A-Z0-9/-]/g, "").slice(0, 24))}
            required
            minLength={3}
            maxLength={24}
            placeholder="Type hospital number (e.g. KH100001)"
            className="font-display text-lg tracking-wide"
            autoComplete="off"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-semibold">Phone (optional)</label>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">+254</span>
            <Input
              inputMode="numeric"
              value={phone}
              onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").replace(/^0/, "").slice(0, 9))}
              placeholder="712345678"
            />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-sm font-semibold">National ID (optional)</label>
          <Input
            value={nid}
            onChange={(e) => setNid(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12))}
            placeholder="12345678"
          />
        </div>
        <Button className="w-full" disabled={busy || firstName.trim().length < 2 || hospitalNo.trim().length < 3}>
          {busy ? "Saving…" : "Register & issue hospital number"}
        </Button>
      </form>
      {last && (
        <p className="mt-4 rounded-xl bg-secondary p-3 text-center text-sm">
          Last issued: <b className="font-display text-lg">{last.card_no}</b> · {[last.first_name, last.last_name, last.surname].filter(Boolean).join(" ")}
        </p>
      )}
    </section>
  );
}

type AuditRow = { id: string; action: string; created_at: string; staff_email: string | null; ticket_id?: string | null; service_id?: string | null; counter_id?: string | null; tickets?: { token: string } | null; services?: { name_en: string } | null; counters?: { name: string } | null };

function Audit() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [filter, setFilter] = useState("");
  useEffect(() => {
    supabase.from("ticket_events")
      .select("id,action,created_at,staff_email,ticket_id,service_id,counter_id")
      .neq("action", "issued")
      .order("created_at", { ascending: false }).limit(300)
      .then(({ data }) => setRows((data as unknown as AuditRow[]) ?? []));
  }, []);
  const shown = rows.filter((r) => !filter || `${r.staff_email} ${r.tickets?.token} ${r.action}`.toLowerCase().includes(filter.toLowerCase()));
  return (
    <section className="mt-4 rounded-2xl border bg-card p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">Staff action log</h2>
          <p className="text-sm text-muted-foreground">Read-only record of staff and automated actions. No patient details are stored.</p>
        </div>
        <Input className="w-64" placeholder="Filter by staff, ticket or action" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </div>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-muted-foreground">
            <tr><th className="py-2">Time</th><th>Staff</th><th>Action</th><th>Ticket</th><th>Department</th><th>Counter</th></tr>
          </thead>
          <tbody className="divide-y">
            {shown.map((r) => (
              <tr key={r.id}>
                <td className="py-2 tabular-nums">{new Date(r.created_at).toLocaleString("en-KE")}</td>
                <td>{r.staff_email ?? "—"}</td>
                <td className="font-semibold">{ACTION_LABEL[r.action] ?? r.action}</td>
                <td className="font-display font-bold">{r.tickets?.token ?? r.ticket_id?.slice(0, 8)}</td>
                <td>{r.services?.name_en ?? r.service_id?.slice(0, 8)}</td>
                <td>{r.counters?.name ?? r.counter_id?.slice(0, 8) ?? "—"}</td>
              </tr>
            ))}
            {!shown.length && <tr><td colSpan={6} className="py-6 text-center text-muted-foreground">No staff actions yet</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Advisor({ services, defaultService }: { services: Service[]; defaultService: string }) {
  const run = useServerFn(suggestWorkflow);
  const [serviceId, setServiceId] = useState(defaultService);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string>("");
  useEffect(() => { if (!serviceId && defaultService) setServiceId(defaultService); }, [defaultService, serviceId]);
  const submit = async () => {
    setBusy(true); setResult("");
    try {
      const r = await run({ data: { serviceId, notes } });
      if (r.error) toast.error(r.error); else setResult(r.suggestion);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    } finally { setBusy(false); }
  };
  return (
    <section className="mt-4 grid gap-6 lg:grid-cols-2">
      <div className="rounded-2xl border bg-card p-6">
        <h2 className="text-xl font-bold">Describe the queue right now</h2>
        <p className="text-sm text-muted-foreground">The assistant combines your notes with today's live numbers and suggests non-clinical workflow changes. It does not give medical advice.</p>
        <Select value={serviceId} onValueChange={setServiceId}>
          <SelectTrigger className="mt-4"><SelectValue placeholder="Choose department" /></SelectTrigger>
          <SelectContent>{services.map((s) => <SelectItem key={s.id} value={s.id}>{s.name_en}</SelectItem>)}</SelectContent>
        </Select>
        <Textarea className="mt-3" rows={7} maxLength={3000} value={notes} onChange={(e) => setNotes(e.target.value)}
          placeholder="e.g. Only one cashier open, long line of SHA patients waiting for approval, many people asking where to go after the doctor..." />
        <Button className="mt-4 w-full" disabled={busy || !serviceId || notes.trim().length < 10} onClick={submit}>
          {busy ? "Thinking…" : "Suggest improvements"}
        </Button>
      </div>
      <div className="rounded-2xl border bg-card p-6">
        <h2 className="text-xl font-bold">Suggestions</h2>
        {result ? <div className="mt-3 whitespace-pre-wrap leading-relaxed">{result}</div>
          : <p className="mt-3 text-muted-foreground">{busy ? "Reviewing the queue…" : "Suggestions will appear here."}</p>}
      </div>
    </section>
  );
}

function TriageBadge({ level, priority, small }: { level: string; priority: number; small?: boolean }) {
  if (priority < 1 && (!level || level === "green")) return null;
  const red = priority === 2 || level === "red";
  const label = priority === 2 ? "EMERGENCY" : priority === 1 ? "PRIORITY" : red ? "RED" : "ORANGE";
  return <span className={`inline-block rounded px-2 py-0.5 font-bold ${small ? "text-xs" : "mt-2 text-sm"} ${red ? "bg-destructive text-destructive-foreground" : "bg-accent text-accent-foreground"}`}>{label}</span>;
}
