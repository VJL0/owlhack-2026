import type * as CesiumNS from "cesium";

export type Cesium = typeof CesiumNS;

declare global {
  interface Window {
    Cesium?: Cesium;
    CESIUM_BASE_URL?: string;
  }
}

let pending: Promise<Cesium> | null = null;

/**
 * Loads the prebuilt Cesium bundle from /cesium (copied there by
 * scripts/copy-cesium.mjs). Loading it as a static script keeps Cesium's
 * workers and assets out of the Next.js bundler.
 */
export function loadCesium(): Promise<Cesium> {
  if (pending) return pending;
  pending = new Promise((resolve, reject) => {
    if (window.Cesium) return resolve(window.Cesium);
    window.CESIUM_BASE_URL = "/cesium/";
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = "/cesium/Widgets/widgets.css";
    document.head.appendChild(css);
    const script = document.createElement("script");
    script.src = "/cesium/Cesium.js";
    script.async = true;
    script.onload = () => (window.Cesium ? resolve(window.Cesium) : reject(new Error("Cesium global missing")));
    script.onerror = () => reject(new Error("Could not load /cesium/Cesium.js"));
    document.head.appendChild(script);
  });
  return pending;
}
