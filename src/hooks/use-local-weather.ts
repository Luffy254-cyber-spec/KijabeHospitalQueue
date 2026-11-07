import { useEffect, useState } from "react";
import { loadLocalWeather, peekWeather, watchDeviceLocation, type WeatherSnapshot } from "@/lib/weather";
import { KIJABE } from "@/lib/sky-time";

/** Open-Meteo updates current conditions every ~15 min — poll each minute. */
const REFRESH_MS = 60 * 1000;

export function useLocalWeather() {
  const [weather, setWeather] = useState<WeatherSnapshot | null>(() => peekWeather());
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    let busy = false;
    const run = async (force = false) => {
      if (busy) return;
      busy = true;
      try {
        const snap = await loadLocalWeather(force);
        if (alive) setWeather(snap);
      } catch {
        if (alive && !peekWeather()) {
          setWeather({
            lat: KIJABE.lat,
            lon: KIJABE.lon,
            place: "Kijabe, Kenya",
            source: "default",
            weatherCode: 3,
            condition: "cloudy",
            intensity: 0,
            precipMm: 0,
            cloudCover: 65,
            tempC: null,
            summary: "Weather offline",
            forecast: [],
            updatedAt: Date.now(),
            timezone: "Africa/Nairobi",
          });
        }
      } finally {
        busy = false;
        if (alive) setReady(true);
      }
    };
    void run();
    // Real device tracking: a meaningful move re-fetches for the new place.
    const stopLocation = watchDeviceLocation(() => void run(true));
    const id = window.setInterval(() => {
      if (!document.hidden) void run();
    }, REFRESH_MS);
    // TV / OTP tabs wake up showing stale sky — refresh the moment they are visible again.
    const onVisible = () => {
      if (!document.hidden) void run();
    };
    const onOnline = () => void run();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);
    return () => {
      alive = false;
      stopLocation();
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
    };
  }, []);

  return { weather, ready };
}
