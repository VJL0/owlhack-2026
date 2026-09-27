"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { type Change, type Dossier as DossierData, type Presence } from "@/lib/flagships";
import { loadDossier } from "@/lib/atlasClient";
import { useStore } from "@/lib/store";
import { SPRING } from "@/lib/ui";
import EvidenceTag from "./EvidenceTag";
import EvidenceTimeline from "./EvidenceTimeline";
import Bleaching2019 from "./Bleaching2019";
import LagoonLegend from "./LagoonLegend";
import DisturbanceLog from "./DisturbanceLog";
import SonevaCard from "./SonevaCard";

const PRESENCE: Record<Presence, string> = { present: "present", absent: "not seen", "not measured": "not measured" };

function DriverTable({ c }: { c: Change }) {
  return (
    <div className="drivers">
      <p className="drivers-head">What the other records show in that interval</p>
      <ul>
        {c.drivers.map((d) => (
          <li key={d.driver} data-presence={d.presence}>
            <span className="drv-name">{d.driver}</span>
            <span className="drv-pill">{PRESENCE[d.presence]}</span>
            <span className="drv-value">
              {d.value} <EvidenceTag kind={d.evidence} compact />
            </span>
          </li>
        ))}
      </ul>
      <p className="drivers-foot">Showing what co-occurred, not what caused the loss.</p>
    </div>
  );
}

function Changes({ d, selected, onSelect }: { d: DossierData; selected: Change | null; onSelect: (c: Change | null) => void }) {
  if (!d.changes.length) return null;
  const max = Math.max(...d.changes.map((c) => c.before));
  return (
    <section className="dz-section">
      <h3>What changed</h3>
      <p className="dz-sub">Every drop of at least 3 points (or 30%) between two consecutive surveys.</p>
      <ol className="changes">
        {d.changes.map((c) => {
          const open = selected?.id === c.id;
          return (
            <li key={c.id} data-open={open}>
              <button
                className="change-row"
                aria-expanded={open}
                onClick={() => {
                  onSelect(open ? null : c);
                  useStore.getState().setFlagshipT(c.t1);
                }}
              >
                <span className="change-when">
                  {c.title.split(":")[0]}
                </span>
                <span className="change-bar" aria-hidden="true">
                  <i style={{ left: `${(c.after / max) * 100}%`, width: `${((c.before - c.after) / max) * 100}%` }} />
                  <b style={{ width: `${(c.after / max) * 100}%` }} />
                </span>
                <span className="change-val">
                  {c.before}→{c.after}
                  {c.unit}
                </span>
              </button>
              {open && (
                <div className="change-body" ref={(el) => el?.scrollIntoView({ block: "nearest", behavior: "smooth" })}>
                  <p>{c.summary}</p>
                  <DriverTable c={c} />
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export default function Dossier() {
  const id = useStore((s) => s.flagshipId);
  const [d, setD] = useState<DossierData | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [change, setChange] = useState<Change | null>(null);
  const [evidenceH, setEvidenceH] = useState(320);
  const evidenceRef = useRef<HTMLDivElement>(null);

  // Side panels stop above the evidence timeline, whatever its height.
  useEffect(() => {
    const el = evidenceRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setEvidenceH(Math.round(e.contentRect.height)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [d]);

  useEffect(() => {
    let live = true;
    if (!id) return;
    loadDossier(id).then(
      (x) => {
        if (!live) return;
        setD(x);
        setChange(null);
        setFailed(null);
      },
      () => live && setFailed(id),
    );
    return () => {
      live = false;
    };
  }, [id]);

  if (failed === id && (!d || d.id !== id))
    return (
      <p className="boot" role="alert">
        This dossier is temporarily unavailable. Reload the page to try again.
      </p>
    );
  if (!d || d.id !== id) return <p className="boot" aria-live="polite" />;

  return (
    <div className="hud dossier-hud" style={{ ["--evidence-h" as string]: `${evidenceH}px` }}>
      <button className="btn-instrument dz-back" onClick={() => useStore.getState().setPhase("world")}>
        Back to the world <span className="kbd">Esc</span>
      </button>
      <motion.aside
        className="dossier"
        aria-label={`${d.name} evidence dossier`}
        initial={{ opacity: 0, transform: "translateX(-16px)" }}
        animate={{ opacity: 1, transform: "translateX(0px)" }}
        transition={SPRING}
      >
        <header className="dz-head">
          <p className="dz-role">{d.role}</p>
          <h2>{d.name}</h2>
          <p className="dz-place">
            {d.place} · {Math.abs(d.lat).toFixed(2)}° {d.lat < 0 ? "S" : "N"}, {Math.abs(d.lon).toFixed(2)}° {d.lon < 0 ? "W" : "E"}
          </p>
          <p className="dz-question">{d.question}</p>
          <p className="dz-summary">{d.summary}</p>
          <dl className="dz-stats">
            {d.stats.map((s) => (
              <div key={s.label}>
                <dt>{s.label}</dt>
                <dd>{s.value}</dd>
              </div>
            ))}
          </dl>
        </header>

        <Changes d={d} selected={change} onSelect={setChange} />

        <section className="dz-section">
          <h3>What is missing</h3>
          <ul className="dz-list">
            {d.missing.map((m) => (
              <li key={m.title}>
                <b>{m.title}</b>
                <span>{m.detail}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="dz-section">
          <h3>Why look again</h3>
          <ul className="dz-list">
            {d.next.map((m) => (
              <li key={m.title}>
                <b>{m.title}</b>
                <span>
                  {m.detail} <EvidenceTag kind={m.evidence} compact />
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="dz-section">
          <h3>Sources</h3>
          <ul className="dz-sources">
            {d.sources.map((s) => (
              <li key={s.id}>
                <a href={s.url} target="_blank" rel="noreferrer">
                  {s.name}
                </a>
                <span>
                  {s.provider} · {s.license}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </motion.aside>

      <motion.div
        className="dossier-side"
        initial={{ opacity: 0, transform: "translateX(16px)" }}
        animate={{ opacity: 1, transform: "translateX(0px)" }}
        transition={{ ...SPRING, delay: 0.08 }}
      >
        {d.id === "moorea" && (
          <>
            <Bleaching2019 />
            <LagoonLegend />
          </>
        )}
        {d.id === "lizard-island" && <DisturbanceLog d={d} />}
        {d.id === "soneva-fushi" && <SonevaCard d={d} />}
      </motion.div>

      <AnimatePresence>
        <motion.div
          key={d.id}
          ref={evidenceRef}
          className="evidence-wrap"
          initial={{ opacity: 0, transform: "translateY(20px)" }}
          animate={{ opacity: 1, transform: "translateY(0px)" }}
          transition={{ ...SPRING, delay: 0.12 }}
        >
          <EvidenceTimeline d={d} change={change} onPickChange={setChange} />
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
