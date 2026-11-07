import { KIJABE } from "@/lib/sky-time";

const LOC_KEY = "kh-weather-loc";
const CACHE_KEY = "kh-weather-cache";
const LAST_KEY = "kh-weather-last";
/** Open-Meteo refreshes current conditions every ~15 min; poll faster so the sky reacts promptly. */
const CACHE_MS = 60 * 1000;
/** Last real observation survives tab changes / short network drops. */
const LAST_MAX_MS = 6 * 60 * 60 * 1000;
/** Re-geocode only after the device actually moves (~550 m) or this much time passes. */
const MOVE_EPS_DEG = 0.005;
const GEOCODE_MS = 6 * 60 * 60 * 1000;

export type WeatherCondition =
  | "clear"
  | "cloudy"
  | "fog"
  | "drizzle"
  | "rain"
  | "heavy"
  | "storm"
  | "snow";

export type WeatherHour = {
  time: string;
  code: number;
  precipProb: number;
  summary: string;
};

export type WeatherSnapshot = {
  lat: number;
  lon: number;
  place: string;
  source: "gps" | "default";
  weatherCode: number;
  condition: WeatherCondition;
  /** 0–1 rain/drizzle density for visuals */
  intensity: number;
  precipMm: number;
  cloudCover: number;
  tempC: number | null;
  summary: string;
  forecast: WeatherHour[];
  updatedAt: number;
  timezone: string;
};

export function weatherSummary(code: number): string {
  if (code === 0) return "Clear";
  if (code === 1) return "Mainly clear";
  if (code === 2) return "Partly cloudy";
  if (code === 3) return "Overcast";
  if (code === 45 || code === 48) return "Fog";
  if (code === 51) return "Light drizzle";
  if (code === 53) return "Moderate drizzle";
  if (code === 55) return "Dense drizzle";
  if (code === 56 || code === 57) return "Freezing drizzle";
  if (code === 61) return "Slight rain";
  if (code === 63) return "Moderate rain";
  if (code === 65) return "Heavy rain";
  if (code === 66 || code === 67) return "Freezing rain";
  if (code >= 71 && code <= 77) return "Snow";
  if (code === 80) return "Slight showers";
  if (code === 81) return "Moderate showers";
  if (code === 82) return "Violent showers";
  if (code >= 95) return "Thunderstorm";
  return "Mixed skies";
}

export function weatherCondition(code: number): WeatherCondition {
  if (code >= 95) return "storm";
  if (code >= 71 && code <= 77) return "snow";
  if (code === 65 || code === 82) return "heavy";
  if (code === 61 || code === 63 || code === 80 || code === 81) return "rain";
  if (code >= 51 && code <= 57) return "drizzle";
  if (code === 45 || code === 48) return "fog";
  if (code >= 2) return "cloudy";
  return "clear";
}

export function rainIntensity(code: number, precipMm: number): number {
  const fromCode =
    code >= 95 ? 0.95
    : code === 82 || code === 65 ? 0.9
    : code === 81 || code === 63 ? 0.65
    : code === 80 || code === 61 ? 0.45
    : code === 55 || code === 57 ? 0.4
    : code === 53 || code === 56 ? 0.28
    : code === 51 ? 0.16
    : 0;
  const fromMm = Math.min(1, precipMm / 4);
  return Math.max(fromCode, fromMm);
}

type StoredLoc = { lat: number; lon: number; place: string; source: "gps" | "default"; t: number };

function readLoc(): StoredLoc | null {
  try {
    const raw = localStorage.getItem(LOC_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as StoredLoc;
  } catch {
    return null;
  }
}

function writeLoc(loc: StoredLoc) {
  try {
    localStorage.setItem(LOC_KEY, JSON.stringify(loc));
  } catch {
    /* ignore */
  }
}

function readCache(): WeatherSnapshot | null {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const snap = JSON.parse(raw) as WeatherSnapshot;
    if (Date.now() - snap.updatedAt > CACHE_MS) return null;
    return snap;
  } catch {
    return null;
  }
}

function writeCache(snap: WeatherSnapshot) {
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(snap));
  } catch {
    /* ignore */
  }
  writeLast(snap);
}

