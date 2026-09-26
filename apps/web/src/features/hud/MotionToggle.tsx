"use client";

import { useStore } from "@/lib/store";

const KEY = "reef-sentinel:reduce-motion";

export function readMotionChoice(): boolean | null {
  try {
    const v = window.localStorage.getItem(KEY);
    return v === null ? null : v === "1";
  } catch {
    return null;
  }
}

export default function MotionToggle() {
  const reduced = useStore((s) => s.reducedMotion);
  const setReduced = useStore((s) => s.setReducedMotion);
  return (
    <button
      role="switch"
      aria-checked={reduced}
      className="layer-toggle motion-toggle"
      onClick={() => {
        setReduced(!reduced);
        try {
          window.localStorage.setItem(KEY, reduced ? "0" : "1");
        } catch {
          /* private mode: the choice lasts for this visit */
        }
      }}
    >
      <span>Reduce motion</span>
      <span className="sw" aria-hidden="true" />
    </button>
  );
}
