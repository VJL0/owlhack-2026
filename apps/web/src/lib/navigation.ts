"use client";

import { useStore } from "./store";
import { dateToDay } from "./time";
import { decimalYear } from "./flagships";
import type { UiAction } from "./voiceActions";

/** Leave the reef: cover with water, hand back to the globe, reveal. */
export function ascend() {
  const s = useStore.getState();
  if (s.phase !== "reef" || s.crossing !== "none") return;
  s.setPlaying(false);
  s.setPressuresOpen(false);
  s.setCrossing("plunge");
  window.setTimeout(() => useStore.getState().setPhase("ascending"), s.reducedMotion ? 50 : 750);
}

/** Soneva Fushi: dive from the dossier into a real 3D survey, through the same water crossing. */
export function enterSplat(plot?: string) {
  const s = useStore.getState();
  if (s.phase !== "flagship" || s.crossing !== "none") return;
  if (plot) s.setSplat(plot, 0);
  s.setCrossing("plunge");
  window.setTimeout(() => useStore.getState().setPhase("splat"), s.reducedMotion ? 50 : 750);
}

/** Back up from the 3D survey to the dossier. */
export function exitSplat() {
  const s = useStore.getState();
  if (s.phase !== "splat" || s.crossing !== "none") return;
  s.setCrossing("plunge");
  window.setTimeout(() => useStore.getState().setPhase("flagship"), s.reducedMotion ? 50 : 750);
}

/** Resolve once the map (region view) is showing. */
function whenOnMap(): Promise<void> {
  return new Promise((resolve) => {
    if (useStore.getState().phase === "region") return resolve();
    const unsub = useStore.subscribe((s) => {
      if (s.phase === "region") {
        unsub();
        resolve();
      }
    });
  });
}

/** Same path as clicking a reef on the map. From inside a reef, rise to the map first. */
export async function goToReef(siteId: string) {
  const s = useStore.getState();
  if (s.phase === "reef" && s.siteId === siteId) return;
  // From the world or a flagship the dive flight starts wherever the camera is.
  if (s.phase === "world" || s.phase === "flagship") {
    s.setSite(siteId);
    s.setPhase("diving");
    return;
  }
  if (s.phase === "reef") ascend();
  await whenOnMap();
  const now = useStore.getState();
  now.setSite(siteId);
  now.setPhase("diving");
}

export function runAction(a: UiAction) {
  const s = useStore.getState();
  switch (a.type) {
    case "go_to_reef":
      void goToReef(a.siteId);
      break;
    case "go_to_map":
      if (s.phase === "reef") ascend();
      else if (s.phase === "splat") exitSplat();
      else if (s.phase === "flagship") s.setPhase("world");
      break;
    case "set_date":
      s.setT(dateToDay(Date.parse(`${a.date}T00:00:00Z`)));
      break;
    case "set_layer":
      if (s.layers[a.layer] !== a.on) s.toggleLayer(a.layer);
      break;
    case "set_playing":
      s.setPlaying(a.playing);
      break;
    case "go_to_world":
      s.setPlaying(false);
      s.setPhase("world");
      break;
    case "go_to_flagship":
      s.setPlaying(false);
      if (a.flagshipId === "florida") s.setPhase(s.phase === "reef" || s.phase === "region" ? "region" : "flying");
      else s.openFlagship(a.flagshipId);
      break;
    case "set_flagship_date":
      s.setFlagshipT(decimalYear(a.date));
      break;
  }
}
