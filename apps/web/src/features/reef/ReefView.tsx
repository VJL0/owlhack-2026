"use client";

import { useEffect, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { PerformanceMonitor } from "@react-three/drei";
import { useStore } from "@/lib/store";
import { SITES } from "@/lib/data";
import { setTerrainSite } from "./terrain";
import { U, envNow, envTarget, stepEnv } from "./env";
import { LightShafts, MarineSnow, SeaSurface, Seafloor, WaterVolume } from "./Environment";
import Corals from "./Corals";
import Fish from "./Fish";
import Lionfish from "./Lionfish";
import Traffic from "./Traffic";
import Constellation from "./Constellation";
import CameraRig from "./CameraRig";
import Effects from "./Effects";
import LabelLayer from "./LabelLayer";
import { bridge } from "./labels";

/** Shares the live camera with the DOM label layer. */
function CameraBridge() {
  useFrame(({ camera, size }) => {
    bridge.camera = camera;
    bridge.width = size.width;
    bridge.height = size.height;
  });
  return null;
}

/** Pushes the data-driven environment into the shared uniforms. */
function EnvDriver({ dim }: { dim: number }) {
  useEffect(() => {
    const update = () => {
      const s = useStore.getState();
      envNow.target = envTarget(s.siteId, s.t);
    };
    update();
    return useStore.subscribe((s, p) => {
      if (s.t !== p.t || s.siteId !== p.siteId) update();
    });
  }, []);
  useFrame(({ clock, camera }, dt) => {
    U.uTime.value = clock.elapsedTime;
    U.uCamPos.value.copy(camera.position);
    if (envNow.target) stepEnv(envNow.target, dim, Math.min(dt, 0.1));
  });
  return null;
}

/** Tells the dive overlay the scene has compiled and drawn. */
function ReadySignal() {
  const frames = useRef(0);
  useFrame(() => {
    frames.current++;
    if (frames.current === 3) useStore.getState().setReefReady(true);
  });
  return null;
}

export default function ReefView() {
  const siteIndex = useStore((s) => Math.max(0, SITES.findIndex((x) => x.id === s.siteId)));
  // must run before any child builds geometry from the terrain
  setTerrainSite(siteIndex);
  const pressuresOpen = useStore((s) => s.pressuresOpen);
  const reduced = useStore((s) => s.reducedMotion);
  const select = useStore((s) => s.select);
  const [quality, setQuality] = useState<"high" | "low">("high");

  useEffect(() => {
    // snap the environment to the current date so the first frame is right
    const s = useStore.getState();
    const target = envTarget(s.siteId, s.t);
    envNow.target = target;
    stepEnv(target, 0, 10);
    return () => useStore.getState().setReefReady(false);
  }, []);

  return (
    <div className="stage-layer" style={{ background: "#021423" }}>
      <Canvas
        dpr={quality === "high" ? [1, 1.5] : [1, 1]}
        gl={{ antialias: false, powerPreference: "high-performance", stencil: false }}
        camera={{ fov: 52, near: 0.1, far: 420, position: [1.2, -0.7, 18.5] }}
        onPointerMissed={() => select(null)}
        onCreated={(state) => {
          if (process.env.NODE_ENV !== "production") Object.assign(window, { __r3f: state });
        }}
        aria-label="Underwater view of the reef. Use the controls and timeline around it; the same information is available as text."
      >
        <PerformanceMonitor onDecline={() => setQuality("low")} />
        <EnvDriver dim={pressuresOpen ? 1 : 0} />
        <WaterVolume />
        <SeaSurface />
        <Seafloor />
        <Corals seed={siteIndex} />
        <Fish />
        <Lionfish />
        <Traffic />
        <LightShafts count={quality === "high" ? 18 : 10} />
        <MarineSnow count={reduced || quality === "low" ? 900 : 2600} />
        <Constellation open={pressuresOpen} />
        <CameraRig />
        <Effects quality={quality} />
        <ReadySignal />
        <CameraBridge />
      </Canvas>
      <LabelLayer />
    </div>
  );
}
