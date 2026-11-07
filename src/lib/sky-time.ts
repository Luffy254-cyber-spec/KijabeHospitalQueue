/**
 * Real-time Kenya sky (AIC Kijabe / Nairobi).
 * Solar position uses standard astronomical formulas for lat/lon.
 * Eclipses are filtered to what is actually visible from Kenya right now.
 */

export type DayPhase =
  | "night"
  | "sunrise"
  | "morning"
  | "noon"
  | "afternoon"
  | "evening"
  | "sunset";

/** AIC Kijabe Hospital approx. */
export const KIJABE = { lat: -0.944, lon: 36.594, tz: "Africa/Nairobi" } as const;

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

export function nairobiParts(now = new Date(), timeZone: string = KIJABE.tz) {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: timeZone && timeZone !== "auto" ? timeZone : KIJABE.tz,
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
  });
  const map: Record<string, string> = {};
  for (const p of fmt.formatToParts(now)) {
    if (p.type !== "literal") map[p.type] = p.value;
  }
  const hour = Number(map["hour"]);
  const minute = Number(map["minute"]);
  const second = Number(map["second"]);
  const dayFrac = (hour + minute / 60 + second / 3600) / 24;
  return {
    hour,
    minute,
    second,
    dayFrac,
    year: Number(map["year"]),
    month: Number(map["month"]),
    day: Number(map["day"]),
  };
}

function julianDate(now: Date) {
  return now.getTime() / 86400000 + 2440587.5;
}

function wrap360(x: number) {
  const v = x % 360;
  return v < 0 ? v + 360 : v;
}

export type SolarPosition = {
  altitudeDeg: number;
  azimuthDeg: number;
  /** 0..1 screen height factor from altitude (0 = horizon, 1 = zenith) */
  height: number;
  /** 0..100 left % across sky from east→west path */
  leftPct: number;
  rising: boolean;
};

/** Sun right ascension / declination (radians) from standard low-precision ephemeris. */
function sunEquatorial(now: Date) {
  const jd = julianDate(now);
  const n = jd - 2451545.0;
  const L = wrap360(280.46 + 0.9856474 * n);
  const g = (357.528 + 0.9856003 * n) * DEG;
  const lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * DEG;
  const epsilon = (23.439 - 0.0000004 * n) * DEG;
  return {
    ra: Math.atan2(Math.cos(epsilon) * Math.sin(lambda), Math.cos(lambda)),
    dec: Math.asin(Math.sin(epsilon) * Math.sin(lambda)),
  };
}

/** True solar altitude / azimuth at Kijabe right now. */
export function solarPositionKenya(now = new Date(), lat: number = KIJABE.lat, lon: number = KIJABE.lon): SolarPosition {
  const jd = julianDate(now);
  const { ra: alpha, dec: delta } = sunEquatorial(now);

  // Greenwich mean sidereal time (degrees)
  const gmst = wrap360(280.46061837 + 360.98564736629 * (jd - 2451545.0));
  const lst = wrap360(gmst + lon);
  const ha = (lst * DEG - alpha);

  const phi = lat * DEG;
  const sinAlt =
    Math.sin(phi) * Math.sin(delta) + Math.cos(phi) * Math.cos(delta) * Math.cos(ha);
  const altitudeDeg = Math.asin(Math.max(-1, Math.min(1, sinAlt))) * RAD;

  const y = -Math.sin(ha);
  const x = Math.tan(delta) * Math.cos(phi) - Math.sin(phi) * Math.cos(ha);
  let azimuthDeg = Math.atan2(y, x) * RAD; // 0 = north, 90 = east
  azimuthDeg = wrap360(azimuthDeg);

  // Screen arc: east (90°) left → south (180°) center → west (270°) right
  const path = (azimuthDeg - 90) / 180;
  const leftPct = Math.max(4, Math.min(96, path * 100));
  const height = Math.max(0, Math.min(1, altitudeDeg / 88));
  // Hour angle: morning when HA is west of meridian (sin(ha) < 0 in this convention)
  const isRising = Math.sin(ha) < 0;

  return {
    altitudeDeg,
    azimuthDeg,
    height,
    leftPct,
    rising: isRising,
  };
}

