"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { FLAGSHIPS } from "@/lib/flagshipIndex";
import { HEAT_STOPS } from "@/lib/colors";
import { useStore } from "@/lib/store";
import EvidenceTag from "./EvidenceTag";

interface GlobalReefs {
  rows: (number | null)[][];
}

const YEARS = [2021, 2022, 2023, 2024, 2025];

/** Stressed reefs, and how old the most recent survey of them is in the archive. */
function useGlobalStats(year: number) {
  const [rows, setRows] = useState<(number | null)[][] | null>(null);
  useEffect(() => {
    import("@/data/global-reefs.json").then((m) => setRows((m.default as GlobalReefs).rows));
  }, []);
  return useMemo(() => {
    if (!rows) return null;
    const col = 3 + (year - 2021);
    const withData = rows.filter((r) => r[col] !== null);
    const severe = withData.filter((r) => (r[col] as number) >= 8);
    const last = severe.map((r) => r[8]).filter((v): v is number => v !== null).sort((a, b) => a - b);
    const medianLast = last.length ? last[Math.floor(last.length / 2)] : null;
    return { total: withData.length, severe: severe.length, medianLast, gap: medianLast ? year - medianLast : null };
  }, [rows, year]);
}

export default function WorldHud() {
  const hover = useStore((s) => s.flagshipHover);
  const setHover = useStore((s) => s.setFlagshipHover);
  const openFlagship = useStore((s) => s.openFlagship);
  const setPhase = useStore((s) => s.setPhase);
  const year = useStore((s) => s.worldYear);
  const setYear = useStore((s) => s.setWorldYear);
  const stats = useGlobalStats(year);

  return (
    <div className="hud">
      <aside className="world-panel" aria-label="Flagship reefs">
        <header className="world-title">
          <h2>Reefs change between looks</h2>
          <p>
            Most reefs are surveyed every few years while heat, starfish, storms and fishing overlap in between. These four places have records long enough to
            reconstruct what happened.
          </p>
        </header>
        <nav className="flagship-list">
          {FLAGSHIPS.map((f) => (
            <button
              key={f.id}
              className="flagship-row"
              data-active={hover === f.id}
              onMouseEnter={() => setHover(f.id)}
              onFocus={() => setHover(f.id)}
              onMouseLeave={() => setHover(null)}
              onClick={() => {
                setHover(null);
                if (f.id === "florida") setPhase("flying");
                else openFlagship(f.id);
              }}
            >
              <span className="fr-role">{f.role}</span>
              <span className="fr-name">
                {f.name} <em>{f.place}</em>
              </span>
              <span className="fr-blurb">{f.blurb}</span>
              <span className="fr-record">{f.record}</span>
            </button>
          ))}
        </nav>
      </aside>

      <section className="world-heat" aria-label="Global heat stress layer">
        <header>
          <h3>Peak heat stress, {year}</h3>
          <EvidenceTag kind="satellite" />
        </header>
        <div className="wh-years" role="radiogroup" aria-label="Year">
          {YEARS.map((y) => (
            <button key={y} role="radio" aria-checked={y === year} onClick={() => setYear(y)}>
              {y}
            </button>
          ))}
        </div>
        <div className="wh-ramp" aria-hidden="true">
          <span style={{ background: `linear-gradient(90deg, ${HEAT_STOPS.map(([v, c]) => `${c} ${(v / 20) * 100}%`).join(",")})` }} />
          <div>
            <em>0</em>
            <em style={{ left: "20%" }}>4</em>
            <em style={{ left: "40%" }}>8</em>
            <em style={{ left: "60%" }}>12</em>
            <em style={{ left: "80%" }}>16</em>
            <em style={{ left: "100%" }}>20</em>
          </div>
          <p className="wh-unit">degree heating weeks (°C-weeks)</p>
        </div>
        {stats && (
          <p className="wh-stat">
            <b>{stats.severe.toLocaleString("en-US")}</b> of {stats.total.toLocaleString("en-US")} reefs passed 8 °C-weeks, where severe bleaching is likely.
            {stats.medianLast && (
              <>
                {" "}
                For half of them the latest field survey in this archive is from <b>{stats.medianLast}</b> or earlier.
              </>
            )}
          </p>
        )}
        <p className="side-note">
          2,720 reefs from the supplied bleaching archive (surveys end in 2020), also served from Tiger Cloud. <Link href="/data">Explore the records</Link>.
        </p>
      </section>
    </div>
  );
}
