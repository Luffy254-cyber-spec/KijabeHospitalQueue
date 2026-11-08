import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StaffOceanScene } from "@/components/staff-ocean-scene";
import { Turnstile } from "@/components/turnstile";

const PENDING_KEY = "kh-login-pending";

export const Route = createFileRoute("/staff/reset")({
  head: () => ({
    meta: [
      { title: "Forgot password — Kijabe Care Flow" },
      { name: "description", content: "Reset your AIC Kijabe staff password with a 6-digit code." },
    ],
  }),
  component: ResetRequest,
});

function ResetRequest() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const res = await supabase.auth.requestPasswordReset(email, turnstileToken);
      if (res.error) {
        toast.error(res.error.message);
        return;
      }
      const address = (res.data?.email || email).trim().toLowerCase();
      try {
        sessionStorage.setItem(PENDING_KEY, JSON.stringify({ email: address, sentAt: Date.now() }));
      } catch { /* ignore */ }
      if (res.data?.code) {
        toast.message("Local test account — no mailbox needed", {
          description: `Reset code: ${res.data.code}`,
          duration: 20000,
          className: "staff-notice-toast",
        });
      }
      if (res.data?.mailFailed) {
        toast.error("Reset code could not be sent", {
          description: "Try again in a minute; if it keeps failing, ask admin@kijabe.local to check the mail service.",
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
      toast.success("Reset code sent", {
        description: "Enter the 6-digit code from your email. Missing? Check Spam / Junk / Promotions.",
        duration: 9000,
      });
      void navigate({ to: "/staff/code", search: { email: address, purpose: "reset" } });
    } finally {
      setBusy(false);
    }
  };

  return (
    <StaffOceanScene showSeaSounds={false}>
      <form onSubmit={submit} className="staff-ocean-card">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] opacity-80">AIC Kijabe Hospital</p>
        <h1 className="mt-2 text-3xl font-bold">Forgot password</h1>
        <p className="mt-2 text-sm opacity-85">
          Enter the email on your staff account. We send a 6-digit code, then you choose a new password.
        </p>

        <Input
          className="mt-6"
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoComplete="username"
        />

        <Turnstile onToken={setTurnstileToken} className="mt-4" />
        <Button className="mt-4 w-full" disabled={busy || !email.trim()}>
          {busy ? "Sending…" : "Send reset code"}
        </Button>

        <p className="mt-3 rounded-lg bg-black/10 px-3 py-2 text-xs leading-relaxed opacity-90">
          The code expires in 10 minutes and works once. Superadmin accounts at admin@kijabe.local never send mail — reset them from the console instead.
        </p>

        <Link to="/staff" className="staff-ocean-link mt-4 block text-center text-sm underline">
          ← Back to sign in
        </Link>
        <Link
          to="/staff/change-email"
          search={{ email: "", ticket: "" }}
          className="staff-ocean-link mt-2 block text-center text-sm underline"
        >
          Need to change your email instead?
        </Link>
      </form>
    </StaffOceanScene>
  );
}