export type LunarPosition = {
  altitudeDeg: number;
  azimuthDeg: number;
  height: number;
  leftPct: number;
  /** Illuminated fraction 0..1 from the actual Sun–Moon elongation */
  lit: number;
  distanceKm: number;
  /** True when the Moon is above the local horizon */
  up: boolean;
};

export type LunarGeo = {
  raDeg: number;
  decDeg: number;
  distanceKm: number;
  lonEclDeg: number;
  latEclDeg: number;
};

/**
 * Geocentric lunar ephemeris (Schlyter low-precision series with the main
 * perturbation terms). Accuracy ≈ 0.01°–0.05°, enough to resolve local
 * eclipse geometry.
 */
function lunarEquatorial(now: Date): LunarGeo {
  const jd = julianDate(now);
  const d = jd - 2451543.5;

  // Orbital elements (degrees / Earth radii)
  const N = 125.1228 - 0.0529538083 * d;
  const inc = 5.1454;
  const w = 318.0634 + 0.1643573223 * d;
  const a = 60.2666;
  const e = 0.0549;
  const M = 115.3654 + 13.0649929509 * d;

  // Kepler's equation
  let E = M + RAD * e * Math.sin(M * DEG) * (1 + e * Math.cos(M * DEG));
  for (let k = 0; k < 5; k++) {
    E = E - (E - RAD * e * Math.sin(E * DEG) - M) / (1 - e * Math.cos(E * DEG));
  }
  const xv = a * (Math.cos(E * DEG) - e);
  const yv = a * Math.sqrt(1 - e * e) * Math.sin(E * DEG);
  const v = Math.atan2(yv, xv) * RAD;
  const r0 = Math.sqrt(xv * xv + yv * yv);

  // Ecliptic rectangular coordinates
  const xh = r0 * (Math.cos(N * DEG) * Math.cos((v + w) * DEG) - Math.sin(N * DEG) * Math.sin((v + w) * DEG) * Math.cos(inc * DEG));
  const yh = r0 * (Math.sin(N * DEG) * Math.cos((v + w) * DEG) + Math.cos(N * DEG) * Math.sin((v + w) * DEG) * Math.cos(inc * DEG));
  const zh = r0 * Math.sin((v + w) * DEG) * Math.sin(inc * DEG);
  let lonEcl = Math.atan2(yh, xh) * RAD;
  let latEcl = Math.atan2(zh, Math.hypot(xh, yh)) * RAD;

  // Main perturbations from the Sun
  const s = (x: number) => Math.sin(x * DEG);
  const c = (x: number) => Math.cos(x * DEG);
  const Ls = 280.46 + 0.9856474 * d;
  const Ms = 357.528 + 0.9856003 * d;
  const Lm = N + w + M;
  const D = Lm - Ls;
  const F = Lm - N;
  lonEcl +=
    -1.274 * s(M - 2 * D) + 0.658 * s(2 * D) - 0.186 * s(Ms) -
    0.059 * s(2 * M - 2 * D) - 0.057 * s(M - 2 * D + Ms) + 0.053 * s(M + 2 * D) +
    0.046 * s(2 * D - Ms) + 0.041 * s(M - Ms) - 0.035 * s(D) -
    0.031 * s(M + Ms) - 0.015 * s(2 * F - 2 * D) + 0.011 * s(M - 4 * D);
  latEcl +=
    -0.173 * s(F - 2 * D) - 0.055 * s(M - F - 2 * D) - 0.046 * s(M + F - 2 * D) +
    0.033 * s(F + 2 * D) + 0.017 * s(2 * M + F);
  const distanceEr = r0 - 0.58 * c(M - 2 * D) - 0.46 * c(2 * D);
  const distanceKm = distanceEr * 6378.14;

  // Ecliptic → equatorial
  const epsilon = (23.4393 - 0.0000003563 * d) * DEG;
  const xe = Math.cos(latEcl * DEG) * Math.cos(lonEcl * DEG);
  const ye = Math.cos(latEcl * DEG) * Math.sin(lonEcl * DEG);
  const ze = Math.sin(latEcl * DEG);
  const yq = ye * Math.cos(epsilon) - ze * Math.sin(epsilon);
  const zq = ye * Math.sin(epsilon) + ze * Math.cos(epsilon);
  const raDeg = Math.atan2(yq, xe) * RAD;
  const decDeg = Math.atan2(zq, Math.hypot(xe, yq)) * RAD;

  return { raDeg, decDeg, distanceKm, lonEclDeg: lonEcl, latEclDeg: latEcl };
}

