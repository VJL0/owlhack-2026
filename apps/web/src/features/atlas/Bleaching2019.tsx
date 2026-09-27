"use client";

import { useMemo, useState } from "react";
import EvidenceTag from "./EvidenceTag";
import { useDocument } from "@/lib/atlasClient";

type Colony = [x: number, y: number, areaCm2: number, dead: 0 | 1];
interface Data {
  plots: Record<string, { "2018": Colony[]; "2019": Colony[] }>;
  summary: { id: string; live2018: number; dead2018: number; live2019: number; dead2019: number; n2018: number; n2019: number }[];
}

// Orthomosaics were exported at about 0.666 mm per pixel (the scale in their file
// names); only used to size the circles, so the map is to approximate scale.
const CM_PER_PX = 0.0666;
const SIZE = 148;

function PlotMap({ colonies, extent, label }: { colonies: Colony[]; extent: { x0: number; y0: number; span: number }; label: string }) {
  const k = SIZE / extent.span;
  return (
    <figure className="bl-map">
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label={label}>
        <rect width={SIZE} height={SIZE} rx={10} className="bl-bg" />
        {colonies.map((c, i) => {
          const r = Math.max(0.8, (Math.sqrt(c[2] / Math.PI) / CM_PER_PX) * k);
          return <circle key={i} cx={(c[0] - extent.x0) * k} cy={(c[1] - extent.y0) * k} r={r} className={c[3] ? "bl-dead" : "bl-live"} />;
        })}
      </svg>
      <figcaption>{label}</figcaption>
    </figure>
  );
}

/** Kopecky et al. 2023: live and dead Pocillopora segmented in co-registered orthomosaics, August 2018 vs August 2019. */
export default function Bleaching2019() {
  const doc = useDocument<Data>("moorea/bleaching2019");
  const data = doc === "error" ? null : doc;
  const [plot, setPlot] = useState("Plot19");

  const extent = useMemo(() => {
    if (!data) return null;
    const all = [...data.plots[plot]["2018"], ...data.plots[plot]["2019"]];
    const xs = all.map((c) => c[0]);
    const ys = all.map((c) => c[1]);
    const x0 = Math.min(...xs), y0 = Math.min(...ys);
    return { x0, y0, span: Math.max(Math.max(...xs) - x0, Math.max(...ys) - y0) * 1.04 };
  }, [data, plot]);

  if (doc === "error") return <section className="side-card"><p className="side-note" role="alert">The 2019 bleaching maps are temporarily unavailable.</p></section>;
  if (!data || !extent) return <section className="side-card" aria-busy="true" />;
  const s = data.summary.find((p) => p.id === plot)!;
  const lossPct = Math.round((1 - s.live2019 / s.live2018) * 100);

  return (
    <section className="side-card">
      <header>
        <h3>The 2019 bleaching, colony by colony</h3>
        <EvidenceTag kind="field" />
      </header>
      <p className="side-sub">
        Five permanent 25 m² plots on the north-shore forereef, photographed from the same positions in August 2018 and August 2019 and traced colony by
        colony. <span className="bl-key live">live</span> <span className="bl-key dead">dead</span> <i>Pocillopora</i>.
      </p>
      <div className="bl-plots" role="radiogroup" aria-label="Plot">
        {data.summary.map((p) => (
          <button key={p.id} role="radio" aria-checked={p.id === plot} onClick={() => setPlot(p.id)}>
            {p.id.replace("Plot", "")}
          </button>
        ))}
      </div>
      <div className="bl-pair">
        <PlotMap colonies={data.plots[plot]["2018"]} extent={extent} label="Aug 2018" />
        <PlotMap colonies={data.plots[plot]["2019"]} extent={extent} label="Aug 2019" />
      </div>
      <p className="bl-stat">
        Live coral in this plot: <b>{s.live2018.toFixed(1)} m²</b> → <b>{s.live2019.toFixed(1)} m²</b> ({lossPct > 0 ? `−${lossPct}%` : `+${-lossPct}%`}). Dead
        skeleton: {s.dead2018.toFixed(1)} → {s.dead2019.toFixed(1)} m².
      </p>
      <p className="side-note">
        The orthomosaics are not public; these outlines are the published segmentation (knb-lter-mcr.5050). Circle size is approximate.
      </p>
    </section>
  );
}