/** Last real observation — shared across tabs and short offline gaps. */
function readLast(): WeatherSnapshot | null {
  try {
    const raw = localStorage.getItem(LAST_KEY);
    if (!raw) return null;
    const snap = JSON.parse(raw) as WeatherSnapshot;
    if (Date.now() - snap.updatedAt > LAST_MAX_MS) return null;
    return snap;
  } catch {
    return null;
  }
}

function writeLast(snap: WeatherSnapshot) {
  try {
    localStorage.setItem(LAST_KEY, JSON.stringify(snap));
  } catch {
    /* ignore */
  }
}

async function reversePlace(lat: number, lon: number): Promise<string> {
  try {
    const url =
      `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`;
    const res = await fetch(url);
    if (!res.ok) return `${lat.toFixed(2)}°, ${lon.toFixed(2)}°`;
    const json = (await res.json()) as {
      city?: string;
      locality?: string;
      principalSubdivision?: string;
      countryName?: string;
    };
    const city = json.city || json.locality;
    const region = json.principalSubdivision;
    const country = json.countryName;
    if (city && country) return `${city}, ${country}`;
    if (region && country) return `${region}, ${country}`;
    if (country) return country;
  } catch {
    /* ignore */
  }
  return `${lat.toFixed(2)}°, ${lon.toFixed(2)}°`;
}

function defaultLoc(): StoredLoc {
  return { lat: KIJABE.lat, lon: KIJABE.lon, place: "Kijabe, Kenya", source: "default", t: Date.now() };
}

const locListeners = new Set<(loc: StoredLoc) => void>();
let watchId: number | null = null;
let lastGeocodeAt = 0;

function notifyLocation(loc: StoredLoc) {
  for (const fn of locListeners) fn(loc);
}

async function handlePosition(pos: GeolocationPosition) {
  const lat = pos.coords.latitude;
  const lon = pos.coords.longitude;
  const prev = readLoc();
  const moved = !prev || Math.abs(prev.lat - lat) > MOVE_EPS_DEG || Math.abs(prev.lon - lon) > MOVE_EPS_DEG;
  const firstGps = prev?.source !== "gps";
  if (!moved && !firstGps) {
    // Same place — keep the fix fresh without re-geocoding or waking listeners.
    if (prev) writeLoc({ ...prev, lat, lon, t: Date.now() });
    return;
  }
  let place: string;
  if (!moved && prev && prev.source === "gps" && Date.now() - lastGeocodeAt < GEOCODE_MS) {
    place = prev.place;
  } else {
    place = await reversePlace(lat, lon);
    lastGeocodeAt = Date.now();
  }
  const loc: StoredLoc = { lat, lon, place, source: "gps", t: Date.now() };
  writeLoc(loc);
  notifyLocation(loc);
}

/**
 * Continuous geolocation tracking for the live sky. Every mounted sky keeps
 * the watch alive; meaningful moves update place + weather. If the browser
 * cannot locate us, the last real fix (or Kijabe default) stays in use.
 */
export function watchDeviceLocation(onChange: (loc: StoredLoc) => void): () => void {
  locListeners.add(onChange);
  const stored = readLoc();
  if (stored) window.setTimeout(() => onChange(stored), 0);
  if (watchId == null && typeof navigator !== "undefined" && navigator.geolocation) {
    try {
      watchId = navigator.geolocation.watchPosition(
        (pos) => { void handlePosition(pos); },
        () => { /* permission denied / no fix — keep last known location */ },
        { enableHighAccuracy: false, timeout: 30000, maximumAge: 60 * 1000 },
      );
    } catch {
      /* geolocation unavailable */
    }
  }
  return () => {
    locListeners.delete(onChange);
    if (locListeners.size === 0 && watchId != null && typeof navigator !== "undefined") {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }
  };
}

/** One-shot location request (used before the first weather fetch). */
export function requestDeviceLocation(): Promise<StoredLoc> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      const fallback = readLoc() ?? defaultLoc();
      writeLoc(fallback);
      resolve(fallback);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        await handlePosition(pos);
        resolve(readLoc() ?? defaultLoc());
      },
      () => resolve(readLoc() ?? defaultLoc()),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 60 * 1000 },
    );
  });
}

