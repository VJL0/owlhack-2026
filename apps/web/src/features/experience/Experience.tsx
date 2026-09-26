"use client";

import dynamic from "next/dynamic";
import { useEffect } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useStore } from "@/lib/store";
import { SITES } from "@/lib/data";
import Hero from "@/features/intro/Hero";
import RegionHud from "@/features/hud/RegionHud";
import Caption from "@/features/hud/Caption";
import Timeline from "@/features/timeline/Timeline";
import Starfield from "@/features/globe/Starfield";
import MotionToggle, { readMotionChoice } from "@/features/hud/MotionToggle";
import ReefHud from "@/features/hud/ReefHud";
import DiveOverlay from "@/features/dive/DiveOverlay";

/** Leave the reef: cover with water, hand back to the globe, reveal. */
function ascend() {
  const s = useStore.getState();
  if (s.phase !== "reef" || s.crossing !== "none") return;
  s.setPlaying(false);
  s.setPressuresOpen(false);
  s.setCrossing("plunge");
  window.setTimeout(() => useStore.getState().setPhase("ascending"), s.reducedMotion ? 50 : 750);
}

const GlobeView = dynamic(() => import("@/features/globe/GlobeView"), { ssr: false });
const ReefView = dynamic(() => import("@/features/reef/ReefView"), { ssr: false });
const loadReef = () => import("@/features/reef/ReefView");

export default function Experience() {
  const phase = useStore((s) => s.phase);
  const caption = useStore((s) => s.caption);
  const setReducedMotion = useStore((s) => s.setReducedMotion);
  const reducedMotion = useStore((s) => s.reducedMotion);

  // Reduced motion follows the OS unless the viewer chose otherwise here.
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const saved = readMotionChoice();
    setReducedMotion(saved ?? mq.matches);
    const on = (e: MediaQueryListEvent) => {
      if (readMotionChoice() === null) setReducedMotion(e.matches);
    };
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [setReducedMotion]);

  // global keys: space plays time, P shows pressures, Esc steps back
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      const s = useStore.getState();
      if (e.key === "Escape" && s.phase === "reef") {
        e.preventDefault();
        if (s.selection) s.select(null);
        else if (s.pressuresOpen) s.setPressuresOpen(false);
        else ascend();
        return;
      }
      if (el.closest("input, textarea")) return;
      if ((e.key === "p" || e.key === "P") && s.phase === "reef" && !e.metaKey && !e.ctrlKey) {
        s.setPressuresOpen(!s.pressuresOpen);
        return;
      }
      if (el.closest("button, [role=slider], [role=switch]")) return;
      if (e.key === " " && (s.phase === "region" || s.phase === "reef")) {
        e.preventDefault();
        s.setPlaying(!s.playing);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (phase === "region") loadReef();
  }, [phase]);

  // Deep link straight to a reef: #reef=looe-key
  useEffect(() => {
    const m = window.location.hash.match(/reef=([a-z-]+)/);
    if (m && SITES.some((s) => s.id === m[1])) {
      const s = useStore.getState();
      s.setSite(m[1]);
      s.setPhase("reef");
    }
  }, []);

  const showTimeline = phase === "region" || phase === "reef";

  return (
    <main className="stage" data-motion={reducedMotion ? "reduced" : "full"} style={{ ["--timeline-h" as string]: showTimeline ? "150px" : "0px" }}>
      <Starfield />
      <GlobeView />
      {phase !== "reef" && <div className="globe-vignette" aria-hidden="true" />}
      {phase === "reef" && <ReefView />}

      {phase === "boot" && (
        <p className="boot" aria-live="polite">
          <span className="sr-only">Loading the globe</span>
        </p>
      )}

      <AnimatePresence>
        {phase === "intro" && (
          <motion.div key="hero" exit={{ opacity: 0, filter: "blur(8px)" }} transition={{ duration: 0.9 }}>
            <Hero />
          </motion.div>
        )}
      </AnimatePresence>

      {phase !== "boot" && phase !== "intro" && (
        <button className="wordmark" onClick={() => window.location.reload()} aria-label="Reef Sentinel, restart">
          REEF SENTINEL
        </button>
      )}

      {phase === "reef" && <ReefHud onAscend={ascend} />}

      <AnimatePresence>
        {phase === "region" && (
          <motion.div key="region" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.8 }}>
            <RegionHud />
          </motion.div>
        )}
      </AnimatePresence>

      {phase === "flying" && caption && (
        <div className="hud" style={{ pointerEvents: "none" }}>
          <Caption id={caption.key} text={caption.text} />
        </div>
      )}

      {phase !== "boot" && (
        <div className="hud" style={{ pointerEvents: "none" }}>
          <MotionToggle />
        </div>
      )}

      <AnimatePresence>
        {showTimeline && (
          <motion.div
            key="timeline"
            className="hud"
            style={{ pointerEvents: "none" }}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
          >
            <div style={{ pointerEvents: "auto" }}>
              <Timeline mode={phase === "reef" ? "reef" : "region"} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <DiveOverlay />
    </main>
  );
}
