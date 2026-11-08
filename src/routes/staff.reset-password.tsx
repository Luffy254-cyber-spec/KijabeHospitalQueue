import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StaffOceanScene } from "@/components/staff-ocean-scene";

export const Route = createFileRoute("/staff/reset-password")({
  head: () => ({ meta: [{ title: "Choose a new password — Kijabe Care Flow" }] }),
  validateSearch: (search: Record<string, unknown>) => ({
    email: typeof search.email === "string" ? search.email.trim().toLowerCase() : "",
    ticket: typeof search.ticket === "string" ? search.ticket : "",
  }),
  component: ResetPassword,
});

function ResetPassword() {
  const { email, ticket } = Route.useSearch();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (password.length < 8) {
      toast.error("Password must be at least 8 characters");
      return;
    }
    if (password !== confirm) {
      toast.error("The two passwords do not match");
      return;
    }
    setBusy(true);
    try {
      const res = await supabase.auth.completePasswordReset({ email, ticket, password });
      if (res.error) {
        toast.error(res.error.message);
        return;
      }
      setDone(true);
      toast.success("Password changed — sign in with the new password", { duration: 9000 });
      window.setTimeout(() => navigate({ to: "/staff" }), 900);
    } finally {
      setBusy(false);
    }
  };

  if (!email || !ticket) {
    return (
      <StaffOceanScene showSeaSounds={false}>
        <div className="staff-ocean-card text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] opacity-80">AIC Kijabe Hospital</p>
          <h1 className="mt-2 text-2xl font-bold">Reset link missing</h1>
          <p className="mt-4 opacity-85">Start again and enter the 6-digit code from your email.</p>
          <Link to="/staff/reset" className="staff-ocean-link mt-6 inline-block text-sm underline">
            Request a reset code
          </Link>
        </div>
      </StaffOceanScene>
    );
  }

  return (
    <StaffOceanScene showSeaSounds={false}>
      <form onSubmit={submit} className="staff-ocean-card">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] opacity-80">AIC Kijabe Hospital</p>
        <h1 className="mt-2 text-3xl font-bold">{done ? "Password changed" : "New password"}</h1>
        <p className="mt-2 text-sm opacity-85">
          {done ? "Opening the sign-in page…" : <>Changing the password for <b className="break-all">{email}</b>.</>}
        </p>

        {!done && (
          <>
            <div className="relative mt-6">
              <Input
                type={show ? "text" : "password"}
                placeholder="New password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
                className="pr-11"
              />
              <button
                type="button"
                onClick={() => setShow((v) => !v)}
                className="absolute inset-y-0 right-0 flex items-center px-3 opacity-70 hover:opacity-100"
                aria-label={show ? "Hide password" : "Show password"}
              >
                {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <Input
              className="mt-3"
              type={show ? "text" : "password"}
              placeholder="Repeat new password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
            />
            <p className="mt-3 rounded-lg bg-black/10 px-3 py-2 text-xs leading-relaxed opacity-90">
              At least 8 characters. This replaces the old password everywhere, including fingerprint sign-in.
            </p>
            <Button className="mt-5 w-full" disabled={busy || password.length < 8 || confirm.length < 8}>
              {busy ? "Saving…" : "Save new password"}
            </Button>
            <Link to="/staff/reset" className="staff-ocean-link mt-4 block text-center text-xs underline">
              Code expired? Request a new one
            </Link>
          </>
        )}
      </form>
    </StaffOceanScene>
  );
}
