"use client";

import { SITES, thermalAt } from "@/lib/data";
import { heatColor } from "@/lib/colors";
import { useStore } from "@/lib/store";
import ProvenanceGlyph from "./ProvenanceGlyph";
import { murAnomalyDate } from "@/lib/gibs";
import { isoDate } from "@/lib/time";

const LAYERS = [
  { key: "sst", name: "Sea temperature anomaly", src: "NASA MUR", swatch: "#ff8a4c" },
  { key: "storms", name: "Hurricane tracks", src: "NOAA HURDAT2", swatch: "#b8a8ff" },
  { key: "lionfish", name: "Lionfish records", src: "USGS NAS", swatch: "#ff5f8f" },
] as const;

export default function RegionHud() {
  const t = useStore((s) => s.t);
  const siteId = useStore((s) => s.siteId);
  const layers = useStore((s) => s.layers);
  const toggleLayer = useStore((s) => s.toggleLayer);
  const setSite = useStore((s) => s.setSite);
  const setPhase = useStore((s) => s.setPhase);

  return (
    <div className="hud">
      <div className="region-panel">
        <button className="btn-chip region-back" onClick={() => setPhase("world")}>
          ← All flagship reefs <span className="sr-only">(Esc)</span>
        </button>
        <div className="region-title">
          <h2>Florida&rsquo;s Coral Reef</h2>
          <p>
            About 350 miles from the Dry Tortugas to St.&nbsp;Lucie Inlet: the only coral barrier reef in the continental
            United States. Scrub through time, then choose a reef.
          </p>
        </div>

      <nav className="site-index" aria-label="Reef sites">
        <div className="site-index-head" aria-hidden="true">
          <span>Reef, north to south-west</span>
          <span>DHW</span>
        </div>
        {SITES.map((s) => {
          const dhw = thermalAt(s.id, t).dhw;
          return (
            <button
              key={s.id}
              className="site-row"
              data-active={s.id === siteId}
              onMouseEnter={() => setSite(s.id)}
              onFocus={() => setSite(s.id)}
              onClick={() => {
                setSite(s.id);
                setPhase("diving");
              }}
              aria-label={`Dive to ${s.name}, ${s.region}. Heat stress ${dhw.toFixed(1)} degree heating weeks.`}
            >
              <span>
                <span className="name">{s.name}</span>
                <span className="region">{s.region}</span>
              </span>
              <span className="bar" aria-hidden="true">
                <i style={{ width: `${Math.min(100, (dhw / 20) * 100)}%`, background: heatColor(dhw) }} />
              </span>
              <span className="val" aria-hidden="true">
                {dhw.toFixed(1)}
              </span>
            </button>
          );
        })}
      </nav>
      </div>

      <div className="layers" role="group" aria-label="Map layers">
        {layers.sst && !murAnomalyDate(isoDate(t)) && (
          <p className="mono" style={{ fontSize: 10, color: "rgba(169,216,208,0.6)", marginBottom: 6, marginRight: 12 }}>
            NASA MUR anomaly layer starts July 2019
          </p>
        )}
        {layers.sst && murAnomalyDate(isoDate(t)) && (
          <p className="mono" style={{ fontSize: 10, color: "rgba(169,216,208,0.6)", marginBottom: 6, marginRight: 12 }}>
            Cooler <span style={{ display: "inline-block", width: 70, height: 4, verticalAlign: "middle", borderRadius: 2, margin: "0 6px", background: "linear-gradient(90deg,#3b6fd6,#e8eef2,#e0423a)" }} /> warmer than normal
          </p>
        )}
        {LAYERS.map((l) => (
          <button
            key={l.key}
            role="switch"
            aria-checked={layers[l.key]}
            className="layer-toggle"
            style={{ ["--swatch" as string]: l.swatch }}
            onClick={() => toggleLayer(l.key)}
          >
            <span>{l.name}</span>
            <span className="src">
              <ProvenanceGlyph kind="observed" size={8} title={false} /> {l.src}
            </span>
            <span className="sw" aria-hidden="true" />
          </button>
        ))}
      </div>
    </div>
  );
}
