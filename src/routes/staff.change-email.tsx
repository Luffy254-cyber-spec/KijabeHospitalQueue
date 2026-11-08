import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StaffOceanScene } from "@/components/staff-ocean-scene";

const PENDING_KEY = "kh-login-pending";

export const Route = createFileRoute("/staff/change-email")({
  head: () => ({
    meta: [
      { title: "Change email — Kijabe Care Flow" },
      { name: "description", content: "Move your AIC Kijabe staff account to a new email address." },
    ],
  }),
  validateSearch: (search: Record<string, unknown>) => ({
    email: typeof search.email === "string" ? search.email.trim().toLowerCase() : "",
    ticket: typeof search.ticket === "string" ? search.ticket : "",
  }),
  component: ChangeEmail,
});

function ChangeEmail() {
  const { email: emailQ, ticket } = Route.useSearch();
  const navigate = useNavigate();
  const [current, setCurrent] = useState(emailQ);
  const [newEmail, setNewEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState("");

  const requestCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const res = await supabase.auth.requestEmailChangeCode(current);
      if (res.error) {
        toast.error(res.error.message);
        return;
      }
      const address = (res.data?.email || current).trim().toLowerCase();
      try {
        sessionStorage.setItem(PENDING_KEY, JSON.stringify({ email: address, sentAt: Date.now() }));
      } catch { /* ignore */ }
      if (res.data?.code) {
        toast.message("Local test account — no mailbox needed", {
          description: `Email change code: ${res.data.code}`,
          duration: 20000,
          className: "staff-notice-toast",
        });
      }
      if (res.data?.mailFailed) {
        toast.error("Code could not be sent", {
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
      toast.success("Code sent to your current email", {
        description: "Enter the 6-digit code before choosing the new address.",
        duration: 9000,
      });
      void navigate({ to: "/staff/code", search: { email: address, purpose: "change-email" } });
    } finally {
      setBusy(false);
    }
  };

  const sendVerification = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const res = await supabase.auth.beginEmailChange({ email: emailQ, ticket, newEmail });
      if (res.error) {
        toast.error(res.error.message);
        return;
      }
      setSentTo(res.data?.email || newEmail.trim().toLowerCase());
      if (res.data?.mailFailed) {
        toast.error("Verification email could not be sent", {
          description: "Try again in a minute; if it keeps failing, ask admin@kijabe.local to check the mail service.",
          duration: 12000,
          classNames: {
            toast: "!border-rose-300 !bg-rose-700 !text-white !shadow-lg",
            title: "!text-white !font-semibold",
            description: "!text-rose-50",
            icon: "!text-white",
          },
        });
      } else {
        toast.success("Verification sent — open the link in the new inbox", { duration: 9000 });
      }
    } finally {
      setBusy(false);
    }
  };

  if (sentTo) {
    return (
      <StaffOceanScene showSeaSounds={false}>
        <div className="staff-ocean-card text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] opacity-80">AIC Kijabe Hospital</p>
          <h1 className="mt-2 text-2xl font-bold">Check the new inbox</h1>
          <p className="mt-4 opacity-85">
            A verification link went to <b className="break-all">{sentTo}</b>. Your email changes only after that link is
            opened — until then <b className="break-all">{emailQ}</b> keeps working.
          </p>
          <p className="mt-3 rounded-lg bg-black/10 px-3 py-2 text-xs leading-relaxed opacity-90">
            Nothing arrived after a minute? Check Spam / Junk / Promotions, then start again with a fresh code.
          </p>
          <Link to="/staff" className="staff-ocean-link mt-6 inline-block text-sm font-semibold underline">
            Back to sign in
          </Link>
        </div>
      </StaffOceanScene>
    );
  }

  if (ticket) {
    return (
      <StaffOceanScene showSeaSounds={false}>
        <form onSubmit={sendVerification} className="staff-ocean-card">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] opacity-80">AIC Kijabe Hospital</p>
          <h1 className="mt-2 text-3xl font-bold">New email address</h1>
          <p className="mt-2 text-sm opacity-85">
            Code confirmed for <b className="break-all">{emailQ}</b>. Enter the address this account should move to.
          </p>
          <Input
            className="mt-6"
            type="email"
            placeholder="New email"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            required
            autoComplete="email"
          />
          <p className="mt-3 rounded-lg bg-black/10 px-3 py-2 text-xs leading-relaxed opacity-90">
            We send a verification link to the new address. The change only completes when that link is opened.
          </p>
          <Button className="mt-5 w-full" disabled={busy || !newEmail.trim()}>
            {busy ? "Sending…" : "Send verification to new email"}
          </Button>
          <Link
            to="/staff/change-email"
            search={{ email: "", ticket: "" }}
            className="staff-ocean-link mt-4 block text-center text-xs underline"
          >
            Start over
          </Link>
        </form>
      </StaffOceanScene>
    );
  }

  return (
    <StaffOceanScene showSeaSounds={false}>
      <form onSubmit={requestCode} className="staff-ocean-card">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] opacity-80">AIC Kijabe Hospital</p>
        <h1 className="mt-2 text-3xl font-bold">Change email</h1>
        <p className="mt-2 text-sm opacity-85">
          Enter the email on your staff account. We send a 6-digit code, then you choose the new address.
        </p>
        <Input
          className="mt-6"
          type="email"
          placeholder="Current email"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          required
          autoComplete="username"
        />
        <Button className="mt-5 w-full" disabled={busy || !current.trim()}>
          {busy ? "Sending…" : "Send code"}
        </Button>
        <p className="mt-3 rounded-lg bg-black/10 px-3 py-2 text-xs leading-relaxed opacity-90">
          The code goes to the address on the account — that is how we know it is you. It expires in 10 minutes.
        </p>
        <Link to="/staff" className="staff-ocean-link mt-4 block text-center text-sm underline">
          ← Back to sign in
        </Link>
        <Link to="/staff/reset" className="staff-ocean-link mt-2 block text-center text-sm underline">
          Forgot your password?
        </Link>
      </form>
    </StaffOceanScene>
  );
}