/**
 * Geocentric lunar ephemeris converted to the local topocentric
 * altitude/azimuth used by the sky scene.
 */
export function lunarPositionKenya(now = new Date(), lat: number = KIJABE.lat, lon: number = KIJABE.lon): LunarPosition {
  const jd = julianDate(now);
  const { raDeg, decDeg, distanceKm } = lunarEquatorial(now);

  // Local hour angle
  const gmst = wrap360(280.46061837 + 360.98564736629 * (jd - 2451545.0));
  const lst = wrap360(gmst + lon);
  let haDeg = wrap360(lst - raDeg);
  if (haDeg > 180) haDeg -= 360;
  const ha = haDeg * DEG;
  const phi = lat * DEG;
  const dec = decDeg * DEG;

  const sinAlt = Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(ha);
  const altGeo = Math.asin(Math.max(-1, Math.min(1, sinAlt)));
  // Topocentric correction: horizontal parallax (Moon is close enough to matter)
  const parallax = Math.asin(Math.max(-1, Math.min(1, 6378.14 / distanceKm)));
  const altitudeDeg = (altGeo - parallax * Math.cos(altGeo)) * RAD;
  const azimuthDeg = wrap360(
    Math.atan2(-Math.sin(ha), Math.tan(dec) * Math.cos(phi) - Math.sin(phi) * Math.cos(ha)) * RAD,
  );

  // Illuminated fraction from Sun–Moon elongation
  const sun = sunEquatorial(now);
  const su = [
    Math.cos(sun.dec) * Math.cos(sun.ra),
    Math.cos(sun.dec) * Math.sin(sun.ra),
    Math.sin(sun.dec),
  ];
  const mu = [Math.cos(dec) * Math.cos(raDeg * DEG), Math.cos(dec) * Math.sin(raDeg * DEG), Math.sin(dec)];
  const cosElong = Math.max(-1, Math.min(1, su[0]! * mu[0]! + su[1]! * mu[1]! + su[2]! * mu[2]!));
  const lit = 0.5 * (1 - Math.cos(Math.acos(cosElong)));

  return {
    altitudeDeg,
    azimuthDeg,
    height: Math.max(0, Math.min(1, altitudeDeg / 88)),
    leftPct: Math.max(4, Math.min(96, ((azimuthDeg - 90) / 180) * 100)),
    lit,
    distanceKm,
    up: altitudeDeg > 0,
  };
}

/** Day phase from real solar altitude + rising/setting (Kenya seasons). */
export function dayPhaseFromSun(sun: SolarPosition): DayPhase {
  const a = sun.altitudeDeg;
  if (a < -4) return "night";
  if (a < 0) return sun.rising ? "sunrise" : "sunset";
  if (a < 12) return sun.rising ? "sunrise" : "sunset";
  if (a < 35) return sun.rising ? "morning" : "evening";
  if (a < 55) return sun.rising ? "morning" : "afternoon";
  if (a < 72) return sun.azimuthDeg < 200 ? "noon" : "afternoon";
  return "noon";
}

/** @deprecated prefer dayPhaseFromSun — kept for callers using clock hours */
export function dayPhase(hour: number, minute: number): DayPhase {
  const t = hour + minute / 60;
  if (t >= 5 && t < 6.5) return "sunrise";
  if (t >= 6.5 && t < 10.5) return "morning";
  if (t >= 10.5 && t < 13.5) return "noon";
  if (t >= 13.5 && t < 16) return "afternoon";
  if (t >= 16 && t < 17.75) return "evening";
  if (t >= 17.75 && t < 19.25) return "sunset";
  return "night";
}

export function sunHeight(dayFrac: number) {
  const x = (dayFrac - 5.5 / 24) / ((19 - 5.5) / 24);
  if (x <= 0 || x >= 1) return 0;
  return Math.sin(Math.PI * x);
}

export function sunAzimuth(dayFrac: number) {
  return 8 + dayFrac * 84;
}

