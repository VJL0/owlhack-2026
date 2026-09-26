"use client";

import { useEffect, useRef, useState } from "react";
import { loadCesium } from "./loadCesium";
import { createGlobe } from "./globeController";

export default function GlobeView() {
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    let destroy: (() => void) | undefined;
    loadCesium()
      .then((C) => {
        if (disposed || !host.current) return;
        destroy = createGlobe(C, host.current).destroy;
      })
      .catch((e: Error) => setError(e.message));
    return () => {
      disposed = true;
      destroy?.();
    };
  }, []);

  return (
    <>
      <div ref={host} className="globe-host stage-layer" aria-hidden="true" />
      {error && (
        <p className="boot" role="alert">
          The globe could not start: {error}. Reload the page to try again.
        </p>
      )}
    </>
  );
}
