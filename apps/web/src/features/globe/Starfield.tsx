"use client";

import { useEffect, useRef } from "react";

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A sparse, still starfield behind the (transparent) globe canvas. */
export default function Starfield() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current!;
    const draw = () => {
      const dpr = Math.min(window.devicePixelRatio, 2);
      const w = window.innerWidth;
      const h = window.innerHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      const g = canvas.getContext("2d")!;
      g.scale(dpr, dpr);
      g.fillStyle = "#010a12";
      g.fillRect(0, 0, w, h);

      // faint galactic haze on a diagonal
      const haze = g.createLinearGradient(0, h * 0.95, w, h * 0.05);
      haze.addColorStop(0, "rgba(20, 60, 80, 0)");
      haze.addColorStop(0.45, "rgba(30, 80, 100, 0.07)");
      haze.addColorStop(0.55, "rgba(60, 70, 110, 0.06)");
      haze.addColorStop(1, "rgba(20, 60, 80, 0)");
      g.fillStyle = haze;
      g.fillRect(0, 0, w, h);

      const rand = mulberry32(7);
      const count = Math.round((w * h) / 3600);
      for (let i = 0; i < count; i++) {
        const x = rand() * w;
        const y = rand() * h;
        // denser toward the haze band
        const band = Math.abs((x / w) - (1 - y / h));
        if (band > 0.35 && rand() < 0.45) continue;
        const bright = rand() < 0.035;
        const r = bright ? 0.9 + rand() * 0.7 : 0.25 + rand() * 0.55;
        const a = bright ? 0.7 + rand() * 0.3 : 0.12 + rand() * 0.45;
        const tint = rand();
        const col = tint < 0.2 ? "255, 226, 200" : tint < 0.5 ? "200, 230, 255" : "235, 245, 245";
        g.beginPath();
        g.arc(x, y, r, 0, Math.PI * 2);
        g.fillStyle = `rgba(${col}, ${a})`;
        g.fill();
        if (bright) {
          const glow = g.createRadialGradient(x, y, 0, x, y, r * 6);
          glow.addColorStop(0, `rgba(${col}, 0.18)`);
          glow.addColorStop(1, `rgba(${col}, 0)`);
          g.fillStyle = glow;
          g.fillRect(x - r * 6, y - r * 6, r * 12, r * 12);
        }
      }
    };
    draw();
    window.addEventListener("resize", draw);
    return () => window.removeEventListener("resize", draw);
  }, []);

  return <canvas ref={ref} className="stage-layer" aria-hidden="true" style={{ width: "100%", height: "100%" }} />;
}