/** Synodic month phase 0=new … 0.5=full … 1=new */
export function moonPhaseFraction(now = new Date()) {
  const synodic = 29.530588853;
  const ref = Date.UTC(2000, 0, 6, 18, 14, 0);
  const days = (now.getTime() - ref) / 86400000;
  return (((days % synodic) + synodic) % synodic) / synodic;
}

export function moonIllumination(phase: number) {
  return 0.5 * (1 - Math.cos(2 * Math.PI * phase));
}

export function moonLabel(phase: number) {
  if (phase < 0.03 || phase > 0.97) return "New moon";
  if (phase < 0.22) return "Waxing crescent";
  if (phase < 0.28) return "First quarter";
  if (phase < 0.47) return "Waxing gibbous";
  if (phase < 0.53) return "Full moon";
  if (phase < 0.72) return "Waning gibbous";
  if (phase < 0.78) return "Last quarter";
  return "Waning crescent";
}

/**
 * Real Moon altitude / azimuth / illumination for the local sky.
 * The old “opposite the Sun” approximation is gone: this comes from the
 * lunar ephemeris above, so the Moon only appears when it is actually up.
 */
export function moonSky(
  now = new Date(),
  _sun = solarPositionKenya(now),
  phase = moonPhaseFraction(now),
  lat: number = KIJABE.lat,
  lon: number = KIJABE.lon,
) {
  const moon = lunarPositionKenya(now, lat, lon);
  return {
    height: moon.height,
    leftPct: moon.leftPct,
    lit: moon.lit,
    phase,
    altitudeProxy: moon.altitudeDeg,
    altitudeDeg: moon.altitudeDeg,
    azimuthDeg: moon.azimuthDeg,
    distanceKm: moon.distanceKm,
    up: moon.up,
  };
}

export function moonHeight(dayFrac: number, phase: number) {
  const night = dayFrac < 0.25 || dayFrac > 0.75 ? 1 : dayFrac > 0.4 && dayFrac < 0.6 ? 0.15 : 0.45;
  return Math.min(1, night * (0.35 + moonIllumination(phase) * 0.65));
}

export type SkyPalette = {
  top: string;
  mid: string;
  horizon: string;
  water: string;
  waterDeep: string;
  sun: string;
  glow: string;
  starOpacity: number;
  cloudOpacity: number;
};

export function skyPalette(phase: DayPhase, sunH: number): SkyPalette {
  // Blend brightness with live solar height for smooth minute-to-minute change
  const blaze = Math.max(0, Math.min(1, sunH));
  switch (phase) {
    case "sunrise":
      return {
        top: "#6a9cc8",
        mid: "#f0b48a",
        horizon: "#ffc9a0",
        water: "#3a8fb5",
        waterDeep: "#1a5f7a",
        sun: "#ffd28a",
        glow: "rgba(255,180,120,0.45)",
        starOpacity: 0.08 * (1 - blaze),
        cloudOpacity: 0.85,
      };
    case "morning":
      return {
        top: "#86d0f5",
        mid: "#c3ecfb",
        horizon: "#e2f7ff",
        water: "#35a4cc",
        waterDeep: "#0f76a0",
        sun: "#ffe9a8",
        glow: "rgba(255,230,160,0.4)",
        starOpacity: 0,
        cloudOpacity: 0.9,
      };
    case "noon":
      return {
        top: "#41b1e8",
        mid: "#90d6f0",
        horizon: "#d2f1fc",
        water: "#2497c8",
        waterDeep: "#0b648c",
        sun: "#fff8d0",
        glow: `rgba(255,250,200,${0.45 + blaze * 0.25})`,
        starOpacity: 0,
        cloudOpacity: 0.65,
      };
    case "afternoon":
      return {
        top: "#62b1de",
        mid: "#96cfec",
        horizon: "#cfe7f5",
        water: "#248ebc",
        waterDeep: "#0b5c80",
        sun: "#ffe2a0",
        glow: "rgba(255,210,140,0.38)",
        starOpacity: 0,
        cloudOpacity: 0.8,
      };
    case "evening":
      return {
        top: "#3d6f9c",
        mid: "#e09870",
        horizon: "#f0b890",
        water: "#2a6f94",
        waterDeep: "#0e4560",
        sun: "#ffb070",
        glow: "rgba(255,150,90,0.42)",
        starOpacity: 0.12,
        cloudOpacity: 0.75,
      };
    case "sunset":
      return {
        top: "#2a3d6a",
        mid: "#c45d4a",
        horizon: "#e8895a",
        water: "#1e4f6e",
        waterDeep: "#0a3048",
        sun: "#ff8a4a",
        glow: "rgba(255,100,60,0.42)",
        starOpacity: 0.28,
        cloudOpacity: 0.55,
      };
    default:
      return {
        top: "#0b1a33",
        mid: "#142c4e",
        horizon: "#20436b",
        water: "#123a58",
        waterDeep: "#082338",
        sun: "#ffe9a8",
        glow: "rgba(195,215,255,0.2)",
        starOpacity: 0.9,
        cloudOpacity: 0.3,
      };
  }
}

