"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { FLAGSHIPS } from "@/lib/flagshipIndex";
import { HEAT_STOPS } from "@/lib/colors";
import { useStore } from "@/lib/store";
import EvidenceTag from "./EvidenceTag";
import { FORECAST_YEARS, HISTORY_YEARS, fetchHeat, isForecastYear, type HeatYear } from "@/lib/atlasClient";

type Heat = HeatYear | null | "error";

/** One year of the global heat layer; null while loading, "missing" for 2003 and 2026. */
function useHeat(year: number): Heat | "missing" {
  const [state, setState] = useState<{ year: number; heat: HeatYear | null | "error" } | null>(null);
  useEffect(() => {
    let live = true;
    fetchHeat(year).then(
      (heat) => live && setState({ year, heat }),
      () => live && setState({ year, heat: "error" }),
    );
    return () => {
      live = false;
    };
  }, [year]);
  if (!state || state.year !== year) return null;
  return state.heat === null ? "missing" : state.heat;
}

const fmt = (n: number) => n.toLocaleString("en-US");
const pct = (a: number, b: number) => `${Math.round((a / b) * 100)}%`;
const SPAN = HISTORY_YEARS[0];
const LAST = FORECAST_YEARS[1];
// Slider track: the history solid, 2026 empty (in neither dataset), the forecast hatched.
const at = (y: number) => `${((y - SPAN) / (LAST - SPAN)) * 100}%`;
const TRACK = {
  backgroundImage: "linear-gradient(rgba(255,255,255,0.3), rgba(255,255,255,0.3)), repeating-linear-gradient(135deg, rgba(255,255,255,0.4) 0 2px, transparent 2px 5px)",
  backgroundSize: `${at(HISTORY_YEARS[1] + 0.5)} 100%, calc(100% - ${at(FORECAST_YEARS[0] - 0.5)}) 100%`,
  backgroundPosition: "0 0, 100% 0",
};

function HeatSummary({ year, heat }: { year: number; heat: Heat | "missing" }) {
  if (heat === null) return <p className="wh-stat" aria-busy="true">&nbsp;</p>;
  if (heat === "error") return <p className="wh-stat" role="alert">The heat layer is temporarily unavailable.</p>;
  if (heat === "missing")
    return (
      <p className="wh-stat">
        {year === 2026 ? "2026 is in neither dataset: the history ends in 2025 and the forecast starts in 2027." : `The supplied heat history has no values for ${year}.`}
      </p>
    );
  const lastSurvey = heat.stats.severe_median_last_survey && (
    <>
      {" "}
      For half of {heat.kind === "history" ? "them" : `those ${fmt(heat.stats.severe)}`} the latest field survey in this archive is from{" "}
      <b>{heat.stats.severe_median_last_survey}</b> or earlier.
    </>
  );
  if (heat.kind === "history") {
    const { stats } = heat;
    return (
      <>
        <p className="wh-stat">
          <b>{fmt(stats.severe)}</b> of {fmt(stats.reefs)} reefs passed 8 °C-weeks, where severe bleaching is likely.{lastSurvey}
        </p>
        <p className="side-note">
          {stats.observed === stats.reefs
            ? "Every value this year is observed."
            : stats.observed === 0
              ? "Every value this year is an estimate in the supplied history, not an observation."
              : `${pct(stats.observed, stats.reefs)} of values this year are observed; the rest are estimates in the supplied history.`}
        </p>
      </>
    );
  }
  const { stats } = heat;
  const [model, baseline] = heat.skill;
  return (
    <>
      <p className="wh-stat">
        At the central estimate <b>{fmt(stats.severe)}</b> of {fmt(stats.reefs)} reefs pass 8 °C-weeks; <b>{fmt(stats.likely_severe)}</b> have at least an even chance.
        {lastSurvey}
      </p>
      {model && (
        <p className="side-note" title={`Ranks which reefs pass 8 °C-weeks with AUC ${model.aucDhw8.toFixed(2)}${baseline ? ` (baseline ${baseline.aucDhw8.toFixed(2)})` : ""}`}>
          {stats.horizon} {stats.horizon === 1 ? "year" : "years"} ahead, back-tested on {model.origins} past years: average error {model.maeDhw.toFixed(1)} °C-weeks
          {baseline ? ` (repeating the last ten years: ${baseline.maeDhw.toFixed(1)})` : ""}.
          {stats.beyond_history > 0 && ` ${fmt(stats.beyond_history)} reefs are forecast beyond their own history.`}
        </p>
      )}
    </>
  );
}

export default function WorldHud() {
  const hover = useStore((s) => s.flagshipHover);
  const setHover = useStore((s) => s.setFlagshipHover);
  const openFlagship = useStore((s) => s.openFlagship);
  const setPhase = useStore((s) => s.setPhase);
  const year = useStore((s) => s.worldYear);
  const setYear = useStore((s) => s.setWorldYear);
  const heat = useHeat(year);
  const forecast = isForecastYear(year);

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
          {heat && heat !== "error" && heat !== "missing" && (
            <EvidenceTag kind={heat.kind === "forecast" ? "model" : heat.stats.observed === 0 ? "estimated" : "satellite"} />
          )}
        </header>
        <div className="wh-slider">
          <button type="button" aria-label="Previous year" onClick={() => setYear(year - 1)} disabled={year <= SPAN}>
            ‹
          </button>
          <input
            type="range"
            min={SPAN}
            max={LAST}
            step={1}
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            aria-label="Year"
            aria-valuetext={forecast ? `${year}, forecast` : String(year)}
            style={TRACK}
          />
          <button type="button" aria-label="Next year" onClick={() => setYear(year + 1)} disabled={year >= LAST}>
            ›
          </button>
        </div>
        <div className="wh-ticks" aria-hidden="true">
          <em style={{ left: at(SPAN) }}>{SPAN}</em>
          <em style={{ left: at(2000) }}>2000</em>
          <em style={{ left: at(2015) }}>2015</em>
          <em style={{ left: at(LAST) }}>forecast</em>
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
          <p className="wh-unit">peak degree heating weeks (°C-weeks){forecast ? ", model forecast" : ""}</p>
        </div>
        <HeatSummary year={year} heat={heat} />
        <p className="side-note">
          2,720 reefs from the supplied archive (surveys end in 2020): heat history 1985–2025 and forecast 2027–2031, served from Tiger Cloud.{" "}
          <Link href="/data?dataset=history">Explore the records</Link>.
        </p>
      </section>
    </div>
  );
}