export async function fetchWeather(lat: number, lon: number, place: string, source: "gps" | "default"): Promise<WeatherSnapshot> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,precipitation,rain,showers,weather_code,cloud_cover` +
    `&hourly=temperature_2m,precipitation_probability,weather_code,precipitation,cloud_cover` +
    `&forecast_hours=18&timezone=auto`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error("Weather request failed");
  const json = (await res.json()) as {
    timezone?: string;
    utc_offset_seconds?: number;
    current?: {
      time?: string;
      temperature_2m?: number;
      precipitation?: number;
      rain?: number;
      showers?: number;
      weather_code?: number;
      cloud_cover?: number;
    };
    hourly?: {
      time?: string[];
      temperature_2m?: number[];
      precipitation_probability?: number[];
      weather_code?: number[];
      precipitation?: number[];
      cloud_cover?: number[];
    };
  };

  const cur = json.current ?? {};
  const times = json.hourly?.time ?? [];
  const probs = json.hourly?.precipitation_probability ?? [];
  const codes = json.hourly?.weather_code ?? [];
  const hourlyPrecip = json.hourly?.precipitation ?? [];
  const hourlyCloud = json.hourly?.cloud_cover ?? [];

  // Fraction through the current hour (current.time is the 15-min step).
  const minuteMatch = /T\d{2}:(\d{2})/.exec(cur.time ?? "");
  const hourFrac = minuteMatch ? Number(minuteMatch[1]) / 60 : 0.5;
  const lerp = (a: number | undefined, b: number | undefined) =>
    a == null ? (b ?? 0) : b == null ? a : a + (b - a) * hourFrac;

  const code = Number(cur.weather_code ?? codes[0] ?? 0);
  const precipMm = Number(cur.precipitation ?? cur.rain ?? cur.showers ?? lerp(hourlyPrecip[0], hourlyPrecip[1]));
  const cloudCover = Number(cur.cloud_cover ?? lerp(hourlyCloud[0], hourlyCloud[1]));
  // WMO code 0 can still arrive with a solid cloud deck — trust the sky cover.
  let condition = weatherCondition(code);
  let summary = weatherSummary(code);
  if (code <= 1 && cloudCover >= 50) {
    condition = "cloudy";
    summary = cloudCover >= 85 ? "Overcast" : "Partly cloudy";
  }

  // Next hours from the forecast, starting after the current hour.
  const forecast: WeatherHour[] = [];
  for (let i = 1; i < Math.min(9, times.length); i++) {
    const c = Number(codes[i] ?? 0);
    forecast.push({
      time: times[i]!,
      code: c,
      precipProb: Number(probs[i] ?? 0),
      summary: weatherSummary(c),
    });
  }

  const snap: WeatherSnapshot = {
    lat,
    lon,
    place,
    source,
    weatherCode: code,
    condition,
    intensity: rainIntensity(code, precipMm),
    precipMm,
    cloudCover,
    tempC: cur.temperature_2m == null ? null : Number(cur.temperature_2m),
    summary,
    forecast,
    updatedAt: Date.now(),
    timezone: json.timezone || "auto",
  };
  writeCache(snap);
  return snap;
}

let inflight: Promise<WeatherSnapshot> | null = null;

export function loadLocalWeather(force = false): Promise<WeatherSnapshot> {
  if (!force) {
    const cached = readCache();
    if (cached) return Promise.resolve(cached);
  }
  if (inflight) return inflight;
  const loc = readLoc() ?? defaultLoc();
  inflight = (async () => {
    try {
      return await fetchWeather(loc.lat, loc.lon, loc.place, loc.source);
    } catch (err) {
      // Never pretend it is clear: keep the last real observation instead.
      const last = readLast();
      if (last) return last;
      throw err;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** Synchronous first paint — fresh cache, else the last real observation. */
export function peekWeather(): WeatherSnapshot | null {
  return readCache() ?? readLast();
}

export function isWet(condition: WeatherCondition) {
  return condition === "drizzle" || condition === "rain" || condition === "heavy" || condition === "storm";
}
