import { useEffect, useState } from "react";
import {
  Sun,
  CloudSun,
  Cloud,
  CloudRain,
  CloudDrizzle,
  CloudLightning,
  CloudFog,
  Snowflake,
  Clock,
  Thermometer,
} from "lucide-react";
import { useLocalWeather } from "@/hooks/use-local-weather";
import type { WeatherCondition } from "@/lib/weather";

type Props = {
  className?: string;
  variant?: "default" | "on-primary" | "compact";
  showDate?: boolean;
};

function getWeatherIcon(condition: WeatherCondition, className = "h-4 w-4") {
  switch (condition) {
    case "clear":
      return <Sun className={`${className} text-amber-500`} />;
    case "cloudy":
      return <CloudSun className={`${className} text-sky-500`} />;
    case "drizzle":
      return <CloudDrizzle className={`${className} text-blue-400`} />;
    case "rain":
    case "heavy":
      return <CloudRain className={`${className} text-blue-500`} />;
    case "storm":
      return <CloudLightning className={`${className} text-purple-500`} />;
    case "fog":
      return <CloudFog className={`${className} text-slate-400`} />;
    case "snow":
      return <Snowflake className={`${className} text-cyan-400`} />;
    default:
      return <Cloud className={`${className} text-slate-400`} />;
  }
}

export function LiveWeatherClock({
  className = "",
  variant = "default",
  showDate = false,
}: Props) {
  const [now, setNow] = useState(() => new Date());
  const { weather } = useLocalWeather();

  // Tick clock every second for live real-time sync
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Format time in Kenya / East Africa Time (EAT, UTC+3) or local
  const timeStr = now.toLocaleTimeString("en-KE", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "Africa/Nairobi",
  });

  const dateStr = now.toLocaleDateString("en-KE", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "Africa/Nairobi",
  });

  // Real-life forecast values
  const tempC = weather?.tempC != null ? `${Math.round(weather.tempC)}°C` : "21°C";
  const summary = weather?.summary || "Partly cloudy";
  const condition = weather?.condition || "cloudy";
  const place = weather?.place?.split(",")[0] || "Kijabe";

  if (variant === "on-primary") {
    // Specifically tailored for Kiosk's dark primary header
    return (
      <div
        className={`inline-flex items-center gap-3 rounded-2xl bg-white/10 px-4 py-2 text-xs text-white backdrop-blur-xs sm:text-sm ${className}`}
        title={`Live observation: ${place} · ${tempC} · ${summary} · EAT (UTC+3)`}
      >
        <div className="flex items-center gap-1.5 font-medium">
          <Clock className="h-3.5 w-3.5 opacity-80" />
          <span className="font-mono tracking-tight">{timeStr}</span>
          <span className="text-[10px] uppercase tracking-wider opacity-75 font-semibold">EAT</span>
        </div>

        <span className="h-3.5 w-px bg-white/20" aria-hidden />

        <div className="flex items-center gap-1.5">
          {getWeatherIcon(condition, "h-4 w-4")}
          <span className="font-bold">{tempC}</span>
          <span className="opacity-90">{summary}</span>
        </div>
      </div>
    );
  }

  if (variant === "compact") {
    return (
      <div
        className={`inline-flex items-center gap-2 rounded-xl border border-border/80 bg-card px-2.5 py-1.5 text-xs shadow-xs ${className}`}
        title={`Live clock & forecast: ${place} · ${tempC} · ${summary}`}
      >
        <span className="font-mono font-semibold text-foreground">{timeStr}</span>
        <span className="text-muted-foreground">·</span>
        <div className="flex items-center gap-1 text-muted-foreground font-medium">
          {getWeatherIcon(condition, "h-3.5 w-3.5")}
          <span>{tempC}</span>
          <span className="hidden sm:inline">{summary}</span>
        </div>
      </div>
    );
  }

  // Default clean badge for Staff and Superadmin dashboards (no background visual, just live forecast text)
  return (
    <div
      className={`inline-flex flex-wrap items-center gap-2.5 rounded-xl border border-border bg-card/90 px-3.5 py-2 text-xs shadow-xs sm:text-sm ${className}`}
      title={`Live observation: ${place} · ${tempC} · ${summary} (EAT / UTC+3)`}
    >
      <div className="flex items-center gap-1.5 font-semibold text-foreground">
        <Clock className="h-3.5 w-3.5 text-primary" />
        <span className="font-mono tracking-tight">{timeStr}</span>
        <span className="rounded bg-primary/10 px-1 py-0.2 text-[10px] font-bold text-primary">
          EAT
        </span>
        {showDate && <span className="text-muted-foreground font-normal">· {dateStr}</span>}
      </div>

      <span className="hidden h-3.5 w-px bg-border sm:inline-block" aria-hidden />

      <div className="flex items-center gap-1.5 text-foreground font-medium">
        <span className="flex items-center">{getWeatherIcon(condition, "h-4 w-4")}</span>
        <span className="font-bold text-primary flex items-center gap-0.5">
          <Thermometer className="h-3 w-3 text-muted-foreground" />
          {tempC}
        </span>
        <span className="text-muted-foreground">·</span>
        <span className="text-muted-foreground">{summary}</span>
      </div>
    </div>
  );
}
