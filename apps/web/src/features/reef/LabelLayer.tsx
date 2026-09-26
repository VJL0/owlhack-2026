"use client";

// DOM labels for the reef scene. 3D components publish anchors (labels.ts);
// this layer projects them with the live camera every frame. Plain React DOM,
// so text stays crisp and accessible and nothing mounts React roots inside R3F.

import { useEffect, useMemo, useRef } from "react";
import { Vector3 } from "three";
import { useStore } from "@/lib/store";
import { lionfishNear, siteById, snapshot } from "@/lib/data";
import { predict, PAIRS, PRESSURES } from "@/lib/model";
import { PRESSURE_DEFS } from "@/lib/pressures";
import ProvenanceGlyph from "@/features/hud/ProvenanceGlyph";
import { anchors, bridge } from "./labels";

const fmtPP = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)} pp`;
const LEFT = new Set(["node:fishing"]);

export default function LabelLayer() {
  const open = useStore((s) => s.pressuresOpen);
  const siteId = useStore((s) => s.siteId);
  const day = useStore((s) => Math.floor(s.t));
  const hover = useStore((s) => s.hover);
  const selection = useStore((s) => s.selection);
  const lionCount = useStore((s) => lionfishNear(s.siteId, s.t).length);

  const snap = useMemo(() => snapshot(siteId, day), [siteId, day]);
  const model = useMemo(() => predict(snap), [snap]);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let raf = 0;
    const v = new Vector3();
    const tick = () => {
      const cam = bridge.camera;
      if (cam && root.current) {
        root.current.querySelectorAll<HTMLElement>("[data-anchor]").forEach((el) => {
          const a = anchors.get(el.dataset.anchor!);
          if (!a) {
            el.style.opacity = "0";
            return;
          }
          v.copy(a.pos).project(cam);
          const behind = v.z > 1 || v.z < -1;
          const x = (v.x * 0.5 + 0.5) * bridge.width;
          const y = (-v.y * 0.5 + 0.5) * bridge.height;
          el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
          const want = a.visible && !behind && el.dataset.show !== "0";
          el.style.opacity = want ? "1" : "0";
        });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const valueText = {
    heat: `${snap.maxDhw84d.toFixed(1)} DHW, 84-day max`,
    fishing: `${snap.fishingHours90d.toFixed(0)} h in 90 days`,
    lionfish: `${snap.lionfish365d} record${snap.lionfish365d === 1 ? "" : "s"} in 12 months`,
    storm: snap.stormNearestKm365d == null ? "none within 150 km" : `${snap.stormMaxWind365d} kt, ${snap.stormNearestKm365d} km away`,
  };

  return (
    <div ref={root} className="label-layer" aria-hidden={!open}>
      {PRESSURES.map((p) => {
        const id = `node:${p}`;
        const left = LEFT.has(id);
        return (
          <div key={id} data-anchor={id} className="anchor" data-show={open ? "1" : "0"}>
            <div className={`node-label${left ? " left" : ""}`}>
              {PRESSURE_DEFS[p].name}
              <span className="v">
                <ProvenanceGlyph kind={PRESSURE_DEFS[p].provenance} />
                {valueText[p]}
              </span>
              <span className="v">
                <ProvenanceGlyph kind="model" />
                {fmtPP(model.contributionPP[p])} to bleaching probability
              </span>
            </div>
          </div>
        );
      })}

      <div data-anchor="core" className="anchor" data-show={open ? "1" : "0"}>
        <div className="node-label center">
          {siteById(siteId).name}
          <span className="v">
            <ProvenanceGlyph kind="model" />
            bleaching probability {(model.probability * 100).toFixed(0)}%
          </span>
        </div>
      </div>

      {PAIRS.map((pair) => {
        const id = `pair:${pair}`;
        const show = open && ((hover?.kind === "pair" && hover.id === pair) || (selection?.kind === "pair" && selection.id === pair));
        const v = model.interaction[pair];
        return (
          <div key={id} data-anchor={id} className="anchor" data-show={show ? "1" : "0"}>
            <div className="node-label center above">
              <span className="v" style={{ color: "var(--bone)" }}>
                <ProvenanceGlyph kind="model" />
                interaction {v >= 0 ? "+" : "−"}
                {Math.abs(v).toFixed(2)} log-odds
              </span>
            </div>
          </div>
        );
      })}

      <div data-anchor="lionfish-zone" className="anchor" data-show={lionCount > 0 && !open ? "1" : "0"}>
        <div className="zone-label">
          {lionCount} lionfish record{lionCount === 1 ? "" : "s"} within 25 km, past 12 months
          <br />
          <span style={{ opacity: 0.7 }}>USGS NAS. Fish shown are illustrative.</span>
        </div>
      </div>
    </div>
  );
}
