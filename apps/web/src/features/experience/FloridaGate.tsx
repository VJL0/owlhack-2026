"use client";

import { useEffect, useState, type ReactNode } from "react";
import ReactDOM from "react-dom";
import { floridaReady, loadFloridaData } from "@/lib/data";
import { loadCesium } from "@/features/globe/loadCesium";

const FLORIDA_URL = "/api/atlas/florida";

/**
 * Holds the experience until the Florida data has arrived from Tiger Cloud.
 * The download starts from a <link rel="preload"> in the server-rendered head,
 * and Cesium starts loading at the same time.
 */
export default function FloridaGate({ children }: { children: ReactNode }) {
  ReactDOM.preload(FLORIDA_URL, { as: "fetch", crossOrigin: "anonymous" });
  const [state, setState] = useState<"loading" | "ready" | "error">(() => (floridaReady() ? "ready" : "loading"));
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (state !== "loading") return;
    let live = true;
    loadCesium().catch(() => {}); // GlobeView reports a failure itself
    loadFloridaData().then(
      () => live && setState("ready"),
      () => live && setState("error"),
    );
    return () => {
      live = false;
    };
  }, [state, attempt]);

  if (state === "ready") return children;
  return (
    <main className="stage">
      {state === "loading" ? (
        <p className="boot" aria-live="polite">
          <span className="sr-only">Loading reef data</span>
        </p>
      ) : (
        <div className="boot boot-error" role="alert">
          <p>
            Reef data is temporarily unavailable.
            <button
              type="button"
              onClick={() => {
                setState("loading");
                setAttempt((n) => n + 1);
              }}
            >
              Try again
            </button>
          </p>
        </div>
      )}
    </main>
  );
}
