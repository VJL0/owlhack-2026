"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import { useDocument } from "@/lib/atlasClient";
import type { SplatSurvey } from "@/lib/flagships";
import { exitSplat } from "@/lib/navigation";
import { useStore } from "@/lib/store";
import EvidenceTag from "@/features/atlas/EvidenceTag";

const SplatScene = dynamic(() => import("./SplatScene"), { ssr: false });

const PLOT_NAMES: Record<string, string> = { hb: "Host Beach reef flat", ootsl1: "OOTS L slope" };
type LoadState = { state: "loading" | "ready" | "error"; progress?: number };

const long = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

export default function SplatView() {
  const plot = useStore((s) => s.splatPlot);
  const index = useStore((s) => s.splatIndex);
  const setSplat = useStore((s) => s.setSplat);
  const reduced = useStore((s) => s.reducedMotion);
  const manifest = useDocument<{ plots: Record<string, { frame: { box: { x: number[]; y: number[]; z: number[] }; origin: number[] }; surveys: SplatSurvey[] }> }>("soneva/splats");
  const entry = manifest && manifest !== "error" ? manifest.plots[plot] : undefined;
  const surveys = entry?.surveys ?? [];
  const [loads, setLoads] = useState<Record<string, LoadState>>({});
  const [blink, setBlink] = useState<number | null>(null);

  const onState = useCallback((file: string, state: LoadState["state"], progress?: number) => {
    setLoads((m) => (m[file]?.state === state && m[file]?.progress === progress ? m : { ...m, [file]: { state, progress } }));
    if (state === "ready") useStore.getState().setReefReady(true);
  }, []);

  useEffect(() => () => useStore.getState().setReefReady(false), []);

  // Keys: ←/→ change survey, B holds the previous survey for comparison, Esc goes back up.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, textarea")) return;
      const s = useStore.getState();
      if (e.key === "Escape") {
        e.preventDefault();
        exitSplat();
      } else if (e.key === "ArrowRight") s.setSplat(s.splatPlot, Math.min(surveys.length - 1, s.splatIndex + 1));
      else if (e.key === "ArrowLeft") s.setSplat(s.splatPlot, Math.max(0, s.splatIndex - 1));
      else if ((e.key === "b" || e.key === "B") && !e.repeat) setBlink(s.splatIndex === 0 ? surveys.length - 1 : 0);
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === "b" || e.key === "B") setBlink(null);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [surveys.length]);

  if (manifest === "error")
    return (
      <p className="boot" role="alert">
        The 3D survey list is temporarily unavailable. Reload the page to try again.
      </p>
    );
  if (!entry) return null;
  const shown = blink ?? index;
  const cur = surveys[shown];
  const load = loads[surveys[index]?.file];
  const box = entry.frame.box;
  const extent = Math.max(box.x[1] - box.x[0], box.y[1] - box.y[0]);

  return (
    <div className="stage-layer splat-stage">
      <SplatScene surveys={surveys} index={shown} reduced={reduced} onState={onState} extent={extent} />
      <div className="hud splat-hud">
        <div className="reef-id">
          <p className="dz-role">Soneva Fushi · Baa Atoll, Maldives</p>
          <h2>{PLOT_NAMES[plot] ?? plot}</h2>
          <div className="coords">
            <span>{long(cur.date)}</span>
            <span>{cur.splats.toLocaleString("en-US")} splats</span>
            <span>about {Math.round(extent)} × {Math.round(extent)} m</span>
          </div>
        </div>

        <section className="splat-panel" aria-label="Survey dates">
          <header>
            <h3>Survey</h3>
            <EvidenceTag kind="field" />
          </header>
          <div className="splat-dates" role="radiogroup" aria-label="Survey date">
            {surveys.map((s, i) => {
              const l = loads[s.file];
              return (
                <button key={s.file} role="radio" aria-checked={i === index} onClick={() => setSplat(plot, i)}>
                  <b>{long(s.date)}</b>
                  <span>{l?.state === "ready" ? `${(s.bytes / 1e6).toFixed(1)} MB` : l?.state === "error" ? "failed to load" : `loading ${Math.round((l?.progress ?? 0) * 100)}%`}</span>
                </button>
              );
            })}
          </div>
          <button
            className="btn-instrument splat-blink"
            onPointerDown={() => setBlink(index === 0 ? surveys.length - 1 : 0)}
            onPointerUp={() => setBlink(null)}
            onPointerLeave={() => setBlink(null)}
          >
            Hold to compare with {index === 0 ? "the last" : "the first"} survey <span className="kbd">B</span>
          </button>
          <p className="side-note">
            Drag to orbit, scroll to zoom. The same colony stays in the same place across dates; lighting and water clarity change between dives, so compare
            shapes, not colours.
          </p>
        </section>

        {load?.state !== "ready" && (
          <p className="splat-loading" aria-live="polite">
            Loading the {long(surveys[index].date)} survey… {Math.round((load?.progress ?? 0) * 100)}%
          </p>
        )}

        <div className="reef-actions">
          <button className="btn-instrument" onClick={exitSplat}>
            Back to the dossier <span className="kbd">Esc</span>
          </button>
        </div>

        <p className="splat-credit">
          3D reconstruction: Soneva Conservation and Sustainability Maldives and Wildflow, CC BY 4.0 (huggingface.co/datasets/wildflow/soneva-corals).
          Converted to SPZ by Reef Atlas; colours are the splats&rsquo; base colour.
        </p>
      </div>
    </div>
  );
}
