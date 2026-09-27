"use client";

import { useEffect, useRef, useState } from "react";
import { LAGOON_STOPS } from "@/lib/colors";
import { formatYear } from "@/lib/flagships";
import { useStore } from "@/lib/store";
import { fetchDocument } from "@/lib/atlasClient";
import EvidenceTag from "./EvidenceTag";

interface Lagoon {
  weeks: number[];
  sites: { id: string }[];
  temps: Record<string, (number | null)[]>;
}

/** Moorea's 49 lagoon thermistors, drawn on the globe for the week under the timeline cursor. */
export default function LagoonLegend() {
  const t = useStore((s) => s.flagshipT);
  const setT = useStore((s) => s.setFlagshipT);
  const reduced = useStore((s) => s.reducedMotion);
  const [lagoon, setLagoon] = useState<Lagoon | null>(null);
  const [playing, setPlaying] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    fetchDocument<Lagoon>("moorea/lagoon").then(setLagoon, () => {}); // the globe layer is optional here
  }, []);

  useEffect(() => {
    if (!playing || !lagoon) return;
    const step = () => {
      const s = useStore.getState();
      const cur = s.flagshipT ?? lagoon.weeks[0];
      const next = cur + 7 / 365.25;
      if (next > lagoon.weeks[lagoon.weeks.length - 1]) {
        setPlaying(false);
        return;
      }
      s.setFlagshipT(next < lagoon.weeks[0] ? lagoon.weeks[0] : next);
      timer.current = window.setTimeout(step, reduced ? 260 : 110);
    };
    step();
    return () => window.clearTimeout(timer.current);
  }, [playing, lagoon, reduced]);

  if (!lagoon) return null;
  const first = lagoon.weeks[0];
  const last = lagoon.weeks[lagoon.weeks.length - 1];
  const inRange = t !== null && t >= first - 0.02 && t <= last + 0.02;

  // The hottest week in the island-wide mean: where to look first.
  const islandMean = lagoon.weeks.map((_, i) => {
    const v = lagoon.sites.map((s) => lagoon.temps[s.id]?.[i]).filter((x): x is number => x != null);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0;
  });
  const hottest = islandMean.indexOf(Math.max(...islandMean));
  const idx = inRange ? lagoon.weeks.reduce((b, w, i) => (Math.abs(w - t!) < Math.abs(lagoon.weeks[b] - t!) ? i : b), 0) : -1;
  const readings = idx >= 0 ? lagoon.sites.map((s) => lagoon.temps[s.id]?.[idx]).filter((x): x is number => x != null) : [];

  return (
    <section className="side-card">
      <header>
        <h3>Heat in the lagoon, sensor by sensor</h3>
        <EvidenceTag kind="sensor" />
      </header>
      <p className="side-sub">
        {lagoon.sites.length} thermistors on the lagoon floor, logging every 2 minutes since {formatYear(first)}. The dots on the island show the week under
        the timeline cursor.
      </p>
      <div className="lg-ramp" aria-hidden="true">
        <span style={{ background: `linear-gradient(90deg, ${LAGOON_STOPS.map(([, c]) => c).join(",")})` }} />
        <div>
          {LAGOON_STOPS.map(([v]) => (
            <em key={v}>{v}°</em>
          ))}
        </div>
      </div>
      <p className="lg-read" aria-live="polite">
        {inRange && readings.length
          ? `${formatYear(lagoon.weeks[idx])}: ${readings.length} sensors, ${Math.min(...readings).toFixed(1)}–${Math.max(...readings).toFixed(1)} °C (weekly mean of daily maxima)`
          : `The network starts in ${formatYear(first)}; move the cursor later to see it.`}
      </p>
      <div className="side-actions">
        <button className="btn-chip" onClick={() => setT(lagoon.weeks[hottest])}>
          Hottest week: {formatYear(lagoon.weeks[hottest])}
        </button>
        <button
          className="btn-chip"
          aria-pressed={playing}
          onClick={() => {
            if (!playing && (t === null || t < first || t >= last)) setT(first);
            setPlaying(!playing);
          }}
        >
          {playing ? "Pause" : "Play 2021–2025"}
        </button>
      </div>
    </section>
  );
}