export type EclipseInfo = {
  type: "none" | "solar" | "lunar";
  /** 0–1 coverage / depth estimate for Kenya */
  magnitude: number;
  label: string;
  detail: string;
  /** True when the event is above the horizon for Kenya observers */
  visibleInKenya: boolean;
};

/**
 * Eclipse geometry is derived live from the solar/lunar ephemeris and the
 * observer's coordinates — no hard-coded date windows. Every eclipse that is
 * genuinely above this location's horizon is detected and rendered.
 */
const EARTH_RADIUS_KM = 6378.14;
const SUN_RADIUS_KM = 696000;
const AU_KM = 149597870.7;

function gmstDeg(now: Date) {
  const jd = julianDate(now);
  return wrap360(280.46061837 + 360.98564736629 * (jd - 2451545.0));
}

/** Moon direction as seen from the observer (topocentric, parallax applied). */
function topocentricMoon(now: Date, lat: number, lon: number) {
  const m = lunarEquatorial(now);
  const r = m.distanceKm / EARTH_RADIUS_KM;
  const phi = lat * DEG;
  const u = Math.atan(0.99664719 * Math.tan(phi));
  const rhoSin = 0.99664719 * Math.sin(u);
  const rhoCos = Math.cos(u);
  const theta = wrap360(gmstDeg(now) + lon) * DEG;
  const ox = rhoCos * Math.cos(theta);
  const oy = rhoCos * Math.sin(theta);
  const oz = rhoSin;
  const mx = r * Math.cos(m.decDeg * DEG) * Math.cos(m.raDeg * DEG);
  const my = r * Math.cos(m.decDeg * DEG) * Math.sin(m.raDeg * DEG);
  const mz = r * Math.sin(m.decDeg * DEG);
  const ra = Math.atan2(my - oy, mx - ox);
  const dec = Math.atan2(mz - oz, Math.hypot(mx - ox, my - oy));
  return { ra, dec, distanceKm: m.distanceKm };
}

/** Angular separation between two equatorial directions (radians in, radians out). */
function angularSeparation(ra1: number, dec1: number, ra2: number, dec2: number) {
  const s = Math.sin(dec1) * Math.sin(dec2) + Math.cos(dec1) * Math.cos(dec2) * Math.cos(ra1 - ra2);
  return Math.acos(Math.max(-1, Math.min(1, s)));
}

/** Moon angular radius (radians) at its current distance. */
function moonAngularRadius(distanceKm: number) {
  return 0.2591 * DEG * (384400 / distanceKm);
}

function localSolarEclipse(now: Date, lat: number, lon: number, sunAltDeg: number, sunRa: number, sunDec: number) {
  if (sunAltDeg < -0.5) return null;
  const m = topocentricMoon(now, lat, lon);
  const sep = angularSeparation(sunRa, sunDec, m.ra, m.dec);
  const rm = moonAngularRadius(m.distanceKm);
  const rs = 0.2666 * DEG;
  if (sep >= rs + rm) return null;
  // Low-precision ephemeris bias is ≈0.1°, so treat central-line events as central.
  const central = sep <= Math.abs(rm - rs) + 0.12 * DEG;
  const annular = central && rm < rs;
  const magnitude = central ? 1 : Math.max(0, Math.min(1, (rs + rm - sep) / (2 * rs)));
  return {
    type: "solar" as const,
    magnitude,
    label: annular
      ? "Annular solar eclipse — ring of fire"
      : central
        ? "Total solar eclipse in progress"
        : magnitude >= 0.6
          ? "Deep partial solar eclipse"
          : magnitude >= 0.25
            ? "Partial solar eclipse in progress"
            : "Solar eclipse — partial phase",
    detail: `Sun ${Math.round(magnitude * 100)}% covered · alt ${sunAltDeg.toFixed(1)}° · live geometry`,
    visibleInKenya: true,
  };
}

