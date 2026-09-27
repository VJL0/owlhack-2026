import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { SparkRenderer, SplatMesh } from "@sparkjsdev/spark";
import type { SplatSurvey } from "@/lib/flagships";

/** Spark draws every SplatMesh in the scene through one renderer object. */
function Spark() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    const spark = new SparkRenderer({ renderer: gl });
    scene.add(spark);
    return () => {
      scene.remove(spark);
      spark.dispose?.();
    };
  }, [gl, scene]);
  return null;
}

/**
 * One dated survey. All surveys of a plot share the plot's frame (z up, metres),
 * so switching dates shows real change in place. Loaded once, then cross-faded.
 */
function Survey({ survey, shown, onState }: { survey: SplatSurvey; shown: boolean; onState: (file: string, s: "loading" | "ready" | "error", progress?: number) => void }) {
  const mesh = useMemo(
    () =>
      new SplatMesh({
        url: survey.file,
        onProgress: (e) => e.lengthComputable && onState(survey.file, "loading", e.loaded / e.total),
      }),
    // onState is stable for the lifetime of the scene
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [survey.file],
  );
  useEffect(() => {
    let live = true;
    mesh.opacity = 0;
    mesh.initialized.then(
      () => live && onState(survey.file, "ready"),
      // disposing a mesh mid-load rejects with "Worker terminate": not an error for us
      () => live && onState(survey.file, "error"),
    );
    return () => {
      live = false;
      mesh.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mesh]);
  useFrame((_, dt) => {
    const target = shown && mesh.isInitialized ? 1 : 0;
    mesh.opacity += (target - mesh.opacity) * Math.min(1, dt * 7);
    mesh.visible = mesh.opacity > 0.01;
  });
  return <primitive object={mesh} />;
}

/** Resting view: three-quarters from the south, far enough to hold the whole plot. */
const restPose = (extent: number): [number, number, number] => [extent * 0.18, extent * 0.62, extent * 0.78];

function Rig({ reduced, extent }: { reduced: boolean; extent: number }) {
  const camera = useThree((s) => s.camera);
  const t0 = useRef<number | null>(null);
  const [x, y, z] = restPose(extent);
  // A slow descent onto the plot, unless the viewer prefers reduced motion.
  useFrame(({ clock }) => {
    if (reduced) return;
    t0.current ??= clock.elapsedTime;
    const k = Math.min(1, (clock.elapsedTime - t0.current) / 3.6);
    if (k >= 1) return;
    const e = 1 - Math.pow(1 - k, 3);
    camera.position.set(x, y + extent * 0.9 * (1 - e), z + extent * 0.4 * (1 - e));
    camera.lookAt(0, -0.3, 0);
  });
  return null;
}

export default function SplatScene({
  surveys,
  index,
  reduced,
  onState,
  extent,
}: {
  surveys: SplatSurvey[];
  index: number;
  reduced: boolean;
  onState: (file: string, s: "loading" | "ready" | "error", progress?: number) => void;
  extent: number;
}) {
  return (
    <Canvas
      dpr={[1, 1.5]}
      gl={{ antialias: false, powerPreference: "high-performance" }}
      camera={{ fov: 50, near: 0.02, far: 200, position: restPose(extent) }}
      onCreated={({ scene, camera }) => {
        scene.background = null;
        camera.lookAt(0, -0.3, 0);
        if (process.env.NODE_ENV !== "production") Object.assign(window, { __splat: { scene, camera } });
      }}
      aria-label="Photogrammetric 3D model of the reef plot. Use the survey buttons to change the date."
    >
      <Spark />
      {/* The plot frame is z-up; three.js is y-up. */}
      <group rotation={[-Math.PI / 2, 0, 0]}>
        {surveys.map((s, i) => (
          <Survey key={s.file} survey={s} shown={i === index} onState={onState} />
        ))}
      </group>
      <Rig reduced={reduced} extent={extent} />
      <OrbitControls makeDefault target={[0, -0.3, 0]} enableDamping dampingFactor={0.08} minDistance={1} maxDistance={extent * 2} maxPolarAngle={Math.PI * 0.49} />
    </Canvas>
  );
}
