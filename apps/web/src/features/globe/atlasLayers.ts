import type * as CesiumNS from "cesium";
import type { Cesium } from "./loadCesium";
import { FLAGSHIPS } from "@/lib/flagshipIndex";
import { loadDossier, type Dossier } from "@/lib/flagships";
import { heatRgb, lagoonTempRgb as tempRgb } from "@/lib/colors";
import { useStore } from "@/lib/store";

type Store = typeof useStore;

// ------------------------------------------------------------------ flagship markers (world view)

function haloCanvas() {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(64, 64, 6, 64, 64, 62);
  grad.addColorStop(0, "rgba(111,243,227,0.55)");
  grad.addColorStop(0.35, "rgba(111,243,227,0.16)");
  grad.addColorStop(1, "rgba(111,243,227,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = "rgba(255,255,255,0.9)";
  g.lineWidth = 3;
  g.beginPath();
  g.arc(64, 64, 20, 0, Math.PI * 2);
  g.stroke();
  return c;
}

export function addFlagshipMarkers(C: Cesium, viewer: CesiumNS.Viewer, store: Store) {
  const halo = haloCanvas();
  const camera = viewer.scene.camera;
  const toCam = new C.Cartesian3();
  const sans = getComputedStyle(document.documentElement).getPropertyValue("--font-geist").trim() || "system-ui";
  for (const f of FLAGSHIPS) {
    const hot = () => store.getState().flagshipHover === f.id;
    const pos = C.Cartesian3.fromDegrees(f.lon, f.lat, 50);
    // Markers ignore depth so they read over terrain; hide them on the far side of the Earth.
    const visible = () => store.getState().phase === "world" && C.Cartesian3.dot(pos, C.Cartesian3.subtract(camera.positionWC, pos, toCam)) > 0;
    viewer.entities.add({
      id: `flagship:${f.id}`,
      position: pos,
      billboard: {
        image: halo,
        scale: new C.CallbackProperty(() => (hot() ? 0.62 : 0.46) + Math.sin(performance.now() / 700) * 0.02, false),
        show: new C.CallbackProperty(visible, false),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: {
        text: `${f.name}\n${f.role}`,
        font: `500 15px ${sans}`,
        fillColor: C.Color.fromCssColorString("#f5f5f7"),
        outlineColor: C.Color.fromCssColorString("#010a12"),
        outlineWidth: 4,
        style: C.LabelStyle.FILL_AND_OUTLINE,
        horizontalOrigin: C.HorizontalOrigin.LEFT,
        verticalOrigin: C.VerticalOrigin.CENTER,
        pixelOffset: new C.Cartesian2(26, 0),
        scale: new C.CallbackProperty(() => (hot() ? 1.08 : 0.94), false),
        show: new C.CallbackProperty(visible, false),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
  }
}

// ------------------------------------------------------------------ global reef heat layer (world view)

interface GlobalReefs {
  columns: string[];
  rows: (number | null)[][];
}

/**
 * 2,720 reefs from the supplied archive (the same records the /data explorer
 * serves from Tiger Cloud), coloured by that year's peak degree heating weeks.
 */
export function addGlobalReefs(C: Cesium, viewer: CesiumNS.Viewer, store: Store) {
  const points = viewer.scene.primitives.add(new C.PointPrimitiveCollection()) as CesiumNS.PointPrimitiveCollection;
  let rows: (number | null)[][] = [];
  const scale = new C.NearFarScalar(1.5e6, 1.5, 2.2e7, 1);
  const paint = () => {
    const { worldYear, phase } = store.getState();
    const show = phase === "world";
    const col = 3 + (worldYear - 2021);
    for (let i = 0; i < points.length; i++) {
      const p = points.get(i);
      const dhw = rows[i][col];
      p.show = show && dhw !== null;
      if (dhw === null) continue;
      const [r, g, b] = heatRgb(dhw as number);
      p.color = new C.Color(r / 255, g / 255, b / 255, 0.55 + Math.min(0.45, (dhw as number) / 16));
    }
  };
  import("@/data/global-reefs.json").then((m) => {
    rows = (m.default as GlobalReefs).rows;
    for (const r of rows) {
      points.add({
        position: C.Cartesian3.fromDegrees(r[2] as number, r[1] as number, 20),
        pixelSize: 6,
        scaleByDistance: scale,
        outlineWidth: 1,
        outlineColor: C.Color.fromCssColorString("#010a12").withAlpha(0.7),
      });
    }
    paint();
  });
  const unsub = store.subscribe((s, p) => {
    if (s.worldYear !== p.worldYear || s.phase !== p.phase) paint();
  });
  return () => {
    unsub();
    viewer.scene.primitives.remove(points);
  };
}

// ------------------------------------------------------------------ flagship detail (sites, sensors, plots)

interface Lagoon {
  weeks: number[];
  sites: { id: string; lat: number; lon: number }[];
  temps: Record<string, (number | null)[]>;
}

export function addFlagshipDetail(C: Cesium, viewer: CesiumNS.Viewer, store: Store) {
  const loaded = new Set<string>();
  const sans = getComputedStyle(document.documentElement).getPropertyValue("--font-geist").trim() || "system-ui";
  const inFlagship = (id: string) => {
    const s = store.getState();
    return (s.phase === "flagship" || s.phase === "splat") && s.flagshipId === id;
  };

  const addPoints = (d: Dossier) => {
    for (const p of d.points) {
      viewer.entities.add({
        position: C.Cartesian3.fromDegrees(p.lon, p.lat, 15),
        point: {
          pixelSize: 9,
          color: C.Color.fromCssColorString(p.kind === "plot" ? "#6ff3e3" : "#ffffff"),
          outlineColor: C.Color.fromCssColorString("#010a12").withAlpha(0.8),
          outlineWidth: 2,
          show: new C.CallbackProperty(() => inFlagship(d.id), false),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: {
          text: p.name,
          font: `500 13px ${sans}`,
          fillColor: C.Color.fromCssColorString("#f5f5f7"),
          outlineColor: C.Color.fromCssColorString("#010a12"),
          outlineWidth: 4,
          style: C.LabelStyle.FILL_AND_OUTLINE,
          horizontalOrigin: C.HorizontalOrigin.LEFT,
          pixelOffset: new C.Cartesian2(10, 0),
          show: new C.CallbackProperty(() => inFlagship(d.id), false),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          distanceDisplayCondition: new C.DistanceDisplayCondition(0, 400_000),
        },
      });
    }
  };

  // Moorea's 49 lagoon thermistors, coloured by the week under the timeline cursor.
  const addLagoon = (lagoon: Lagoon) => {
    const weekAt = (t: number | null) => {
      if (t === null || t < lagoon.weeks[0] - 0.02 || t > lagoon.weeks[lagoon.weeks.length - 1] + 0.02) return -1;
      let best = 0;
      for (let i = 0; i < lagoon.weeks.length; i++) if (Math.abs(lagoon.weeks[i] - t) < Math.abs(lagoon.weeks[best] - t)) best = i;
      return best;
    };
    let idx = -1;
    const update = () => {
      idx = weekAt(store.getState().flagshipT);
    };
    update();
    store.subscribe((s, p) => {
      if (s.flagshipT !== p.flagshipT) update();
    });
    for (const s of lagoon.sites) {
      const series = lagoon.temps[s.id];
      viewer.entities.add({
        position: C.Cartesian3.fromDegrees(s.lon, s.lat, 10),
        point: {
          pixelSize: 11,
          color: new C.CallbackProperty(() => {
            const v = idx >= 0 ? series?.[idx] : null;
            if (v == null) return C.Color.fromCssColorString("#8e8e93").withAlpha(0.5);
            const [r, g, b] = tempRgb(v);
            return new C.Color(r / 255, g / 255, b / 255, 0.95);
          }, false),
          outlineColor: C.Color.fromCssColorString("#010a12").withAlpha(0.85),
          outlineWidth: 1.5,
          show: new C.CallbackProperty(() => inFlagship("moorea") && idx >= 0, false),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
    }
  };

  const ensure = (id: Dossier["id"]) => {
    if (loaded.has(id)) return;
    loaded.add(id);
    loadDossier(id).then(addPoints);
    if (id === "moorea") import("@/data/flagships/moorea-lagoon.json").then((m) => addLagoon(m.default as unknown as Lagoon));
  };
  const unsub = store.subscribe((s) => {
    if (s.flagshipId && (s.phase === "flagship" || s.phase === "splat")) ensure(s.flagshipId);
  });
  return unsub;
}
