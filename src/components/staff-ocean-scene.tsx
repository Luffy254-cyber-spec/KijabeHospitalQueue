import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { OceanAmbient } from "@/lib/ocean-ambient";
import {
  dayPhaseFromSun,
  detectLiveEclipse,
  KIJABE,
  moonLabel,
  moonSky,
  nairobiParts,
  phaseLabel,
  mixHex,
  skyPalette,
  solarPositionKenya,
} from "@/lib/sky-time";
import { useLocalWeather } from "@/hooks/use-local-weather";
import { isWet } from "@/lib/weather";

type Props = {
  children: ReactNode;
  /** login = centered glass card; display = full waiting-room board over the ocean */
  variant?: "login" | "display";
  /** Manual “Enable sea sounds” on login */
  showSeaSounds?: boolean;
  /** Display board: start/stop calm ocean with the sound toggle */
  ambientActive?: boolean;
  /** Soften ocean while ticket announcements speak */
  ambientDuck?: boolean;
  /** Prefer gentle waves over horns (waiting room) */
  calmAmbient?: boolean;
};
type DolphinStyle = "arc" | "flip" | "corkscrew" | "longleap";

type Meteor = {
  id: number;
  top: number;
  left: number;
  angle: number;
  dx: number;
  dy: number;
  length: number;
  duration: number;
};

