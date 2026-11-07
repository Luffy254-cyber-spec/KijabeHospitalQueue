import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

const IDLE_MS = 5 * 60 * 1000; // 5 minutes
const EVENTS: (keyof WindowEventMap)[] = [
  "mousemove",
  "mousedown",
  "keydown",
  "touchstart",
  "scroll",
  "click",
  "wheel",
];

/**
 * Signs out staff / superadmin after `timeoutMs` of no interaction.
 * Prevents unattended desks from staying logged in.
 */
export function useIdleLogout(enabled: boolean, timeoutMs = IDLE_MS) {
  const timerRef = useRef<number | null>(null);
  const loggingOutRef = useRef(false);

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;

    const clear = () => {
      if (timerRef.current != null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };

    const logout = async () => {
      if (loggingOutRef.current) return;
      loggingOutRef.current = true;
      clear();
      try {
        await supabase.rpc("staff_check_out").catch(() => null);
      } catch {
        /* ignore */
      }
      await supabase.auth.signOut();
      toast.message("Signed out for security", {
        description: "You were idle for 5 minutes. Sign in again to continue.",
        duration: 8000,
      });
      // Soft reload to Login / clear console state
      if (window.location.pathname.startsWith("/admin")) {
        window.location.assign("/staff");
      } else {
        window.location.reload();
      }
    };

    const bump = () => {
      if (loggingOutRef.current) return;
      clear();
      timerRef.current = window.setTimeout(() => {
        void logout();
      }, timeoutMs);
    };

    bump();
    for (const ev of EVENTS) {
      window.addEventListener(ev, bump, { passive: true });
    }
    document.addEventListener("visibilitychange", bump);

    return () => {
      clear();
      for (const ev of EVENTS) {
        window.removeEventListener(ev, bump);
      }
      document.removeEventListener("visibilitychange", bump);
    };
  }, [enabled, timeoutMs]);
}
