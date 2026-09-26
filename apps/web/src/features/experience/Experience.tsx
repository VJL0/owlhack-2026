"use client";

import dynamic from "next/dynamic";
import { useEffect } from "react";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { useStore } from "@/lib/store";
import { SPRING } from "@/lib/ui";
import { SITES } from "@/lib/data";
import Hero from "@/features/intro/Hero";
import RegionHud from "@/features/hud/RegionHud";
import Caption from "@/features/hud/Caption";
import Timeline from "@/features/timeline/Timeline";
import Starfield from "@/features/globe/Starfield";
import ReefHud from "@/features/hud/ReefHud";
import DiveOverlay from "@/features/dive/DiveOverlay";
import VoiceAgent from "@/features/voice/VoiceAgent";
import Narrator from "@/features/voice/Narrator";
import { ascend } from "@/lib/navigation";

const GlobeView = dynamic(() => import("@/features/globe/GlobeView"), { ssr: false });
const ReefView = dynamic(() => import("@/features/reef/ReefView"), { ssr: false });
const loadReef = () => import("@/features/reef/ReefView");

export default function Experience() {
  const phase = useStore((s) => s.phase);
  const caption = useStore((s) => s.caption);
  const setReducedMotion = useStore((s) => s.setReducedMotion);
  const reducedMotion = useStore((s) => s.reducedMotion);

  // Reduced motion follows the OS setting.
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(mq.matches);
    const on = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
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
    // Reduced motion keeps opacity fades and drops movement
    <MotionConfig reducedMotion={reducedMotion ? "always" : "never"}>
    <main
      className="stage"
      data-motion={reducedMotion ? "reduced" : "full"}
      style={{ ["--timeline-h" as string]: showTimeline ? "166px" : "0px" }}
    >
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
          <motion.div
            key="hero"
            exit={{ opacity: 0, filter: "blur(6px)" }}
            transition={{ duration: 0.35, ease: [0.23, 1, 0.32, 1] }}
          >
            <Hero />
          </motion.div>
        )}
      </AnimatePresence>

      {phase !== "boot" && phase !== "intro" && (
        <button className="wordmark" onClick={() => window.location.reload()} aria-label="Reef Atlas, restart">
          REEF ATLAS
        </button>
      )}

      {phase === "reef" && <ReefHud onAscend={ascend} />}

      <AnimatePresence>
        {phase === "region" && (
          <motion.div
            key="region"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            // Panels slide in from their own edge in CSS. No filter here: it would break their backdrop blur.
            transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
          >
            <RegionHud />
          </motion.div>
        )}
      </AnimatePresence>

      {phase === "flying" && caption && (
        <div className="hud" style={{ pointerEvents: "none" }}>
          <Caption id={caption.key} text={caption.text} />
        </div>
      )}

      {phase !== "boot" && phase !== "intro" && (
        <div className="hud" style={{ pointerEvents: "none" }}>
          <VoiceAgent />
        </div>
      )}
      <Narrator />

      <AnimatePresence>
        {showTimeline && (
          <motion.div
            key="timeline"
            className="hud"
            style={{ pointerEvents: "none" }}
            // Full transform strings stay on the compositor while the reef scene loads
            initial={{ opacity: 0, transform: "translateY(20px)" }}
            animate={{ opacity: 1, transform: "translateY(0px)" }}
            exit={{ opacity: 0, transform: "translateY(20px)" }}
            transition={SPRING}
          >
            <div style={{ pointerEvents: "auto" }}>
              <Timeline mode={phase === "reef" ? "reef" : "region"} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <DiveOverlay />
    </main>
    </MotionConfig>
  );
}