export function StaffOceanScene({
  children,
  variant = "login",
  showSeaSounds,
  ambientActive,
  ambientDuck = false,
  calmAmbient = false,
}: Props) {
  const seaSounds = showSeaSounds ?? variant === "login";
  const { weather } = useLocalWeather();
  const [now, setNow] = useState(() => new Date());
  const [dolphin, setDolphin] = useState<{ style: DolphinStyle; key: number } | null>(null);
  const [splashOut, setSplashOut] = useState(false);
  const [splashIn, setSplashIn] = useState(false);
  const [ship, setShip] = useState(false);
  const [whale, setWhale] = useState(false);
  const [crab, setCrab] = useState(false);
  const [starfish, setStarfish] = useState(false);
  const [audioOn, setAudioOn] = useState(false);
  const [meteors, setMeteors] = useState<Meteor[]>([]);
  const meteorId = useRef(0);
  const ambient = useRef<OceanAmbient | null>(null);

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const sky = useMemo(() => {
    const lat = weather?.lat ?? KIJABE.lat;
    const lon = weather?.lon ?? KIJABE.lon;
    const parts = nairobiParts(now, weather?.timezone);
    const sun = solarPositionKenya(now, lat, lon);
    const phase = dayPhaseFromSun(sun);
    const moon = moonSky(now, sun, undefined, lat, lon);
    const eclipse = detectLiveEclipse(now, lat, lon);
    let pal = skyPalette(phase, sun.height);
    // Overcast / rain dims the whole sky, not just the cloud layer
    if (weather) {
      const cloud = Math.max(0, Math.min(1, weather.cloudCover / 100));
      const wet = isWet(weather.condition);
      const nightish = phase === "night" || phase === "sunset";
      const stormy = weather.condition === "storm" || weather.condition === "heavy";
      // Real overcast stays luminous by day and moonlit blue by night.
      const overcast = nightish
        ? stormy ? "#3b4d61" : wet ? "#3d5170" : "#425a75"
        : stormy ? "#87949f" : wet ? "#a2b1bc" : "#bcc8d2";
      const dim =
        stormy ? (nightish ? 0.5 : 0.6)
        : weather.condition === "rain" ? (nightish ? 0.4 : 0.48)
        : weather.condition === "drizzle" ? (nightish ? 0.28 : 0.32)
        : weather.condition === "fog" ? 0.36
        : cloud > 0.8 ? (nightish ? 0.4 : 0.45)
        : cloud > 0.5 ? (nightish ? 0.24 : 0.28)
        : 0.1;
      pal = {
        ...pal,
        top: mixHex(pal.top, overcast, dim),
        mid: mixHex(pal.mid, nightish ? "#4a6480" : "#ccd8e1", Math.min(0.85, dim + 0.06)),
        horizon: mixHex(pal.horizon, nightish ? "#6d8aa6" : "#e7edf1", dim * 0.8),
        water: mixHex(pal.water, nightish ? "#235072" : "#7c96a3", wet ? 0.32 : dim * 0.38),
        waterDeep: mixHex(pal.waterDeep, nightish ? "#123349" : "#4a6878", wet ? 0.28 : dim * 0.3),
        sun: nightish ? "#e9eef7" : "#f6f8fa",
        glow: wet
          ? nightish ? "rgba(175,200,230,0.18)" : "rgba(240,246,250,0.38)"
          : pal.glow,
        cloudOpacity: Math.min(1, Math.max(pal.cloudOpacity, 0.35 + cloud * 0.6)),
        starOpacity: nightish ? pal.starOpacity * (wet ? 0.25 : 1 - cloud * 0.7) : 0,
      };
    }
    const wet = weather ? isWet(weather.condition) : false;
    const cloudCover = weather?.cloudCover ?? 0;
    const solarEclipse =
      eclipse.type === "solar" && eclipse.visibleInKenya && eclipse.magnitude > 0.12 && sun.altitudeDeg > -0.5;
    const lunarEclipse = eclipse.type === "lunar" && eclipse.visibleInKenya && eclipse.magnitude > 0.12;
    // A solar eclipse darkens the whole sky, not just the Sun disc.
    if (solarEclipse) {
      const k = Math.min(0.78, eclipse.magnitude * 0.85);
      pal = {
        ...pal,
        top: mixHex(pal.top, "#0a1220", k),
        mid: mixHex(pal.mid, "#101c30", k),
        horizon: mixHex(pal.horizon, "#1a2940", k * 0.9),
        water: mixHex(pal.water, "#0c2130", k * 0.85),
        waterDeep: mixHex(pal.waterDeep, "#05111b", k * 0.85),
        starOpacity: Math.max(pal.starOpacity, eclipse.magnitude * 0.5),
      };
    }
    // Only draw the Moon when it is genuinely above the eastern/western horizon.
    const moonVisible =
      moon.up && moon.lit > 0.015 && (phase === "night" || sun.altitudeDeg < 3 || moon.lit > 0.32 || lunarEclipse);
    const isNight = phase === "night" || (phase === "sunset" && sun.altitudeDeg < 2) || solarEclipse;
    // Shooting stars: only on a dark, mostly clear sky, and washed out by clouds/moonlight.
    const obscured = wet || weather?.condition === "fog" || weather?.condition === "snow";
    const clearSky = weather ? Math.max(0, 1 - cloudCover / 100) : 0.75;
    const moonWash = moonVisible ? 1 - moon.lit * 0.6 : 1;
    const meteorRate = isNight && !obscured ? Math.round(clearSky * moonWash * 20) / 20 : 0;
    return {
      parts,
      phase,
      sun,
      sunH: sun.height,
      sunLeft: sun.leftPct,
      moonH: moon.height,
      moonLeft: moon.leftPct,
      moonPhase: moon.phase,
      moonLit: moon.lit,
      moonName: moonLabel(moon.phase),
      moonVisible,
      meteorRate,
      wet,
      cloudCover,
      pal,
      eclipse,
      solarEclipse,
      lunarEclipse,
      isNight,
    };
  }, [now, weather]);

  // Occasional shooting stars — sparse by design, fewer when cloud or moonlight washes the sky.
  useEffect(() => {
    if (sky.meteorRate <= 0.05) {
      setMeteors([]);
      return;
    }
    let alive = true;
    let timer = 0;
    const maxActive = sky.meteorRate > 0.6 ? 3 : sky.meteorRate > 0.3 ? 2 : 1;
    const spawn = () => {
      if (!alive) return;
      const vw = window.innerWidth;
      const angle = 16 + Math.random() * 22;
      const rad = (angle * Math.PI) / 180;
      const dx = (0.22 + Math.random() * 0.28) * vw;
      const meteor: Meteor = {
        id: ++meteorId.current,
        top: 2 + Math.random() * 36,
        left: 4 + Math.random() * 62,
        angle,
        dx,
        dy: dx * Math.tan(rad),
        length: 60 + Math.random() * 90,
        duration: 1.3 + Math.random() * 0.9,
      };
      setMeteors((prev) => (prev.length >= maxActive ? prev : [...prev, meteor]));
      timer = window.setTimeout(spawn, (8000 + Math.random() * 16000) / Math.max(0.15, sky.meteorRate));
    };
    timer = window.setTimeout(spawn, (5000 + Math.random() * 10000) / Math.max(0.15, sky.meteorRate));
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [sky.meteorRate]);

  const removeMeteor = (id: number) => setMeteors((prev) => prev.filter((m) => m.id !== id));

  useEffect(() => {
    const styles: DolphinStyle[] = ["arc", "flip", "corkscrew", "longleap"];
    const jump = () => {
      const style = styles[Math.floor(Math.random() * styles.length)]!;
      setDolphin({ style, key: Date.now() });
      setSplashOut(true);
      ambient.current?.dolphinExit();
      window.setTimeout(() => setSplashOut(false), 700);
      // Re-entry splash ~ peak→dive
      window.setTimeout(() => {
        setSplashIn(true);
        ambient.current?.dolphinEnter();
        window.setTimeout(() => setSplashIn(false), 800);
      }, 1750);
      window.setTimeout(() => setDolphin(null), 3400);
    };
    const sail = () => {
      setShip(true);
      ambient.current?.shipPass();
      window.setTimeout(() => setShip(false), 14000);
    };
    const breach = () => {
      setWhale(true);
      ambient.current?.whaleBreach();
      window.setTimeout(() => setWhale(false), 5200);
    };
    const scuttle = () => {
      setCrab(true);
      ambient.current?.crabWalk();
      window.setTimeout(() => setCrab(false), 7000);
    };
    const crawl = () => {
      setStarfish(true);
      ambient.current?.starfishCrawl();
      window.setTimeout(() => setStarfish(false), 9000);
    };
    const dId = window.setInterval(jump, 16000 + Math.random() * 10000);
    const sId = window.setInterval(sail, 28000 + Math.random() * 16000);
    const wId = window.setInterval(breach, 28000 + Math.random() * 18000);
    const cId = window.setInterval(scuttle, 22000 + Math.random() * 14000);
    const stId = window.setInterval(crawl, 18000 + Math.random() * 12000);
    const firstD = window.setTimeout(jump, 5000);
    const firstS = window.setTimeout(sail, 8000);
    const firstW = window.setTimeout(breach, 9000);
    const firstC = window.setTimeout(scuttle, 7000);
    const firstSt = window.setTimeout(crawl, 4500);
    return () => {
      clearInterval(dId); clearInterval(sId); clearInterval(wId); clearInterval(cId); clearInterval(stId);
      clearTimeout(firstD); clearTimeout(firstS); clearTimeout(firstW); clearTimeout(firstC); clearTimeout(firstSt);
    };
  }, []);

  useEffect(() => () => { ambient.current?.stop(); }, []);

  // Display / external: calm ocean autoplays with hope music, ducks during PA
  useEffect(() => {
    if (ambientActive === undefined) return;
    if (ambientActive) {
      if (!ambient.current) ambient.current = new OceanAmbient();
      if (calmAmbient) ambient.current.startCalm();
      else ambient.current.start();
      setAudioOn(true);
    } else if (ambient.current) {
      ambient.current.stop();
      ambient.current = null;
      setAudioOn(false);
    }
  }, [ambientActive, calmAmbient]);

  useEffect(() => {
    if (ambientActive === undefined || !ambient.current) return;
    if (ambientDuck) ambient.current.duck(0.05);
    else ambient.current.unduck();
  }, [ambientDuck, ambientActive]);

  // Resume AudioContext after browser gesture (needed when sound was already enabled)
  useEffect(() => {
    if (!ambientActive) return;
    const resume = () => {
      if (ambient.current) {
        // A context created before the first gesture starts suspended.
        ambient.current.resume();
        return;
      }
      ambient.current = new OceanAmbient();
      if (calmAmbient) ambient.current.startCalm();
      else ambient.current.start();
      setAudioOn(true);
    };
    window.addEventListener("pointerdown", resume, { once: true });
    window.addEventListener("keydown", resume, { once: true });
    return () => {
      window.removeEventListener("pointerdown", resume);
      window.removeEventListener("keydown", resume);
    };
  }, [ambientActive, calmAmbient]);

  const enableAudio = () => {
    if (!ambient.current) ambient.current = new OceanAmbient();
    if (calmAmbient) ambient.current.startCalm();
    else ambient.current.start();
    setAudioOn(true);
  };

  const { pal, phase, sun, sunH, sunLeft, moonH, moonLeft, moonLit, moonName, moonPhase, moonVisible, wet, cloudCover, isNight, parts, eclipse, solarEclipse, lunarEclipse } = sky;
  const sunBottom = 16 + sunH * 62;
  const moonBottom = 20 + moonH * 52;
  const cloudFilter = isNight
    ? "brightness(0.68) saturate(0.7) blur(0.2px)"
    : wet
      ? "brightness(0.95) saturate(0.85) blur(0.2px)"
      : undefined;
  const stormCloudBg = isNight
    ? "rgba(92,112,136,0.55)"
    : weather?.condition === "storm" || weather?.condition === "heavy"
      ? "rgba(124,137,148,0.6)"
      : "rgba(184,194,202,0.62)";
  const meteorNodes = meteors.map((m) => (
    <span
      key={m.id}
      className="staff-ocean-meteor"
      style={{
        top: `${m.top}%`,
        left: `${m.left}%`,
        width: `${m.length}px`,
        animationDuration: `${m.duration}s`,
        "--meteor-angle": `${m.angle}deg`,
        "--meteor-dx": `${m.dx}px`,
        "--meteor-dy": `${m.dy}px`,
      } as CSSProperties}
      onAnimationEnd={() => removeMeteor(m.id)}
    />
  ));

  return (
    <main
      className={`staff-ocean staff-ocean-${variant} staff-ocean-phase-${phase}${eclipse.type !== "none" ? " staff-ocean-eclipse" : ""}`}
      style={{
        background: `linear-gradient(180deg, ${pal.top} 0%, ${pal.mid} 38%, ${pal.horizon} 52%, ${pal.water} 68%, ${pal.waterDeep} 100%)`,
      }}
    >
      <div className="staff-ocean-sky" aria-hidden>
        <div className="staff-ocean-stars" style={{ opacity: Math.max(pal.starOpacity, solarEclipse ? eclipse.magnitude * 0.55 : 0) }}>
          {Array.from({ length: 36 }).map((_, i) => (
            <span
              key={i}
              className="staff-ocean-star"
              style={{
                left: `${(i * 37) % 100}%`,
                top: `${(i * 19) % 48}%`,
                animationDelay: `${(i % 7) * 0.4}s`,
              }}
            />
          ))}
        </div>
        {/* Occasional shooting stars in the sky layer */}
        {variant !== "display" && meteorNodes.length > 0 && (
          <div className="staff-ocean-meteors" aria-hidden>
            {meteorNodes}
          </div>
        )}

        {sun.altitudeDeg > -1.2 && (
          <div
            className={`staff-ocean-sun${solarEclipse ? " staff-ocean-sun-eclipsed" : ""}`}
            style={{
              left: `${sunLeft}%`,
              bottom: `${Math.max(10, sunBottom)}%`,
              background: pal.sun,
              boxShadow: solarEclipse
                ? `0 0 ${20 + eclipse.magnitude * 50}px ${8 + eclipse.magnitude * 20}px rgba(255,200,120,0.55)`
                : `0 0 ${36 + sunH * 28}px ${12 + sunH * 18}px ${pal.glow}, 0 0 ${80 + sunH * 40}px ${24 + sunH * 20}px ${pal.glow}`,
              opacity: Math.min(
                1,
                (0.35 + Math.max(0, sun.altitudeDeg) / 40) *
                  (wet
                    ? (isNight ? 0.1 : 0.18)
                    : cloudCover >= 85
                      ? (isNight ? 0.25 : 0.32)
                      : cloudCover >= 65
                        ? 0.6
                        : 1),
              ),
              width: `${48 + sunH * 22}px`,
              height: `${48 + sunH * 22}px`,
              marginLeft: `${-(24 + sunH * 11)}px`,
            }}
            title={`Sun · alt ${sun.altitudeDeg.toFixed(1)}° · az ${sun.azimuthDeg.toFixed(0)}°`}
          >
            {solarEclipse && (
              <span
                className="staff-ocean-eclipse-disk"
                style={{ transform: `translate(-50%, -50%) scale(${0.5 + eclipse.magnitude * 0.6})` }}
              />
            )}
          </div>
        )}

        {moonVisible && (
          <div
            className={`staff-ocean-moon${lunarEclipse ? " staff-ocean-moon-eclipsed" : ""}`}
            style={{
              left: `${moonLeft}%`,
              bottom: `${Math.max(12, moonBottom)}%`,
              opacity: lunarEclipse
                ? 0.55 + eclipse.magnitude * 0.4
                : Math.min(
                    0.95,
                    (0.2 + moonLit * 0.75) *
                      (isNight ? 1 : 0.55) *
                      (wet ? 0.25 : cloudCover >= 80 ? 0.45 : cloudCover >= 60 ? 0.7 : 1),
                  ),
              background: lunarEclipse
                ? `radial-gradient(circle at 35% 35%, #f2d0b0 0%, #c45a3a ${40 + eclipse.magnitude * 30}%, #4a1a12 100%)`
                : undefined,
              transition: "left 1s linear, bottom 1s linear, opacity 1s linear",
            }}
            title={lunarEclipse ? eclipse.label : moonName}
          >
            {!lunarEclipse && (
              <span
                className="staff-ocean-moon-shadow"
                style={{
                  // Shadow moves away from the lit limb: new = fully covered, full = clear.
                  transform: `translateX(${
                    (moonPhase <= 0.5 ? -1 : 1) *
                    (moonLit <= 0.5 ? moonLit * 42 : 21 + (moonLit - 0.5) * 50.4)
                  }px)`,
                }}
              />
            )}
          </div>
        )}

        <span
          className="staff-ocean-cloud staff-ocean-cloud-1"
          style={{ opacity: pal.cloudOpacity, filter: cloudFilter }}
        />
        <span
          className="staff-ocean-cloud staff-ocean-cloud-2"
          style={{ opacity: pal.cloudOpacity, filter: cloudFilter }}
        />
        <span
          className="staff-ocean-cloud staff-ocean-cloud-3"
          style={{ opacity: pal.cloudOpacity * 0.9, filter: cloudFilter }}
        />
        {weather && weather.cloudCover > 55 && (
          <>
            <span
              className="staff-ocean-cloud staff-ocean-cloud-storm-1"
              style={{ opacity: Math.min(1, weather.cloudCover / 100), background: stormCloudBg }}
            />
            <span
              className="staff-ocean-cloud staff-ocean-cloud-storm-2"
              style={{ opacity: Math.min(1, weather.cloudCover / 110), background: stormCloudBg }}
            />
          </>
        )}

        {weather && isWet(weather.condition) && (
          <div
            className={`staff-ocean-precip staff-ocean-precip-${weather.condition}`}
            style={{ opacity: 0.35 + weather.intensity * 0.65 }}
            aria-hidden
          >
            {Array.from({ length: weather.condition === "drizzle" ? 28 : weather.condition === "heavy" || weather.condition === "storm" ? 70 : 48 }).map((_, i) => (
              <span
                key={i}
                className="staff-ocean-drop"
                style={{
                  left: `${(i * 47 + (i % 5) * 13) % 100}%`,
                  animationDelay: `${(i % 12) * 0.11}s`,
                  animationDuration: `${0.55 + (i % 7) * 0.08 + (1 - weather.intensity) * 0.35}s`,
                  height: weather.condition === "drizzle" ? 8 + (i % 4) : 12 + (i % 8) * 2,
                }}
              />
            ))}
          </div>
        )}
        {/* Atmospheric scatter near the horizon — keeps the sky luminous instead of flat */}
        <div
          className="staff-ocean-haze"
          style={{
            background: `linear-gradient(to top, ${pal.horizon} 0%, ${pal.horizon}cc 26%, ${pal.horizon}00 72%)`,
            opacity: isNight ? 0.3 : 0.45,
          }}
          aria-hidden
        />
        {weather?.condition === "fog" && <div className="staff-ocean-fog" aria-hidden />}
        {weather?.condition === "storm" && <div className="staff-ocean-flash" aria-hidden />}
      </div>

      <div className="staff-ocean-waves" aria-hidden>
        <span className="staff-ocean-wave staff-ocean-wave-1" />
        <span className="staff-ocean-wave staff-ocean-wave-2" />
        <span className="staff-ocean-wave staff-ocean-wave-3" />

        <span className="staff-ocean-weed staff-ocean-weed-1" />
        <span className="staff-ocean-weed staff-ocean-weed-2" />
        <span className="staff-ocean-weed staff-ocean-weed-3" />
        <span className="staff-ocean-weed staff-ocean-weed-4" />
        <span className="staff-ocean-plant staff-ocean-plant-1">🌿</span>
        <span className="staff-ocean-plant staff-ocean-plant-2">🌱</span>
        <span className="staff-ocean-plant staff-ocean-plant-3">🌿</span>

        <span className="staff-ocean-bubble staff-ocean-bubble-1" />
        <span className="staff-ocean-bubble staff-ocean-bubble-2" />
        <span className="staff-ocean-bubble staff-ocean-bubble-3" />
        <span className="staff-ocean-bubble staff-ocean-bubble-4" />
        <span className="staff-ocean-bubble staff-ocean-bubble-5" />
        <span className="staff-ocean-bubble staff-ocean-bubble-6" />

        {/* Default sea emojis face left: flip only when traveling left→right */}
        <span className="staff-ocean-lane staff-ocean-fish-1">
          <span className="staff-ocean-body staff-ocean-wiggle staff-ocean-flip">🐟</span>
        </span>
        <span className="staff-ocean-lane staff-ocean-fish-2">
          <span className="staff-ocean-body staff-ocean-wiggle">🐠</span>
        </span>
        <span className="staff-ocean-lane staff-ocean-fish-3">
          <span className="staff-ocean-body staff-ocean-wiggle staff-ocean-flip">🐡</span>
        </span>
        <span className="staff-ocean-lane staff-ocean-fish-4">
          <span className="staff-ocean-body staff-ocean-wiggle">🐟</span>
        </span>

        <span className="staff-ocean-lane staff-ocean-sardines staff-ocean-sardines-1">
          <span className="staff-ocean-sardine">•</span>
          <span className="staff-ocean-sardine">•</span>
          <span className="staff-ocean-sardine">•</span>
          <span className="staff-ocean-sardine">•</span>
          <span className="staff-ocean-sardine">•</span>
          <span className="staff-ocean-sardine">•</span>
          <span className="staff-ocean-sardine">•</span>
          <span className="staff-ocean-sardine">•</span>
        </span>
        <span className="staff-ocean-lane staff-ocean-sardines staff-ocean-sardines-2">
          <span className="staff-ocean-sardine">•</span>
          <span className="staff-ocean-sardine">•</span>
          <span className="staff-ocean-sardine">•</span>
          <span className="staff-ocean-sardine">•</span>
          <span className="staff-ocean-sardine">•</span>
          <span className="staff-ocean-sardine">•</span>
        </span>

        <span className="staff-ocean-lane staff-ocean-shark-1">
          <span className="staff-ocean-body staff-ocean-wiggle-slow staff-ocean-flip">🦈</span>
        </span>
        <span className="staff-ocean-lane staff-ocean-shark-2">
          <span className="staff-ocean-body staff-ocean-wiggle-slow">🦈</span>
        </span>

        <span className="staff-ocean-lane staff-ocean-swimmer-1">
          <span className="staff-ocean-body staff-ocean-stroke staff-ocean-flip">🏊</span>
        </span>
        <span className="staff-ocean-lane staff-ocean-swimmer-2">
          <span className="staff-ocean-body staff-ocean-stroke">🏊‍♀️</span>
        </span>

        <span className="staff-ocean-lane staff-ocean-diver-1">
          <span className="staff-ocean-body staff-ocean-flip">🤿</span>
        </span>
        <span className="staff-ocean-lane staff-ocean-diver-2">
          <span className="staff-ocean-body">🤿</span>
        </span>

        <span className="staff-ocean-shell staff-ocean-shell-1">🐚</span>

        {splashOut && <span className="staff-ocean-splash staff-ocean-splash-out" />}
        {splashIn && <span className="staff-ocean-splash staff-ocean-splash-in" />}
        {dolphin && (
          <span key={dolphin.key} className={`staff-ocean-dolphin staff-ocean-dolphin-${dolphin.style}`}>
            <span className="staff-ocean-body staff-ocean-wiggle">🐬</span>
          </span>
        )}
        {whale && (
          <span className="staff-ocean-whale">
            <span className="staff-ocean-body staff-ocean-wiggle-slow">🐋</span>
          </span>
        )}
        {crab && (
          <span className="staff-ocean-crab">
            <span className="staff-ocean-body staff-ocean-crab-bob">🦀</span>
          </span>
        )}
        {starfish && (
          <span className="staff-ocean-starfish" aria-hidden>
            <span className="staff-ocean-starfish-arm" />
            <span className="staff-ocean-starfish-arm" />
            <span className="staff-ocean-starfish-arm" />
            <span className="staff-ocean-starfish-arm" />
            <span className="staff-ocean-starfish-arm" />
            <span className="staff-ocean-starfish-core" />
          </span>
        )}
        {ship && (
          <span className="staff-ocean-ship">
            <span className="staff-ocean-ship-steam" aria-hidden>
              <i /><i /><i />
            </span>
            <span className="staff-ocean-body">🚢</span>
          </span>
        )}
      </div>

      {variant === "display" ? (
        <div className="staff-ocean-display-stage">{children}</div>
      ) : (
        <div className="staff-ocean-stage">
          <div className="staff-ocean-neon" aria-hidden>
            <span className="staff-ocean-neon-ring" />
          </div>
          <div className="staff-ocean-card-wrap">{children}</div>
        </div>
      )}

      {/* Display: occasional shooting stars above the board (pointer-events none) */}
      {variant === "display" && meteorNodes.length > 0 && (
        <div className="staff-ocean-meteors staff-ocean-meteors-display" aria-hidden>
          {meteorNodes}
        </div>
      )}

      <div className={`staff-ocean-hud${variant === "display" ? " staff-ocean-hud-display" : ""}`}>
        <p>
          {String(parts.hour).padStart(2, "0")}:{String(parts.minute).padStart(2, "0")} · {phaseLabel(phase)}
          {" · "}
          {moonName}
          {weather && (
            <span className="staff-ocean-weather-badge">
              {" · "}
              {weather.summary}
              {weather.tempC != null ? ` ${Math.round(weather.tempC)}°C` : ""}
              {" · "}
              {weather.place}
              {weather.forecast[0] && weather.forecast[0].precipProb >= 40
                ? ` · next: ${weather.forecast[0].summary} (${weather.forecast[0].precipProb}%)`
                : ""}
            </span>
          )}
          {eclipse.visibleInKenya && eclipse.type !== "none" && (
            <span className="staff-ocean-eclipse-badge">
              {" · "}
              {eclipse.label} · {Math.round(eclipse.magnitude * 100)}%
            </span>
          )}
        </p>
        {seaSounds && (
          !audioOn ? (
            <button type="button" onClick={enableAudio} className="staff-ocean-audio-btn">
              Enable sea sounds
            </button>
          ) : (
            <span className="staff-ocean-audio-on">Sea sounds on</span>
          )
        )}
      </div>
    </main>
  );
}
