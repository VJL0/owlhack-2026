import type * as CesiumNS from "cesium";
import type { Cesium } from "./loadCesium";
import { LIONFISH, SITES, STORMS, siteById, stormPositionAt, thermalAt } from "@/lib/data";
import { heatRgb } from "@/lib/colors";
import { useStore, type Phase } from "@/lib/store";
import { isoDate } from "@/lib/time";
import { murAnomalyDate } from "@/lib/gibs";

type View = { lon: number; lat: number; h: number; heading: number; pitch: number };

// Camera stations for the opening flight (degrees / metres).
const VIEWS: Record<"intro" | "atlantic" | "florida" | "region", View> = {
  intro: { lon: -70.5, lat: -8, h: 6_600_000, heading: -12, pitch: -57.5 },
  atlantic: { lon: -77.5, lat: 17.5, h: 3_300_000, heading: -8, pitch: -68 },
  florida: { lon: -81.2, lat: 22.2, h: 720_000, heading: -2, pitch: -56 },
  region: { lon: -81.68, lat: 22.45, h: 315_000, heading: 0, pitch: -55 },
};

const CAPTIONS = {
  atlantic: "The western Atlantic.",
  florida: "Florida.",
  region:
    "Florida's Coral Reef runs about 350 miles, from the Dry Tortugas to St. Lucie Inlet. It is the only coral barrier reef in the continental United States.",
};

// Lighting is cinematic, not a clock: the Americas at night for the opening
// (city lights, the reef as a filament of light), and dawn sweeping in to early
// afternoon over the Keys during the flight.
const SUN_INTRO = "2023-08-21T01:30:00Z";
const SUN_REGION = "2023-08-21T16:50:00Z";
const LUMEN = "#6ff3e3";

export interface GlobeController {
  destroy: () => void;
}

function ringCanvas(color: string) {
  const c = document.createElement("canvas");
  c.width = c.height = 96;
  const g = c.getContext("2d")!;
  g.strokeStyle = color;
  g.lineWidth = 3;
  g.beginPath();
  g.arc(48, 48, 40, 0, Math.PI * 2);
  g.stroke();
  return c;
}

