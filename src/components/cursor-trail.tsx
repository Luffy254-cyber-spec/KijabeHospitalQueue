import { useEffect, useState } from "react";

type Particle = {
  id: number;
  x: number;
  y: number;
  symbol: string;
  opacity: number;
  scale: number;
};

const SYMBOLS = ["†", "✚", "✨", "·", "✦"];

export function CursorTrail() {
  const [particles, setParticles] = useState<Particle[]>([]);
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    // Disable on touch devices or reduced motion preference
    if (typeof window === "undefined") return;
    if (window.matchMedia("(pointer: coarse)").matches) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    setEnabled(true);
    let counter = 0;
    let lastX = 0;
    let lastY = 0;

    const handleMouseMove = (e: MouseEvent) => {
      const dist = Math.hypot(e.clientX - lastX, e.clientY - lastY);
      if (dist < 28) return; // throttle particle creation

      lastX = e.clientX;
      lastY = e.clientY;

      const symbol = SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)]!;
      const newParticle: Particle = {
        id: counter++,
        x: e.clientX,
        y: e.clientY,
        symbol,
        opacity: 1,
        scale: 1,
      };

      setParticles((prev) => [...prev.slice(-12), newParticle]);
    };

    window.addEventListener("mousemove", handleMouseMove, { passive: true });

    const interval = window.setInterval(() => {
      setParticles((prev) =>
        prev
          .map((p) => ({
            ...p,
            y: p.y - 1.2,
            opacity: p.opacity - 0.07,
            scale: p.scale + 0.03,
          }))
          .filter((p) => p.opacity > 0)
      );
    }, 45);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      clearInterval(interval);
    };
  }, []);

  if (!enabled || particles.length === 0) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-[99999] overflow-hidden" aria-hidden="true">
      {particles.map((p) => (
        <span
          key={p.id}
          className="absolute font-bold text-[#0c729c] select-none transition-transform duration-75"
          style={{
            left: `${p.x}px`,
            top: `${p.y}px`,
            opacity: p.opacity,
            transform: `translate(-50%, -50%) scale(${p.scale})`,
            fontSize: p.symbol === "†" || p.symbol === "✚" ? "15px" : "12px",
            textShadow: "0 0 8px rgba(12, 114, 156, 0.45)",
          }}
        >
          {p.symbol}
        </span>
      ))}
    </div>
  );
}
