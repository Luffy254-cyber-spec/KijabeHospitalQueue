import { useEffect, useState } from "react";
import { lunarPositionKenya, moonLabel, moonPhaseFraction } from "@/lib/sky-time";

/** Live moon phase badge — updates every minute from real ephemeris. */
export function MoonPhaseLive({ className = "" }: { className?: string }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);
  const phase = moonPhaseFraction(now);
  const lunar = lunarPositionKenya(now);
  const lit = lunar.lit;
  const label = moonLabel(phase);
  const aboveHorizon = lunar.up;
  // Shadow moves away from the lit limb: new = fully covered, full = clear.
  const shadowX =
    (phase <= 0.5 ? -1 : 1) * (lit <= 0.5 ? lit * 40 : 20 + (lit - 0.5) * 49.6);

  return (
    <div className={`inline-flex items-center gap-3 rounded-xl border bg-card/80 px-3 py-2 text-sm shadow-sm ${className}`}>
      <div
        className="relative h-10 w-10 shrink-0 overflow-hidden rounded-full bg-[#f2f0e4] shadow-[0_0_12px_rgba(230,235,255,0.45)]"
        style={{ opacity: aboveHorizon ? 1 : 0.55 }}
        title={`${label} · ${Math.round(lit * 100)}% lit · ${aboveHorizon ? "above" : "below"} horizon`}
        aria-hidden
      >
        <span
          className="absolute inset-[-12%] rounded-full bg-[#0a1628]"
          style={{ transform: `translateX(${shadowX}px)`, opacity: 0.9 }}
        />
      </div>
      <div className="min-w-0 leading-tight">
        <p className="font-semibold">{label}</p>
        <p className="text-xs text-muted-foreground">
          {aboveHorizon ? "Above horizon" : "Below horizon"} · {Math.round(lit * 100)}% illuminated · alt{" "}
          {lunar.altitudeDeg.toFixed(0)}°
        </p>
      </div>
    </div>
  );
}