function spiralCanvas() {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  g.translate(64, 64);
  for (let arm = 0; arm < 2; arm++) {
    g.beginPath();
    for (let i = 0; i <= 90; i++) {
      const f = i / 90;
      const a = arm * Math.PI + f * Math.PI * 2.2;
      const r = 8 + f * 50;
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r;
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.strokeStyle = "rgba(214, 204, 255, 0.95)";
    g.lineWidth = 5;
    g.lineCap = "round";
    g.stroke();
  }
  g.beginPath();
  g.arc(0, 0, 6, 0, Math.PI * 2);
  g.fillStyle = "#ffffff";
  g.fill();
  return c;
}

/** Smooth a lat/lon polyline with a centripetal-ish Catmull-Rom pass. */
function smoothPath(pts: [number, number][], steps = 14) {
  const out: [number, number][] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) =>
        0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

export function createGlobe(C: Cesium, container: HTMLElement): GlobeController {
  const store = useStore;
  const creditBin = document.createElement("div");

  const viewer = new C.Viewer(container, {
    baseLayer: false,
    animation: false,
    timeline: false,
    baseLayerPicker: false,
    geocoder: false,
    homeButton: false,
    sceneModePicker: false,
    navigationHelpButton: false,
    fullscreenButton: false,
    infoBox: false,
    selectionIndicator: false,
    scene3DOnly: true,
    creditContainer: creditBin,
    useBrowserRecommendedResolution: false,
    msaaSamples: 4,
    // transparent so the page's own starfield shows through
    contextOptions: { webgl: { alpha: true } },
  });
  viewer.resolutionScale = Math.min(window.devicePixelRatio, 1.5) / window.devicePixelRatio;

  const scene = viewer.scene;
  const globe = scene.globe;
  const camera = scene.camera;

  scene.backgroundColor = new C.Color(0, 0, 0, 0);
  if (scene.skyBox) scene.skyBox.show = false;
  if (scene.moon) scene.moon.show = false;
  globe.baseColor = C.Color.fromCssColorString("#03121d");
  globe.enableLighting = true;
  globe.dynamicAtmosphereLighting = true;
  globe.dynamicAtmosphereLightingFromSun = true;
  globe.showGroundAtmosphere = true;
  globe.maximumScreenSpaceError = 1.6;
  if (scene.skyAtmosphere) {
    scene.skyAtmosphere.hueShift = -0.03;
    scene.skyAtmosphere.saturationShift = 0.12;
    // lifts the night-side sky so the limb reads as a thin teal halo, not a black cap
    scene.skyAtmosphere.brightnessShift = 0.35;
  }
  scene.atmosphere.saturationShift = 0.05;
  scene.fog.enabled = true;
  scene.fog.density = 2.0e-4;
  const sunIntro = C.JulianDate.fromIso8601(SUN_INTRO);
  const sunRegion = C.JulianDate.fromIso8601(SUN_REGION);
  const sunSpan = C.JulianDate.secondsDifference(sunRegion, sunIntro);
  const setSun = (k: number) => {
    viewer.clock.currentTime = C.JulianDate.addSeconds(sunIntro, sunSpan * k, new C.JulianDate());
  };
  setSun(0);
  viewer.clock.shouldAnimate = false;

  const ssc = scene.screenSpaceCameraController;
  ssc.minimumZoomDistance = 1_500;
  ssc.maximumZoomDistance = 25_000_000;
  ssc.inertiaSpin = 0.85;
  const setInputs = (on: boolean) => {
    ssc.enableInputs = on;
  };
  setInputs(false);

  // ------------------------------------------------------------ imagery
  const layers = viewer.imageryLayers;

  const natural = C.ImageryLayer.fromProviderAsync(
    C.TileMapServiceImageryProvider.fromUrl(C.buildModuleUrl("Assets/Textures/NaturalEarthII")),
    {},
  );
  layers.add(natural);

  const satellite = new C.ImageryLayer(
    new C.UrlTemplateImageryProvider({
      url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      maximumLevel: 17,
      credit: "Esri, Maxar, Earthstar Geographics",
    }),
    {},
  );
  layers.add(satellite);

  const night = new C.ImageryLayer(
    new C.UrlTemplateImageryProvider({
      url: "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_Black_Marble/default/2016-01-01/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png",
      maximumLevel: 8,
      credit: "NASA Black Marble",
    }),
    {},
  );
  night.dayAlpha = 0;
  night.nightAlpha = 0.9;
  night.brightness = 1.5;
  layers.add(night);

  // colour grade: deep, slightly cool, documentary
  const grade = (l: CesiumNS.ImageryLayer) => {
    l.brightness = 0.82;
    l.contrast = 1.14;
    l.saturation = 0.78;
    l.gamma = 1.08;
    l.hue = -0.015;
  };
  natural.readyEvent.addEventListener(() => {
    grade(natural);
    natural.nightAlpha = 0;
  });
  grade(satellite);
  // day imagery only on the day side; the night side shows Black Marble lights
  satellite.nightAlpha = 0;

  // Sea-surface temperature anomaly (NASA/JPL MUR via GIBS), dated to the timeline.
  const SST_RECT = C.Rectangle.fromDegrees(-98, 14, -66, 34);
  const SST_ALPHA = 0.36;
  let sstLayer: CesiumNS.ImageryLayer | null = null;
  let sstDate = "";
  let sstTimer: number | undefined;
  const sstProvider = (date: string) =>
    new C.UrlTemplateImageryProvider({
      url: `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/GHRSST_L4_MUR_Sea_Surface_Temperature_Anomalies/default/${date}/GoogleMapsCompatible_Level7/{z}/{y}/{x}.png`,
      maximumLevel: 7,
      rectangle: SST_RECT,
      credit: "NASA JPL MUR SST via GIBS",
    });
  const sstVisible = () => {
    const s = store.getState();
    return s.layers.sst && s.phase === "region";
  };
  const updateSst = (immediate = false) => {
    window.clearTimeout(sstTimer);
    const run = () => {
      const want = sstVisible();
      if (!want) {
        if (sstLayer) sstLayer.show = false;
        return;
      }
      const date = murAnomalyDate(isoDate(store.getState().t));
      if (!date) {
        // no NASA anomaly layer for this date (coverage starts July 2019)
        if (sstLayer) sstLayer.show = false;
        return;
      }
      if (sstLayer && date === sstDate) {
        sstLayer.show = true;
        return;
      }
      sstDate = date;
      const next = new C.ImageryLayer(sstProvider(date), { alpha: 0.0 });
      // quieter than the raw GIBS palette so the reef stays the subject
      next.saturation = 0.6;
      next.brightness = 0.9;
      next.contrast = 0.9;
      layers.add(next, layers.indexOf(night));
      const prev = sstLayer;
      sstLayer = next;
      // cross-fade once the new tiles have arrived
      const t0 = performance.now();
      const fade = () => {
        const k = Math.min(1, (performance.now() - t0) / 700);
        next.alpha = SST_ALPHA * k;
        if (prev) prev.alpha = SST_ALPHA * (1 - k);
        if (k < 1) requestAnimationFrame(fade);
        else if (prev) layers.remove(prev, true);
      };
      const off = globe.tileLoadProgressEvent.addEventListener((remaining: number) => {
        if (remaining === 0) {
          off();
          fade();
        }
      });
      window.setTimeout(() => {
        // fallback if the progress event never reports 0
        if (next.alpha === 0) {
          off();
          fade();
        }
      }, 2500);
    };
    if (immediate) run();
    else sstTimer = window.setTimeout(run, 220);
  };

  // ------------------------------------------------------------ reef tract
  const tractPath = smoothPath(SITES.map((s) => [s.lon, s.lat] as [number, number]), 18);
  const tractCart = tractPath.map(([lon, lat]) => C.Cartesian3.fromDegrees(lon, lat, 0));
  let tractProgress = 0;
  let tractAlpha = 1; // faded out during the final approach of a dive
  const tractPositions = new C.CallbackProperty(() => {
    const n = Math.max(2, Math.round(tractCart.length * tractProgress));
    return tractCart.slice(0, n);
  }, false);
  viewer.entities.add({
    polyline: {
      positions: tractPositions,
      width: 34,
      material: new C.PolylineGlowMaterialProperty({
        glowPower: 0.06,
        taperPower: 1,
        color: new C.CallbackProperty(() => C.Color.fromCssColorString("#2ee6d6").withAlpha(0.55 * tractAlpha), false),
      }),
      arcType: C.ArcType.GEODESIC,
    },
  });
  viewer.entities.add({
    polyline: {
      positions: tractPositions,
      width: 9,
      material: new C.PolylineGlowMaterialProperty({
        glowPower: 0.35,
        taperPower: 1,
        color: new C.CallbackProperty(() => C.Color.fromCssColorString(LUMEN).withAlpha(tractAlpha), false),
      }),
      arcType: C.ArcType.GEODESIC,
    },
  });

  // ------------------------------------------------------------ reef sites
  const ringImg = ringCanvas("#ffffff");
  let hoverSite: string | null = null;
  const siteVisible = () => {
    const p = store.getState().phase;
    return p === "region" || p === "diving" || p === "ascending";
  };
  const serif = getComputedStyle(document.documentElement).getPropertyValue("--font-serif").trim() || "Georgia";
  const mono = getComputedStyle(document.documentElement).getPropertyValue("--font-mono").trim() || "monospace";

  const siteColor = (id: string, alpha = 1) => {
    const [r, g, b] = heatRgb(thermalAt(id, store.getState().t).dhw);
    return new C.Color(r / 255, g / 255, b / 255, alpha);
  };

  for (const site of SITES) {
    const pos = C.Cartesian3.fromDegrees(site.lon, site.lat, 30);
    const phase = Math.random() * Math.PI * 2;
    viewer.entities.add({
      id: `site:${site.id}`,
      position: pos,
      point: {
        pixelSize: new C.CallbackProperty(() => (hoverSite === site.id || store.getState().siteId === site.id ? 11 : 8), false),
        color: new C.CallbackProperty(() => siteColor(site.id), false),
        outlineColor: C.Color.fromCssColorString("#010a12").withAlpha(0.8),
        outlineWidth: 2,
        show: new C.CallbackProperty(siteVisible, false),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      billboard: {
        image: ringImg,
        scale: new C.CallbackProperty(() => {
          const k = (performance.now() / 2200 + phase / (Math.PI * 2)) % 1;
          const dhw = thermalAt(site.id, store.getState().t).dhw;
          return 0.14 + k * (0.22 + Math.min(dhw, 18) * 0.03);
        }, false),
        color: new C.CallbackProperty(() => {
          const k = (performance.now() / 2200 + phase / (Math.PI * 2)) % 1;
          return siteColor(site.id, (1 - k) * 0.85);
        }, false),
        show: new C.CallbackProperty(siteVisible, false),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: {
        text: site.name,
        font: `300 15px ${serif}`,
        fillColor: C.Color.fromCssColorString("#eef5f2"),
        outlineColor: C.Color.fromCssColorString("#010a12"),
        outlineWidth: 3,
        style: C.LabelStyle.FILL_AND_OUTLINE,
        horizontalOrigin: C.HorizontalOrigin.LEFT,
        verticalOrigin: C.VerticalOrigin.CENTER,
        pixelOffset: new C.Cartesian2(14, 0),
        show: new C.CallbackProperty(siteVisible, false),
        scale: new C.CallbackProperty(() => (hoverSite === site.id ? 1.12 : 1), false),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        distanceDisplayCondition: new C.DistanceDisplayCondition(0, 2_600_000),
      },
    });
  }

  // ------------------------------------------------------------ hurricanes (HURDAT2)
  const spiralImg = spiralCanvas();
  const stormColor = C.Color.fromCssColorString("#b8a8ff");
  for (const storm of STORMS) {
    const pts = storm.pts;
    if (pts.length < 2) continue;
    const cart = pts.map((p) => C.Cartesian3.fromDegrees(p.lon, p.lat, 0));
    const t0 = pts[0].t;
    const t1 = pts[pts.length - 1].t;
    const visible = () => {
      const s = store.getState();
      return s.layers.storms && siteVisible() && s.t >= t0 && s.t <= t1 + 60;
    };
    // the whole best track, faint and dashed, so an approaching storm reads before it arrives
    viewer.entities.add({
      polyline: {
        positions: cart,
        width: 1.5,
        material: new C.PolylineDashMaterialProperty({ color: stormColor.withAlpha(0.45), dashLength: 10 }),
        show: new C.CallbackProperty(() => {
          const s = store.getState();
          return s.layers.storms && siteVisible() && s.t >= t0 - 10 && s.t <= t1 + 30;
        }, false),
        arcType: C.ArcType.GEODESIC,
      },
    });
    viewer.entities.add({
      polyline: {
        positions: new C.CallbackProperty(() => {
          const t = store.getState().t;
          let n = 0;
          while (n < pts.length && pts[n].t <= t) n++;
          const out = cart.slice(0, Math.max(2, n));
          const cur = stormPositionAt(storm, t);
          if (cur && n > 0 && n < pts.length) out.push(C.Cartesian3.fromDegrees(cur.lon, cur.lat, 0));
          return out;
        }, false),
        width: 3 + (storm.peakWindKt / 160) * 7,
        material: new C.PolylineGlowMaterialProperty({
          glowPower: 0.2,
          taperPower: 1,
          color: new C.CallbackProperty(() => {
            const t = store.getState().t;
            const fade = t > t1 ? Math.max(0, 1 - (t - t1) / 60) : 1;
            return stormColor.withAlpha(0.85 * fade);
          }, false),
        }),
        show: new C.CallbackProperty(visible, false),
        arcType: C.ArcType.GEODESIC,
      },
    });
    viewer.entities.add({
      position: new C.CallbackPositionProperty(() => {
        const cur = stormPositionAt(storm, store.getState().t) ?? pts[pts.length - 1];
        return C.Cartesian3.fromDegrees(cur.lon, cur.lat, 0);
      }, false),
      billboard: {
        image: spiralImg,
        scale: new C.CallbackProperty(() => {
          const cur = stormPositionAt(storm, store.getState().t);
          return cur ? 0.25 + (cur.wind / 160) * 0.55 : 0.001;
        }, false),
        rotation: new C.CallbackProperty(() => -performance.now() / 700, false),
        show: new C.CallbackProperty(() => visible() && !!stormPositionAt(storm, store.getState().t), false),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: {
        text: new C.CallbackProperty(() => {
          const cur = stormPositionAt(storm, store.getState().t);
          return cur ? `${storm.name}  ${Math.round(cur.wind)} kt` : storm.name;
        }, false),
        font: `400 12px ${mono}`,
        fillColor: C.Color.fromCssColorString("#e6e0ff"),
        outlineColor: C.Color.fromCssColorString("#010a12"),
        outlineWidth: 3,
        style: C.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new C.Cartesian2(0, -40),
        show: new C.CallbackProperty(() => visible() && !!stormPositionAt(storm, store.getState().t), false),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
  }

  // ------------------------------------------------------------ lionfish records (USGS NAS)
  const lionColor = C.Color.fromCssColorString("#ff5f8f");
  for (const rec of LIONFISH) {
    viewer.entities.add({
      position: C.Cartesian3.fromDegrees(rec.lon, rec.lat, 10),
      point: {
        pixelSize: 4,
        color: new C.CallbackProperty(() => {
          const age = store.getState().t - rec.t;
          return lionColor.withAlpha(Math.max(0.15, 1 - age / 365) * 0.9);
        }, false),
        show: new C.CallbackProperty(() => {
          const s = store.getState();
          const age = s.t - rec.t;
          return s.layers.lionfish && siteVisible() && age >= 0 && age <= 365;
        }, false),
      },
    });
  }

  // ------------------------------------------------------------ interaction
  const handler = new C.ScreenSpaceEventHandler(scene.canvas);
  // Pins are small, so pick the nearest reef within a generous radius (or its label).
  const siteCart = SITES.map((st) => ({ id: st.id, pos: C.Cartesian3.fromDegrees(st.lon, st.lat, 30) }));
  const screenPos = new C.Cartesian2();
  const pickSite = (pos: CesiumNS.Cartesian2) => {
    let best: string | null = null;
    let bestD = 30;
    for (const st of siteCart) {
      const p = scene.cartesianToCanvasCoordinates(st.pos, screenPos);
      if (!p) continue;
      const d = Math.hypot(p.x - pos.x, p.y - pos.y);
      if (d < bestD) {
        bestD = d;
        best = st.id;
      }
    }
    if (best) return best;
    const picked = scene.pick(pos);
    const id: unknown = picked?.id?.id;
    return typeof id === "string" && id.startsWith("site:") ? id.slice(5) : null;
  };
  handler.setInputAction((e: { endPosition: CesiumNS.Cartesian2 }) => {
    if (store.getState().phase !== "region") return;
    hoverSite = pickSite(e.endPosition);
    scene.canvas.style.cursor = hoverSite ? "pointer" : "";
  }, C.ScreenSpaceEventType.MOUSE_MOVE);
  handler.setInputAction((e: { position: CesiumNS.Cartesian2 }) => {
    if (store.getState().phase !== "region") return;
    const id = pickSite(e.position);
    if (id) {
      store.getState().setSite(id);
      store.getState().setPhase("diving");
    }
  }, C.ScreenSpaceEventType.LEFT_CLICK);

  // ------------------------------------------------------------ camera choreography
  // Portrait screens get a taller, steeper framing of the reef arc (no horizon).
  const regionView = (): View =>
    container.clientWidth / Math.max(1, container.clientHeight) < 0.9
      ? { lon: -81.45, lat: 23.55, h: 560_000, heading: 0, pitch: -78 }
      : VIEWS.region;
  const dest = (v: View) => C.Cartesian3.fromDegrees(v.lon, v.lat, v.h);
  const orient = (v: View) => ({ heading: C.Math.toRadians(v.heading), pitch: C.Math.toRadians(v.pitch), roll: 0 });
  const setView = (v: View) => camera.setView({ destination: dest(v), orientation: orient(v) });
  const fly = (v: View, duration: number, easing = C.EasingFunction.QUADRATIC_IN_OUT, extra: Partial<Parameters<typeof camera.flyTo>[0]> = {}) =>
    new Promise<boolean>((resolve) =>
      camera.flyTo({
        destination: dest(v),
        orientation: orient(v),
        duration,
        easingFunction: easing,
        complete: () => resolve(true),
        cancel: () => resolve(false),
        ...extra,
      }),
    );

  setView(VIEWS.intro);
  // slow drift while the title is up, capped so Florida stays in frame
  let spinning = true;
  let drifted = 0;
  let last = performance.now();
  const removePre = scene.preRender.addEventListener(() => {
    const now = performance.now();
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (spinning && drifted < 0.07 && !store.getState().reducedMotion) {
      const a = 0.0035 * dt;
      drifted += a;
      camera.rotate(C.Cartesian3.UNIT_Z, -a);
    }
  });

  const animate = (ms: number, step: (k: number) => void) =>
    new Promise<void>((resolve) => {
      const t0 = performance.now();
      const tick = () => {
        const k = Math.min(1, (performance.now() - t0) / ms);
        step(k);
        if (k < 1) requestAnimationFrame(tick);
        else resolve();
      };
      tick();
    });
  const ease = (k: number) => 1 - Math.pow(1 - k, 3);

  // Opening: the reef draws itself on the dark side, then the city lights come up.
  // (Ground atmosphere stays on: Cesium's night-side darkening depends on it.)
  satellite.alpha = 0;
  night.alpha = 0;
  let introStarted = false;
  const startIntro = async () => {
    if (introStarted || store.getState().phase !== "boot") return;
    introStarted = true;
    store.getState().setPhase("intro");
    if (store.getState().reducedMotion) {
      tractProgress = 1;
      satellite.alpha = 1;
      night.alpha = 1;
      return;
    }
    const drawTract = animate(2600, (k) => (tractProgress = ease(k)));
    await new Promise((r) => setTimeout(r, 900));
    await Promise.all([
      drawTract,
      animate(3400, (k) => {
        satellite.alpha = ease(k);
        night.alpha = ease(k);
      }),
    ]);
  };
  // begin when the first tiles are in (or after a short grace period)
  const offTiles = globe.tileLoadProgressEvent.addEventListener((n: number) => {
    if (n === 0) {
      offTiles();
      startIntro();
    }
  });
  const introFallback = window.setTimeout(startIntro, 2200);

  let flightToken = 0;
  const flyToRegion = async () => {
    const token = ++flightToken;
    spinning = false;
    setInputs(false);
    tractProgress = 1;
    satellite.alpha = 1;
    night.alpha = 1;
    const { setCaption, reducedMotion } = store.getState();
    if (reducedMotion) {
      setSun(1);
      setView(regionView());
    } else {
      animate(8200, (k) => setSun(ease(k)));
      setCaption({ key: "atlantic", text: CAPTIONS.atlantic });
      await fly(VIEWS.atlantic, 3.2, C.EasingFunction.QUADRATIC_IN_OUT);
      if (token !== flightToken) return;
      setCaption({ key: "florida", text: CAPTIONS.florida });
      await fly(VIEWS.florida, 3.0, C.EasingFunction.SINUSOIDAL_IN_OUT);
      if (token !== flightToken) return;
      await fly(regionView(), 2.6, C.EasingFunction.QUADRATIC_OUT);
      if (token !== flightToken) return;
    }
    setCaption({ key: "region", text: CAPTIONS.region });
    store.getState().setPhase("region");
  };

  const diveTo = async (siteId: string) => {
    const token = ++flightToken;
    setInputs(false);
    const site = siteById(siteId);
    const { reducedMotion, setCaption, setCrossing, setPhase } = store.getState();
    setCaption(null);
    if (!reducedMotion) {
      await fly({ lon: site.lon, lat: site.lat - 0.07, h: 11_000, heading: 0, pitch: -58 }, 3.0, C.EasingFunction.QUADRATIC_IN_OUT, {
        maximumHeight: 260_000,
      });
      if (token !== flightToken) return;
      // the reef line gives way to the real shallows in the imagery
      animate(900, (k) => (tractAlpha = 1 - k));
      await fly({ lon: site.lon, lat: site.lat + 0.004, h: 2_600, heading: 0, pitch: -84 }, 2.2, C.EasingFunction.QUADRATIC_IN_OUT);
      if (token !== flightToken) return;
      // hold for the high-zoom imagery of the shallows before breaking the surface
      await new Promise<void>((resolve) => {
        const t0 = performance.now();
        const check = () => (globe.tilesLoaded || performance.now() - t0 > 1300 ? resolve() : requestAnimationFrame(check));
        check();
      });
      if (token !== flightToken) return;
    }
    setCrossing("plunge");
    await new Promise((r) => setTimeout(r, reducedMotion ? 50 : 820));
    if (token !== flightToken) return;
    setPhase("reef");
  };

  const ascend = async () => {
    const token = ++flightToken;
    viewer.useDefaultRenderLoop = true;
    animate(1600, (k) => (tractAlpha = k));
    const site = siteById(store.getState().siteId);
    setView({ lon: site.lon, lat: site.lat - 0.004, h: 900, heading: 0, pitch: -80 });
    const { reducedMotion } = store.getState();
    if (!reducedMotion) {
      await fly(regionView(), 3.2, C.EasingFunction.QUADRATIC_IN_OUT, { maximumHeight: 300_000 });
      if (token !== flightToken) return;
    } else setView(regionView());
    store.getState().setPhase("region");
  };

  const onPhase = (phase: Phase, prev: Phase) => {
    if (phase === "flying") flyToRegion();
    if (phase === "region") {
      setInputs(true);
      viewer.useDefaultRenderLoop = true;
      container.style.visibility = "visible";
      if (prev === "intro" || prev === "boot") {
        // skipped the flight
        spinning = false;
        tractProgress = 1;
        satellite.alpha = 1;
        night.alpha = 1;
        setSun(1);
        setView(regionView());
        store.getState().setCaption({ key: "region", text: CAPTIONS.region });
      }
    }
    if (phase === "diving") diveTo(store.getState().siteId);
    if (phase === "reef") {
      // hand the GPU to the reef scene
      window.setTimeout(() => {
        if (store.getState().phase === "reef") {
          viewer.useDefaultRenderLoop = false;
          container.style.visibility = "hidden";
        }
      }, 1200);
    }
    if (phase === "ascending") {
      container.style.visibility = "visible";
      ascend();
    }
    updateSst(true);
  };

  if (process.env.NODE_ENV !== "production") Object.assign(window, { __rs: { viewer, C, VIEWS, setSun } });

  const unsub = store.subscribe((s, p) => {
    if (s.phase !== p.phase) onPhase(s.phase, p.phase);
    if (s.t !== p.t || s.layers !== p.layers) updateSst();
  });

  return {
    destroy() {
      unsub();
      window.clearTimeout(introFallback);
      window.clearTimeout(sstTimer);
      removePre();
      handler.destroy();
      viewer.destroy();
    },
  };
}
