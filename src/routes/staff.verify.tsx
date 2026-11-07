import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { applyActionCode, checkActionCode } from "firebase/auth";
import { toast } from "sonner";
import { firebaseAuth } from "@/lib/firebase";
import { supabase } from "@/integrations/supabase/client";
import { StaffOceanScene } from "@/components/staff-ocean-scene";

export const Route = createFileRoute("/staff/verify")({
  head: () => ({ meta: [{ title: "Confirm email — Kijabe Queue" }] }),
  component: VerifyEmail,
  validateSearch: (search: Record<string, unknown>) => ({
    oobCode: typeof search.oobCode === "string" ? search.oobCode : "",
    mode: typeof search.mode === "string" ? search.mode : "",
    pending: typeof search.pending === "string" ? search.pending : "",
    email: typeof search.email === "string" ? search.email : "",
    signup: typeof search.signup === "string" ? search.signup : "",
  }),
});

function welcomeName(email: string) {
  const local = email.split("@")[0] || "staff";
  return local.replace(/[._-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function VerifyEmail() {
  const { oobCode, mode, pending, email: emailQ, signup } = Route.useSearch();
  const navigate = useNavigate();
  const [message, setMessage] = useState("Confirming…");

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        // Login link (every sign-in verification)
        if (mode === "login" && pending && emailQ) {
          if (oobCode) {
            try { await applyActionCode(firebaseAuth, oobCode); } catch { /* already used is ok */ }
          }
          const res = await fetch("/api/local/auth", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "complete-login-link", email: emailQ, pending }),
          });
          const json = await res.json();
          if (!res.ok) throw new Error(json.error || "Login link failed");
          await supabase.auth.acceptSession(json.session);
          if (cancel) return;
          toast.success(`Welcome back, ${welcomeName(emailQ)}!`);
          setMessage("Signed in — opening your desk…");
          setTimeout(() => navigate({ to: "/staff" }), 600);
          return;
        }

        if (!oobCode) {
          setMessage("Open the confirmation link from your email.");
          return;
        }

        const info = await checkActionCode(firebaseAuth, oobCode);
        const email = info.data.email || emailQ || "";
        await applyActionCode(firebaseAuth, oobCode);

        // Signup confirmation → mark confirmed + auto session
        const res = await fetch("/api/local/auth", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "confirm-email", email, signup: signup || undefined }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Could not confirm email");

        if (json.awaitingApproval) {
          if (cancel) return;
          toast.message("Email confirmed — awaiting superadmin approval", {
            description: "admin@kijabe.local must approve your staff account before you can sign in.",
            duration: 10000,
          });
          setMessage("Email confirmed. A superadmin must approve your account before you can sign in.");
          return;
        }

        if (json.session?.access_token) {
          await supabase.auth.acceptSession(json.session);
          if (cancel) return;
          toast.success(`Welcome, ${welcomeName(email)}! Your email is confirmed.`);
          setMessage("Email confirmed — signing you in…");
          setTimeout(() => navigate({ to: "/staff" }), 700);
          return;
        }

        if (cancel) return;
        setMessage("Email confirmed. You can sign in.");
        setTimeout(() => navigate({ to: "/staff" }), 1200);
      } catch (e) {
        if (!cancel) setMessage(e instanceof Error ? e.message : "This confirmation link is invalid or already used.");
      }
    })();
    return () => { cancel = true; };
  }, [oobCode, mode, pending, emailQ, signup, navigate]);

  return (
    <StaffOceanScene>
      <div className="staff-ocean-card text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] opacity-80">AIC Kijabe Hospital</p>
        <h1 className="mt-2 text-2xl font-bold">Email confirmation</h1>
        <p className="mt-4 opacity-85">{message}</p>
        <p className="mt-3 text-xs opacity-75">
          Link not working? Sign in on the staff page and use the 6-digit code. Missing email? Check Spam / Junk / Promotions.
        </p>
        <Link to="/staff" className="mt-6 inline-block text-sm font-semibold underline">Go to sign in</Link>
      </div>
    </StaffOceanScene>
  );
}
