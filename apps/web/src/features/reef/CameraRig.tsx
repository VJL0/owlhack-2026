"use client";

import { useEffect, useRef, type ComponentRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { Vector3 } from "three";
import { useStore } from "@/lib/store";
import { CONSTELLATION_CENTER } from "./Constellation";

const POSES = {
  // just under the surface, looking down the reef slope
  entry: { pos: new Vector3(1.2, -0.7, 18.5), target: new Vector3(0, -4.2, 4) },
  reef: { pos: new Vector3(5.2, -4.5, 8.6), target: new Vector3(-0.5, -7.1, -4.5) },
  pressures: { pos: new Vector3(0.9, -2.3, 7.6), target: CONSTELLATION_CENTER.clone() },
};

type OrbitControlsImpl = ComponentRef<typeof OrbitControls>;

const easeInOut = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);

export default function CameraRig() {
  const controls = useRef<OrbitControlsImpl>(null);
  const { camera, size } = useThree();
  const pressuresOpen = useStore((s) => s.pressuresOpen);
  const reduced = useStore((s) => s.reducedMotion);
  const flight = useRef<{ from: { pos: Vector3; target: Vector3 }; to: { pos: Vector3; target: Vector3 }; t: number; dur: number } | null>(null);

  // portrait screens need more distance to fit the constellation's width
  const fit = (pose: { pos: Vector3; target: Vector3 }) => {
    const aspect = size.width / Math.max(1, size.height);
    if (aspect >= 1) return pose;
    const k = Math.min(2.2, 1 / aspect);
    const pos = pose.target.clone().add(pose.pos.clone().sub(pose.target).multiplyScalar(k));
    // aim lower so the subject sits in the upper half, above the bottom panels
    const lower = new Vector3(0, pose === POSES.pressures ? -3.2 : -1.2, 0);
    return { pos: pos.add(lower), target: pose.target.clone().add(lower) };
  };

  const flyTo = (to: { pos: Vector3; target: Vector3 }, dur: number) => {
    const c = controls.current;
    if (!c) return;
    if (reduced) {
      camera.position.copy(to.pos);
      c.target.copy(to.target);
      c.update();
      return;
    }
    flight.current = { from: { pos: camera.position.clone(), target: c.target.clone() }, to, t: 0, dur };
  };

  // the descent
  useEffect(() => {
    camera.position.copy(POSES.entry.pos);
    controls.current?.target.copy(POSES.entry.target);
    controls.current?.update();
    flyTo(fit(POSES.reef), 4.6);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    flyTo(fit(pressuresOpen ? POSES.pressures : POSES.reef), 2.4);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pressuresOpen]);

  useFrame((_, dt) => {
    const c = controls.current;
    const f = flight.current;
    if (!c) return;
    if (f) {
      f.t += dt;
      const k = easeInOut(Math.min(1, f.t / f.dur));
      camera.position.lerpVectors(f.from.pos, f.to.pos, k);
      c.target.lerpVectors(f.from.target, f.to.target, k);
      if (k >= 1) flight.current = null;
    }
    c.enabled = !flight.current;
    // hold still while pressures are open so nodes and arcs are easy to pick
    c.autoRotate = !flight.current && !reduced && !pressuresOpen;
    c.autoRotateSpeed = 0.22;
  });

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping
      dampingFactor={0.06}
      enablePan={false}
      minDistance={3.5}
      maxDistance={34}
      minPolarAngle={0.35}
      maxPolarAngle={1.62}
      rotateSpeed={0.55}
      zoomSpeed={0.7}
      onStart={() => {
        flight.current = null;
      }}
    />
  );
}
