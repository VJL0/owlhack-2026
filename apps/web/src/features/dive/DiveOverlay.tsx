"use client";

import { useEffect, useMemo } from "react";
import { siteById } from "@/lib/data";
import { useStore } from "@/lib/store";
import { mulberry32 } from "@/features/reef/terrain";
import { flagshipById } from "@/lib/flagshipIndex";

/**
 * The crossing between globe and reef. Pure CSS animation (compositor thread),
 * so it keeps moving while the reef scene compiles its shaders underneath.
 */
export default function DiveOverlay() {
  const crossing = useStore((s) => s.crossing);
  const phase = useStore((s) => s.phase);
  const reefReady = useStore((s) => s.reefReady);
  const siteId = useStore((s) => s.siteId);
  const reduced = useStore((s) => s.reducedMotion);
  const setCrossing = useStore((s) => s.setCrossing);

  // plunge → (reef ready) → surface reveal → done
  useEffect(() => {
    if (crossing !== "plunge") return;
    const ready = ((phase === "reef" || phase === "splat") && reefReady) || phase === "ascending" || phase === "region" || phase === "flagship";
    if (!ready) return;
    const id = window.setTimeout(() => setCrossing("surface"), reduced ? 50 : 700);
    return () => window.clearTimeout(id);
  }, [crossing, phase, reefReady, reduced, setCrossing]);

  useEffect(() => {
    if (crossing !== "surface") return;
    const id = window.setTimeout(() => setCrossing("none"), reduced ? 50 : 1900);
    return () => window.clearTimeout(id);
  }, [crossing, reduced, setCrossing]);

  const bubbles = useMemo(() => {
    const rand = mulberry32(3);
    return Array.from({ length: 54 }, () => {
      const size = 4 + Math.pow(rand(), 2.5) * 34;
      return {
        left: `${rand() * 100}%`,
        width: size,
        height: size,
        ["--dur" as string]: `${1.3 + rand() * 1.5}s`,
        ["--delay" as string]: `${rand() * 0.9}s`,
        ["--dx" as string]: `${(rand() - 0.5) * 120}px`,
      };
    });
  }, []);

  if (crossing === "none") return null;
  const flagshipId = useStore.getState().flagshipId;
  const toSplat = (phase === "flagship" || phase === "splat") && flagshipId;
  const florida = siteById(siteId);
  const f = toSplat ? flagshipById(flagshipId) : null;
  const site = f ? { name: f.name, lat: f.lat, lon: f.lon } : florida;
  const descending = phase !== "ascending" && phase !== "region" && !(phase === "flagship" && crossing === "surface");

  return (
    <div className="dive" data-stage={crossing} aria-hidden="true">
      <div className="dive-water" />
      {!reduced && bubbles.map((style, i) => <span key={i} className="bubble" style={style} />)}
      {descending && (
        <div className="depth-gauge">
          <b>{site.name}</b>
          <span>
            {Math.abs(site.lat).toFixed(4)}° {site.lat < 0 ? "S" : "N"} {Math.abs(site.lon).toFixed(4)}° {site.lon < 0 ? "W" : "E"}
          </span>
        </div>
      )}
    </div>
  );
}
