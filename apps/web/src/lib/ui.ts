import { useSyncExternalStore } from "react";

/** Critically damped: no overshoot, since nothing here is flicked. */
export const SPRING = { type: "spring", bounce: 0, duration: 0.45 } as const;

/** Touch is the only input (phones, tablets without a trackpad): no keys to press, no hover. */
const TOUCH_ONLY = "(hover: none) and (pointer: coarse)";
/** Phones in either orientation: landscape phones are at most ~430 px tall, tablets at least 600. Matches the CSS. */
export const COMPACT = "(max-width: 900px), (max-height: 500px)";

const matches = (query: string) => typeof window !== "undefined" && window.matchMedia(query).matches;

export const touchOnly = () => matches(TOUCH_ONLY);

/** A media query as React state; false on the server. */
export function useMedia(query: string) {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(query);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => matches(query),
    () => false,
  );
}

export const useTouchOnly = () => useMedia(TOUCH_ONLY);
