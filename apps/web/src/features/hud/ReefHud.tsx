"use client";

import { BAA_LABELS, nearestActiveStorm, siteById, simulatedAt, stormExposure, thermalAt, lionfishNear } from "@/lib/data";
import { heatColor } from "@/lib/colors";
import { momentText } from "@/lib/narrative";
import { useStore } from "@/lib/store";
import ProvenanceGlyph from "./ProvenanceGlyph";
import Caption from "./Caption";
import EvidenceSlate from "./EvidenceSlate";
import PressureIndex from "./PressureIndex";

function fmtCoord(v: number, pos: string, neg: string) {
  return `${Math.abs(v).toFixed(4)}° ${v >= 0 ? pos : neg}`;
}

export default function ReefHud({ onAscend }: { onAscend: () => void }) {
  const siteId = useStore((s) => s.siteId);
  const t = useStore((s) => s.t);
  const pressuresOpen = useStore((s) => s.pressuresOpen);
  const setPressuresOpen = useStore((s) => s.setPressuresOpen);
  const selection = useStore((s) => s.selection);

  const site = siteById(siteId);
  const th = thermalAt(siteId, t);
  const storm = nearestActiveStorm(siteId, t, 400);
  const exposure = stormExposure(siteId, t);
  const lion = lionfishNear(siteId, t).length;
  const sim = simulatedAt(siteId, t);
  const moment = momentText(siteId, t);
  const alert = BAA_LABELS[th.baa] ?? "";

  return (
    <div className="hud" data-pressures={pressuresOpen} data-selection={!!selection}>
      <div className="reef-id">
        <h2>{site.name}</h2>
        <div className="coords">
          <span>{fmtCoord(site.lat, "N", "S")}</span>
          <span>{fmtCoord(site.lon, "E", "W")}</span>
          <span>{site.region}</span>
        </div>
        {site.designation && <p className="designation">{site.designation}</p>}
      </div>

      {/* On phones the conditions and the caption share one dock above the actions */}
      <div className="reef-dock">
        <section className="gauges" aria-label="Conditions at this date" style={{ opacity: selection ? 0 : 1, pointerEvents: selection ? "none" : undefined, transition: "opacity 300ms" }}>
          <div>
            <div className="gauge-label">
              <ProvenanceGlyph kind="observed" />
              Heat stress
            </div>
            <div className="gauge-value" style={{ color: heatColor(th.dhw) }}>
              {th.dhw.toFixed(1)}
              <small>°C-weeks</small>
            </div>
            <div className="gauge-alert" style={{ color: heatColor(th.dhw) }}>
              {alert}
            </div>
            <div className="gauge-note">
              SST {th.sst.toFixed(1)} °C, {th.ssta >= 0 ? "+" : "−"}
              {Math.abs(th.ssta).toFixed(1)} °C vs normal
            </div>
          </div>

          <dl className="gauge-minor">
            <dt>
              Hurricane <ProvenanceGlyph kind="observed" />
            </dt>
            <dd>
              {storm
                ? `${storm.storm.name}, ${Math.round(storm.km)} km`
                : exposure.count
                  ? `${exposure.storms[exposure.storms.length - 1].name}, ${exposure.nearestKm} km`
                  : "none, 12 mo"}
            </dd>
            <dt>
              Lionfish records <ProvenanceGlyph kind="observed" />
            </dt>
            <dd>{lion} in 12 mo</dd>
            <dt>
              AIS fishing <ProvenanceGlyph kind="simulated" />
            </dt>
            <dd>{sim.fishingHours90d.toFixed(0)} h, 90 d</dd>
            <dt>
              SAR detections <ProvenanceGlyph kind="simulated" />
            </dt>
            <dd>
              {sim.sar90d}, {sim.sarUnmatched90d} unmatched
            </dd>
          </dl>
        </section>

        {pressuresOpen ? <PressureIndex /> : <Caption id={`${moment.key}-${siteId}`} text={moment.text} note={moment.note} />}
        {lion > 0 && !pressuresOpen && (
          <p className="reef-dock-note">
            <ProvenanceGlyph kind="observed" /> {lion} lionfish record{lion === 1 ? "" : "s"} within 25 km, past 12 months (USGS NAS). Fish shown are
            illustrative.
          </p>
        )}
      </div>

      <div className="provenance-key" aria-label="Legend">
        <span>
          <ProvenanceGlyph kind="observed" title={false} /> observed
        </span>
        <span>
          <ProvenanceGlyph kind="model" title={false} /> model
        </span>
        <span>
          <ProvenanceGlyph kind="simulated" title={false} /> simulated
        </span>
      </div>

      <div className="reef-actions">
        <button className="btn-instrument" aria-pressed={pressuresOpen} onClick={() => setPressuresOpen(!pressuresOpen)}>
          {pressuresOpen ? "Hide pressures" : "Show pressures"} <span className="kbd">P</span>
        </button>
        <button className="btn-instrument" onClick={onAscend}>
          Return to surface <span className="kbd">Esc</span>
        </button>
      </div>

      {selection && <EvidenceSlate />}

      <p className="sr-only" aria-live="polite">
        {site.name}, {moment.text}
      </p>
    </div>
  );
}
