import { useEffect } from "react";

/**
 * A free Render instance sleeps after 15 idle minutes. A waiting-room screen is
 * open all day, so it pings its own origin every 10 minutes: the instance never
 * idles out and the queue API is already warm when the next patient scans a
 * ticket. The same wake-up call brings the shared player back to life after the
 * screen or the host has been suspended.
 */

const INTERVAL_MS = 10 * 60 * 1000;
const PING_PATH = "/api/public/app-origin";

export function useServerHeartbeat() {
  useEffect(() => {
    if (typeof window === "undefined") return;

    let last = Date.now();

    const ping = (force = false) => {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (!force && now - last < 5 * 60 * 1000) return;
      if (force && now - last < 60 * 1000) return;
      last = now;
      void fetch(PING_PATH, { cache: "no-store" }).catch(() => {
        /* offline: the interval retries */
      });
    };

    const timer = window.setInterval(ping, INTERVAL_MS);
    const wake = () => ping(true);
    window.addEventListener("online", wake);
    window.addEventListener("pageshow", wake);
    document.addEventListener("visibilitychange", wake);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener("online", wake);
      window.removeEventListener("pageshow", wake);
      document.removeEventListener("visibilitychange", wake);
    };
  }, []);
}
