"use client";

import { useStore } from "./store";
import { dateToDay } from "./time";
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
      ascend();
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
  }
}