function localLunarEclipse(now: Date, sunAltDeg: number, moonAltDeg: number, sunRa: number, sunDec: number) {
  if (moonAltDeg <= 0 || sunAltDeg > 4) return null;
  const m = lunarEquatorial(now);
  const antiRa = wrap360(sunRa * RAD + 180) * DEG;
  const sep = angularSeparation(antiRa, -sunDec, m.raDeg * DEG, m.decDeg * DEG);
  const rm = moonAngularRadius(m.distanceKm);
  const d = m.distanceKm;
  const umbra = Math.atan((EARTH_RADIUS_KM - (SUN_RADIUS_KM - EARTH_RADIUS_KM) * (d / AU_KM)) / d);
  const penumbra = Math.atan((EARTH_RADIUS_KM + (SUN_RADIUS_KM + EARTH_RADIUS_KM) * (d / AU_KM)) / d);
  if (sep >= penumbra + rm) return null;
  const umbral = (umbra + rm - sep) / (2 * rm);
  const penumbral = ((penumbra + rm - sep) / (2 * rm)) * 0.3;
  const magnitude = Math.max(0, Math.min(1, Math.max(umbral, penumbral)));
  const total = sep <= umbra - rm;
  const partial = !total && sep < umbra + rm;
  return {
    type: "lunar" as const,
    magnitude,
    label: total
      ? "Total lunar eclipse — blood moon"
      : partial
        ? "Partial lunar eclipse — umbral shadow"
        : "Penumbral lunar eclipse",
    detail: `Moon ${Math.round(Math.max(0, Math.min(1, umbral)) * 100)}% into umbra · alt ${moonAltDeg.toFixed(1)}° · live geometry`,
    visibleInKenya: true,
  };
}

/** Live local eclipse tracker driven by real ephemeris + observer position. */
export function detectLiveEclipse(now = new Date(), lat: number = KIJABE.lat, lon: number = KIJABE.lon): EclipseInfo {
  const sun = solarPositionKenya(now, lat, lon);
  const sunEq = sunEquatorial(now);
  const solar = localSolarEclipse(now, lat, lon, sun.altitudeDeg, sunEq.ra, sunEq.dec);
  if (solar) return solar;
  const moonAlt = lunarPositionKenya(now, lat, lon).altitudeDeg;
  const lunar = localLunarEclipse(now, sun.altitudeDeg, moonAlt, sunEq.ra, sunEq.dec);
  if (lunar) return lunar;
  return { type: "none", magnitude: 0, label: "", detail: "", visibleInKenya: false };
}

/** Simple hex blend for weather-dimmed skies */
export function mixHex(a: string, b: string, t: number) {
  const parse = (h: string) => {
    const x = h.replace("#", "");
    return [parseInt(x.slice(0, 2), 16), parseInt(x.slice(2, 4), 16), parseInt(x.slice(4, 6), 16)] as const;
  };
  try {
    const [ar, ag, ab] = parse(a);
    const [br, bg, bb] = parse(b);
    const m = (x: number, y: number) => Math.round(x + (y - x) * t);
    const hex = (n: number) => n.toString(16).padStart(2, "0");
    return `#${hex(m(ar, br))}${hex(m(ag, bg))}${hex(m(ab, bb))}`;
  } catch {
    return a;
  }
}

export function phaseLabel(phase: DayPhase) {
  switch (phase) {
    case "sunrise":
      return "Sunrise";
    case "morning":
      return "Morning light";
    case "noon":
      return "Midday sun";
    case "afternoon":
      return "Afternoon";
    case "evening":
      return "Evening glow";
    case "sunset":
      return "Sunset";
    default:
      return "Night sky";
  }
}
