"use client";

// Surface activity above the reef, from the SIMULATED AIS / SAR series
// (Global Fishing Watch is not connected yet). Hulls are silhouettes against
// the surface; their shadows cross the reef through the shared uBoats uniform.

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { AdditiveBlending, CapsuleGeometry, Color, DoubleSide, Group, Mesh, PlaneGeometry, RingGeometry, ShaderMaterial } from "three";
import { COMMON, OUTPUT } from "./glsl";
import { U, envNow } from "./env";
import { mulberry32 } from "./terrain";

const hullFrag = /* glsl */ `
${COMMON}
varying vec3 vWorld;
void main() {
  vec3 c = vec3(0.004, 0.018, 0.026);
  gl_FragColor = vec4(applyWater(c, vWorld), 1.0);
  ${OUTPUT}
}`;

const worldVert = /* glsl */ `
varying vec3 vWorld;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const wakeFrag = /* glsl */ `
${COMMON}
uniform float uFade;
uniform float uDashed;
varying vec2 vUv;
varying vec3 vWorld;
void main() {
  float along = clamp(vUv.x, 0.0, 1.0);             // 1 at the stern, 0 far behind
  float across = clamp(1.0 - abs(vUv.y * 2.0 - 1.0), 0.0, 1.0);
  float foam = 0.55 + 0.45 * vnoise(vec2(vWorld.x * 1.6 - uTime * 2.0, vWorld.z * 3.0));
  float a = pow(along, 1.8) * pow(across, 1.5) * foam * 0.5 * uFade;
  // simulated AIS track: hatched line, so it never reads as observed data
  if (uDashed > 0.5) a = step(0.5, fract(vWorld.x * 0.8)) * pow(across, 4.0) * along * 0.55 * uFade;
  float d = length(vWorld - uCamPos);
  a *= 1.0 - smoothstep(30.0, 80.0, d);
  gl_FragColor = vec4(mix(vec3(0.8, 0.95, 1.0), vec3(0.56, 0.83, 1.0), uDashed) * a, a);
}`;

const pingFrag = /* glsl */ `
${COMMON}
uniform vec3 uColor;
uniform float uOpacity;
uniform float uDashed;
varying vec3 vLocal;
void main() {
  float ang = atan(vLocal.z, vLocal.x) / 6.2831853;
  float dash = uDashed > 0.5 ? step(0.5, fract(ang * 36.0)) : 1.0;
  float a = uOpacity * dash;
  gl_FragColor = vec4(uColor * a, a);
}`;

const localVert = /* glsl */ `
varying vec3 vLocal;
void main() {
  vLocal = position;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
}`;

interface Slot {
  kind: "traffic" | "fishing";
  z: number;
  dir: 1 | -1;
  speed: number;
  len: number;
  beam: number;
  phase: number;
}

const SPAN = 150;

export default function Traffic() {
  const slots = useMemo<Slot[]>(() => {
    const rand = mulberry32(5);
    const out: Slot[] = [];
    for (let i = 0; i < 10; i++) {
      const fishing = i >= 6;
      out.push({
        kind: fishing ? "fishing" : "traffic",
        z: -34 + rand() * 50,
        dir: rand() < 0.5 ? 1 : -1,
        speed: fishing ? 1.2 + rand() * 1.2 : 3 + rand() * 4,
        len: fishing ? 4 + rand() * 3 : 9 + rand() * 14,
        beam: fishing ? 1.6 : 2.4 + rand() * 2,
        phase: rand() * SPAN,
      });
    }
    return out;
  }, []);

  const hullGeo = useMemo(() => {
    const g = new CapsuleGeometry(0.5, 1, 4, 12);
    g.rotateZ(Math.PI / 2);
    return g;
  }, []);
  const wakeGeo = useMemo(() => {
    const g = new PlaneGeometry(1, 1, 1, 1);
    g.rotateX(Math.PI / 2);
    return g;
  }, []);
  const hullMat = useMemo(() => new ShaderMaterial({ uniforms: { ...U }, vertexShader: worldVert, fragmentShader: hullFrag }), []);
  const wakeMats = useMemo(
    () =>
      slots.map(
        (s) =>
          new ShaderMaterial({
            uniforms: { ...U, uFade: { value: 0 }, uDashed: { value: s.kind === "fishing" ? 1 : 0 } },
            vertexShader: worldVert,
            fragmentShader: wakeFrag,
            transparent: true,
            depthWrite: false,
            blending: AdditiveBlending,
            side: DoubleSide,
          }),
      ),
    [slots],
  );

  const pingGeo = useMemo(() => {
    const g = new RingGeometry(0.96, 1, 96, 1);
    g.rotateX(Math.PI / 2);
    return g;
  }, []);
  const pingMats = useMemo(
    () =>
      Array.from(
        { length: 8 },
        () =>
          new ShaderMaterial({
            uniforms: { ...U, uColor: { value: new Color("#8fd3ff") }, uOpacity: { value: 0 }, uDashed: { value: 0 } },
            vertexShader: localVert,
            fragmentShader: pingFrag,
            transparent: true,
            depthWrite: false,
            blending: AdditiveBlending,
            side: DoubleSide,
          }),
      ),
    [],
  );

  const hulls = useRef<(Group | null)[]>([]);
  const wakes = useRef<(Mesh | null)[]>([]);
  const pings = useRef<(Mesh | null)[]>([]);
  const fade = useRef(slots.map(() => 0));
  const coral = useMemo(() => new Color("#ff7b61"), []);
  const cyan = useMemo(() => new Color("#8fd3ff"), []);

  useFrame(({ clock }, dt) => {
    const t = clock.elapsedTime;
    const target = envNow.target;
    const vessels = target?.vessels ?? 0;
    const fishing = target?.fishingVessels ?? 0;
    slots.forEach((s, i) => {
      const active = s.kind === "traffic" ? i < vessels : i - 6 < fishing;
      fade.current[i] += ((active ? 1 : 0) - fade.current[i]) * Math.min(1, dt * 1.5);
      const f = fade.current[i];
      const x = ((((s.phase + t * s.speed * s.dir) % SPAN) + SPAN) % SPAN) - SPAN / 2;
      const hull = hulls.current[i];
      const wake = wakes.current[i];
      if (hull) {
        hull.visible = f > 0.02;
        hull.position.set(x, -0.35 - (1 - f) * 2, s.z);
        hull.scale.set(s.len, 0.7, s.beam);
      }
      if (wake) {
        const wl = s.kind === "fishing" ? 34 : s.len * 1.8;
        wake.visible = f > 0.02;
        wake.position.set(x - (s.dir * (wl + s.len)) / 2, -0.06, s.z);
        wake.scale.set(wl, 1, s.kind === "fishing" ? 0.9 : s.beam * 1.4);
        wake.rotation.y = s.dir > 0 ? 0 : Math.PI;
        (wake.material as ShaderMaterial).uniforms.uFade.value = f;
      }
      U.uBoats.value[i].set(x, s.z, f > 0.05 ? (s.len / 2) * f : 0, s.beam / 2);
    });

    // SAR detections: rings that bloom on the surface; unmatched to AIS are dashed coral
    const sar = target?.sar ?? 0;
    const unmatched = target?.sarUnmatched ?? 0;
    const active = Math.min(8, Math.ceil(sar / 3));
    const unm = Math.min(active, Math.ceil(unmatched / 3));
    pings.current.forEach((m, i) => {
      if (!m) return;
      const cycle = t / 6 + i * 0.137;
      const k = cycle % 1;
      const n = Math.floor(cycle);
      const rand = mulberry32(n * 31 + i * 7);
      m.visible = i < active;
      m.position.set((rand() - 0.5) * 70, -0.12, -40 + rand() * 55);
      m.scale.setScalar(0.6 + k * 5.5);
      const mat = m.material as ShaderMaterial;
      mat.uniforms.uOpacity.value = (1 - k) * 0.75;
      const isUnmatched = i < unm;
      mat.uniforms.uDashed.value = isUnmatched ? 1 : 0;
      (mat.uniforms.uColor.value as Color).copy(isUnmatched ? coral : cyan);
    });
  });

  return (
    <group>
      {slots.map((s, i) => (
        <group key={i}>
          <group ref={(el) => (hulls.current[i] = el)}>
            <mesh geometry={hullGeo} material={hullMat} />
          </group>
          <mesh ref={(el) => (wakes.current[i] = el)} geometry={wakeGeo} material={wakeMats[i]} renderOrder={3} />
        </group>
      ))}
      {pingMats.map((mat, i) => (
        <mesh key={i} ref={(el) => (pings.current[i] = el)} geometry={pingGeo} material={mat} renderOrder={3} />
      ))}
    </group>
  );
}
