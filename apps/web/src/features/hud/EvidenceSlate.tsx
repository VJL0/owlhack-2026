"use client";

import { useMemo } from "react";
import { motion } from "motion/react";
import { BAA_LABELS, META, lionfishNear, siteById, simulatedAt, snapshot, stormExposure, thermalAt } from "@/lib/data";
import { predict, type Pressure } from "@/lib/model";
import { PAIR_DEFS, PRESSURE_DEFS, pairReading } from "@/lib/pressures";
import { useStore } from "@/lib/store";
import { formatDate, formatMonth } from "@/lib/time";
import ProvenanceGlyph from "./ProvenanceGlyph";

const pp = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)} pp`;

export default function EvidenceSlate() {
  const selection = useStore((s) => s.selection);
  const select = useStore((s) => s.select);
  const siteId = useStore((s) => s.siteId);
  const week = useStore((s) => Math.floor(s.t));
  const t = useStore((s) => s.t);

  const snap = useMemo(() => snapshot(siteId, week), [siteId, week]);
  const model = useMemo(() => predict(snap), [snap]);
  if (!selection) return null;
  const site = siteById(siteId);

  const figure = (p: Pressure) => {
    switch (p) {
      case "heat":
        return { value: snap.maxDhw84d.toFixed(1), unit: "°C-weeks, 84-day max" };
      case "fishing":
        return { value: snap.fishingHours90d.toFixed(0), unit: "AIS fishing hours, 90 days" };
      case "lionfish":
        return { value: String(snap.lionfish365d), unit: "records within 25 km, 12 months" };
      case "storm":
        return snap.stormNearestKm365d == null
          ? { value: "0", unit: "storms within 150 km, 12 months" }
          : { value: `${snap.stormMaxWind365d}`, unit: `kt, closest pass ${snap.stormNearestKm365d} km` };
    }
  };

  const details = (p: Pressure): [string, string][] => {
    if (p === "heat") {
      const th = thermalAt(siteId, t);
      return [
        ["Degree heating weeks now", th.dhw.toFixed(1)],
        ["Alert level", BAA_LABELS[th.baa]],
        ["Sea-surface temperature", `${th.sst.toFixed(2)} °C`],
        ["Anomaly vs climatology", `${th.ssta >= 0 ? "+" : "−"}${Math.abs(th.ssta).toFixed(2)} °C`],
        ["Satellite sample", th.sampleDate],
      ];
    }
    if (p === "fishing") {
      const sim = simulatedAt(siteId, t);
      return [
        ["AIS fishing, this month", `${sim.fishingHours30d.toFixed(0)} h`],
        ["AIS vessel presence, 30 d", `${sim.vesselHours30d.toFixed(0)} h`],
        ["SAR detections, 90 d", String(sim.sar90d)],
        ["Unmatched to AIS", String(sim.sarUnmatched90d)],
      ];
    }
    if (p === "lionfish") {
      const recs = lionfishNear(siteId, t);
      const last = recs[recs.length - 1];
      return [
        ["Records, 12 months", String(recs.length)],
        ["Most recent", last ? `${formatDate(last.t)}` : "none"],
        ["Where", last ? `${last.locality || "unspecified"}, ${last.km[siteId]} km` : "—"],
      ];
    }
    const ex = stormExposure(siteId, t);
    if (!ex.storms.length) return [["Storms within 150 km, 12 months", "none"]];
    return ex.storms.map((s) => [`${s.name}, ${formatDate(s.t)}`, `${s.km} km, ${s.wind} kt`] as [string, string]);
  };

  let body: React.ReactNode;
  if (selection.kind === "pressure") {
    const def = PRESSURE_DEFS[selection.id];
    const f = figure(selection.id);
    body = (
      <>
        <div className="slate-kind">
          <ProvenanceGlyph kind={def.provenance} />
          {def.provenance === "simulated" ? "Pressure, simulated data" : "Pressure, observed data"}
        </div>
        <h3 style={{ color: def.color }}>{def.name}</h3>
        <div className="figure">
          {f.value}
          <small>{f.unit}</small>
        </div>
        <p>{def.measure}.</p>
        <dl>
          <dt style={{ display: "flex", gap: 7, alignItems: "center" }}>
            <ProvenanceGlyph kind="model" /> Model contribution
          </dt>
          <dd>{pp(model.contributionPP[selection.id])}</dd>
          {details(selection.id).map(([k, v]) => (
            <FragmentRow key={k} k={k} v={v} />
          ))}
        </dl>
        <p className="caveat">{def.caveat}</p>
        <div className="sources">
          <span>
            <ProvenanceGlyph kind={def.provenance} /> {def.source}
          </span>
          <span>
            <ProvenanceGlyph kind="model" /> Demo model, hand-set weights, not yet trained on NCRMP surveys
          </span>
        </div>
      </>
    );
  } else {
    const def = PAIR_DEFS[selection.id];
    const [a, b] = selection.id.split(":") as [Pressure, Pressure];
    const v = model.interaction[selection.id];
    body = (
      <>
        <div className="slate-kind">
          <ProvenanceGlyph kind="model" />
          Model interaction
        </div>
        <h3>{def.name}</h3>
        <div className="figure">
          {v >= 0 ? "+" : "−"}
          {Math.abs(v).toFixed(2)}
          <small>log-odds, {formatMonth(week)}</small>
        </div>
        <p>{def.question}</p>
        <p>{pairReading(v)}</p>
        <dl>
          <dt>{PRESSURE_DEFS[a].name}</dt>
          <dd>{figure(a).value}</dd>
          <dt>{PRESSURE_DEFS[b].name}</dt>
          <dd>{figure(b).value}</dd>
          <dt>Bleaching probability</dt>
          <dd>{(model.probability * 100).toFixed(0)}%</dd>
        </dl>
        <p className="caveat">
          An interaction means the model scores one pressure differently depending on the other. It describes the model, not a
          mechanism on the reef: these pressures were observed together, which is association, not causation.
        </p>
        <div className="sources">
          <span>
            <ProvenanceGlyph kind={PRESSURE_DEFS[a].provenance} /> {PRESSURE_DEFS[a].source}
          </span>
          <span>
            <ProvenanceGlyph kind={PRESSURE_DEFS[b].provenance} /> {PRESSURE_DEFS[b].source}
          </span>
          <span>
            <ProvenanceGlyph kind="model" /> Demo model, exact Shapley interaction values
          </span>
        </div>
      </>
    );
  }

  return (
    <motion.aside
      key={selection.kind + selection.id}
      className="slate"
      aria-label={`Evidence for ${site.name}`}
      initial={{ opacity: 0, x: 24 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
    >
      <button className="slate-close" onClick={() => select(null)} aria-label="Close evidence">
        ×
      </button>
      {body}
      <p className="mono" style={{ marginTop: 14, fontSize: 10, color: "rgba(169,216,208,0.55)" }}>
        Data retrieved {META.generated}. Associations, not causes.
      </p>
    </motion.aside>
  );
}

function FragmentRow({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt>{k}</dt>
      <dd>{v}</dd>
    </>
  );
}
