"use client";

import Link from "next/link";
import { useStore } from "@/lib/store";

const TITLE = "REEF SENTINEL";

export default function Hero() {
  const setPhase = useStore((s) => s.setPhase);
  const reduced = useStore((s) => s.reducedMotion);
  const base = reduced ? 0 : 1.1; // seconds: the reef line draws first

  return (
    <section className="hud" aria-labelledby="hero-title">
      <div className="hero">
        <h1 id="hero-title" className="hero-title" aria-label="Reef Sentinel">
          {TITLE.split("").map((ch, i) => (
            <span key={i} aria-hidden="true" style={{ animationDelay: `${base + 0.9 + i * 0.07}s` }}>
              {ch === " " ? " " : ch}
            </span>
          ))}
        </h1>
        <p className="hero-sub" style={{ animationDelay: `${base + 2.3}s` }}>
          Every reef tells a story.
          <br />
          We find the pressures behind it.
        </p>
        <div className="hero-actions" style={{ animationDelay: `${base + 3.0}s` }}>
          <button className="btn-dive" onClick={() => setPhase("flying")} autoFocus>
            <span className="ping" aria-hidden="true" />
            Enter the Ocean
          </button>
          <button className="btn-quiet" onClick={() => setPhase("region")}>
            Skip the flight
          </button>
          <Link className="btn-quiet" href="/data">Explore reef datasets</Link>
        </div>
      </div>
      <p className="hero-credit" style={{ animationDelay: `${base + 3.6}s` }}>
        Florida&rsquo;s Coral Reef, 2016&ndash;2024. Heat stress from NOAA Coral Reef Watch, storm tracks from NOAA HURDAT2,
        lionfish records from USGS.
      </p>
    </section>
  );
}
