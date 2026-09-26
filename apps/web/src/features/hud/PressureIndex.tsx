"use client";

import { useMemo } from "react";
import { snapshot } from "@/lib/data";
import { predict, PAIRS, PRESSURES } from "@/lib/model";
import { PAIR_DEFS, PRESSURE_DEFS } from "@/lib/pressures";
import { useStore } from "@/lib/store";
import ProvenanceGlyph from "./ProvenanceGlyph";

const pp = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}`;

/** Keyboard- and screen-reader-friendly way into the constellation. */
export default function PressureIndex() {
  const siteId = useStore((s) => s.siteId);
  const day = useStore((s) => Math.floor(s.t));
  const selection = useStore((s) => s.selection);
  const select = useStore((s) => s.select);
  const setHover = useStore((s) => s.setHover);
  const model = useMemo(() => predict(snapshot(siteId, day)), [siteId, day]);

  return (
    <nav className="pressure-index" aria-label="Pressures and model interactions">
      <p className="pi-head">Pressures, model contribution in pp</p>
      {PRESSURES.map((p) => (
        <button
          key={p}
          className="pi-row"
          aria-pressed={selection?.kind === "pressure" && selection.id === p}
          onClick={() => select({ kind: "pressure", id: p })}
          onMouseEnter={() => setHover({ kind: "pressure", id: p })}
          onMouseLeave={() => setHover(null)}
          onFocus={() => setHover({ kind: "pressure", id: p })}
          onBlur={() => setHover(null)}
        >
          <span className="pi-swatch" style={{ background: PRESSURE_DEFS[p].color }} aria-hidden="true" />
          <span className="pi-name">{PRESSURE_DEFS[p].name}</span>
          <ProvenanceGlyph kind={PRESSURE_DEFS[p].provenance} />
          <span className="pi-val">{pp(model.contributionPP[p])}</span>
        </button>
      ))}
      <p className="pi-head">Where pressures coincide, log-odds</p>
      {PAIRS.map((pair) => (
        <button
          key={pair}
          className="pi-row"
          aria-pressed={selection?.kind === "pair" && selection.id === pair}
          onClick={() => select({ kind: "pair", id: pair })}
          onMouseEnter={() => setHover({ kind: "pair", id: pair })}
          onMouseLeave={() => setHover(null)}
          onFocus={() => setHover({ kind: "pair", id: pair })}
          onBlur={() => setHover(null)}
        >
          <span className="pi-pair" aria-hidden="true">
            {pair.split(":").map((p) => (
              <i key={p} style={{ background: PRESSURE_DEFS[p as keyof typeof PRESSURE_DEFS].color }} />
            ))}
          </span>
          <span className="pi-name">{PAIR_DEFS[pair].name}</span>
          <ProvenanceGlyph kind="model" />
          <span className="pi-val">{model.interaction[pair] >= 0 ? "+" : "−"}{Math.abs(model.interaction[pair]).toFixed(2)}</span>
        </button>
      ))}
    </nav>
  );
}
