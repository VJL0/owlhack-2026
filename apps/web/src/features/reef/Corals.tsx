"use client";

import { useLayoutEffect, useMemo, useRef } from "react";
import {
  BufferGeometry,
  Color,
  DoubleSide,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Quaternion,
  ShaderMaterial,
  Vector3,
} from "three";
import { COMMON, OUTPUT } from "./glsl";
import { U } from "./env";
import { barrel, brain, branching, fan, mound } from "./coralGeometry";
import { floorHeight, mulberry32, spurAmount } from "./terrain";

const coralVert = /* glsl */ `
${COMMON}
attribute float aSeed;
attribute float aTip;
varying vec3 vWorld;
varying vec3 vN;
varying vec3 vObj;
varying vec3 vCol;
varying vec2 vUv;
varying float vSeed;
varying float vTip;
void main() {
  vec3 p = position;
  #ifdef SWAY
    float h = aTip * aTip;
    float ph = uTime * (0.9 + uStorm * 2.4) + aSeed * 6.2831;
    float amp = (0.07 + uStorm * 0.55) * h;
    p.x += sin(ph + p.y * 0.9) * amp;
    p.z += cos(ph * 0.83 + p.y * 0.7) * amp * 0.7;
  #endif
  vec4 w = modelMatrix * instanceMatrix * vec4(p, 1.0);
  vWorld = w.xyz;
  vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
  vObj = position;
  vUv = uv;
  vSeed = aSeed;
  vTip = aTip;
  #ifdef USE_INSTANCING_COLOR
    vCol = instanceColor;
  #else
    vCol = vec3(0.6);
  #endif
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const coralFrag = /* glsl */ `
${COMMON}
uniform float uBleach;
uniform float uFluor;
uniform float uDead;
uniform vec3 uRim;
varying vec3 vWorld;
varying vec3 vN;
varying vec3 vObj;
varying vec3 vCol;
varying vec2 vUv;
varying float vSeed;
varying float vTip;

void main() {
  vec3 n = safeNormalize(vN);
  if (!gl_FrontFacing) n = -n;
  vec3 base = vCol;
  float detail = 1.0;

  #ifdef PAT_POLYPS
    float c = cellEdge(vObj.xz * 17.0 + vObj.y * 11.0, 0.0);
    float polyp = smoothstep(0.02, 0.3, c);
    base *= 0.8 + 0.28 * polyp;
    detail = polyp;
  #endif

  #ifdef PAT_BRAIN
    vec2 q = vObj.xz * 5.5 + vec2(fbm(vObj.xz * 1.6 + vSeed * 9.0), fbm(vObj.xz * 1.6 - vSeed * 5.0)) * 4.0;
    float m = abs(sin(q.x + sin(q.y * 0.9) * 1.6));
    float ridge = smoothstep(0.35, 0.95, m);
    base = mix(base * vec3(0.55, 0.62, 0.42), base * 1.25, ridge);
    detail = ridge;
  #endif

  #ifdef PAT_BRANCH
    base = mix(base, vec3(0.93, 0.88, 0.76), smoothstep(0.82, 1.0, vTip) * 0.8);
    base *= 0.85 + 0.3 * vnoise(vec2(vTip * 40.0, vSeed * 30.0 + vObj.y * 25.0));
  #endif

  #ifdef PAT_BARREL
    float ang = atan(vObj.z, vObj.x);
    float r = sin(ang * 26.0 + vObj.y * 3.0 + fbm(vObj.xy * 3.0) * 2.0);
    base *= 0.75 + 0.35 * smoothstep(-0.4, 0.8, r);
  #endif

  #ifdef PAT_FAN
    vec2 uv = vUv * vec2(36.0, 30.0);
    uv += vec2(fbm(vUv * 4.0 + vSeed * 7.0), fbm(vUv * 4.0 - vSeed * 3.0)) * 2.2;
    vec2 g = abs(fract(uv) - 0.5);
    float line = min(g.x, g.y);
    vec2 e = (vUv - vec2(0.5, 0.52)) / vec2(0.5, 0.5);
    if (line > 0.17 || dot(e, e) > 1.0) discard;
    base *= 0.85 + 0.3 * (1.0 - line * 5.0);
  #endif

  // susceptibility varies by colony
  float sus = 0.62 + 0.38 * fract(vSeed * 17.13);
  float b = clamp(uBleach * sus * 1.12, 0.0, 1.0);
  #ifdef NO_BLEACH
    b = 0.0;
  #endif
  vec3 bone = vec3(0.93, 0.91, 0.85);
  vec3 col = mix(base, bone * (0.9 + 0.1 * detail), b);

  // after the 2023 event, almost all Acropora colonies died; skeletons fur over with turf algae
  #ifdef ACROPORA
    float died = uDead * step(fract(vSeed * 7.7), 0.97);
    vec3 turf = vec3(0.16, 0.18, 0.12) * (0.7 + 0.6 * vnoise(vObj.xz * 24.0 + vObj.y * 17.0));
    col = mix(col, turf, died);
  #endif

  float ndl = max(dot(n, uSunDir), 0.0) * sunVis(vWorld);
  vec3 amb = mix(uWaterDeep * 1.7, uWaterShallow * 2.1, n.y * 0.5 + 0.5);
  vec3 lit = col * (amb + uSunColor * ndl * 0.9);
  lit += col * uSunColor * causticsAt(vWorld, n) * 1.45;

  vec3 V = normalize(uCamPos - vWorld);
  float fr = pow(clamp(1.0 - dot(n, V), 0.0, 1.0), 3.0);
  // fluorescent pigments glow under moderate heat stress ("colourful bleaching")
  vec3 fl = fract(vSeed * 3.1) < 0.5 ? vec3(0.2, 1.0, 0.62) : vec3(1.0, 0.32, 0.74);
  float flAmt = uFluor * sus;
  #ifdef NO_BLEACH
    flAmt = 0.0;
  #endif
  #ifdef ACROPORA
    flAmt *= 1.0 - uDead;
  #endif
  lit += fr * (uRim * 0.22 + fl * flAmt * 1.3);
  lit += fl * flAmt * 0.22 * (0.4 + 0.6 * detail);
  lit *= 1.0 - uDim * 0.62;
  gl_FragColor = vec4(applyWater(lit, vWorld), 1.0);
  ${OUTPUT}
}`;

type Kind = "mound" | "brain" | "staghorn" | "elkhorn" | "fan" | "rod" | "barrel" | "tube" | "head";

interface KindDef {
  max: number;
  spacing: number;
  weight: number;
  scale: [number, number];
  colors: string[];
  defines: Record<string, string>;
  sink: number;
  /** minimum spur value where this kind settles */
  minSpur: number;
}

const KINDS: Record<Kind, KindDef> = {
  mound: { max: 34, spacing: 2.2, weight: 0.1, scale: [0.9, 2.3], colors: ["#8a7a48", "#7c6b3a", "#6d7a44", "#998458"], defines: { PAT_POLYPS: "" }, sink: 0.14, minSpur: 0.45 },
  brain: { max: 30, spacing: 1.5, weight: 0.09, scale: [0.5, 1.2], colors: ["#b0995a", "#948f52", "#b89e68", "#8d8b5a"], defines: { PAT_BRAIN: "" }, sink: 0.08, minSpur: 0.4 },
  staghorn: { max: 30, spacing: 1.3, weight: 0.08, scale: [0.9, 1.6], colors: ["#b08a55", "#a07c4b", "#bb9460"], defines: { PAT_BRANCH: "", ACROPORA: "" }, sink: 0.05, minSpur: 0.5 },
  elkhorn: { max: 16, spacing: 2.4, weight: 0.06, scale: [1.0, 1.7], colors: ["#c49b5c", "#b88d50"], defines: { PAT_BRANCH: "", ACROPORA: "" }, sink: 0.05, minSpur: 0.55 },
  fan: { max: 56, spacing: 0.9, weight: 0.12, scale: [0.6, 1.35], colors: ["#7a3f8f", "#8e4aa2", "#6b3584", "#a39a3e"], defines: { PAT_FAN: "", SWAY: "", NO_BLEACH: "" }, sink: 0.05, minSpur: 0.3 },
  rod: { max: 190, spacing: 0.45, weight: 0.28, scale: [0.8, 1.7], colors: ["#5e3350", "#6c3d2e", "#7a4a6e", "#4f3a2a", "#8a5a3a"], defines: { PAT_BRANCH: "", SWAY: "", NO_BLEACH: "" }, sink: 0.02, minSpur: 0.25 },
  barrel: { max: 10, spacing: 2.6, weight: 0.03, scale: [0.8, 1.4], colors: ["#7e3b2d", "#8a4a38", "#733528"], defines: { PAT_BARREL: "", NO_BLEACH: "" }, sink: 0.1, minSpur: 0.4 },
  tube: { max: 40, spacing: 0.9, weight: 0.06, scale: [0.6, 1.2], colors: ["#6a3f86", "#c9a63a", "#7d5aa0", "#b0572f"], defines: { PAT_BARREL: "", NO_BLEACH: "" }, sink: 0.02, minSpur: 0.35 },
  head: { max: 170, spacing: 0.5, weight: 0.18, scale: [0.18, 0.5], colors: ["#8a7a48", "#a8955a", "#6d7a44", "#9a6b4a", "#7c8a55"], defines: { PAT_POLYPS: "" }, sink: 0.03, minSpur: 0.3 },
};

interface Placement {
  x: number;
  y: number;
  z: number;
  s: number;
  ry: number;
  tilt: number;
  seed: number;
  color: Color;
}

function place(seed: number): Record<Kind, Placement[]> {
  const rand = mulberry32(42 + seed * 101);
  const out = Object.fromEntries(Object.keys(KINDS).map((k) => [k, []])) as unknown as Record<Kind, Placement[]>;
  const kinds = Object.keys(KINDS) as Kind[];
  const total = kinds.reduce((a, k) => a + KINDS[k].weight, 0);
  for (let i = 0; i < 16000; i++) {
    // denser toward the part of the reef the camera frames
    const focus = rand() < 0.6;
    const x = focus ? (rand() - 0.5) * 34 : (rand() - 0.5) * 66;
    const z = focus ? -22 + rand() * 30 : -40 + rand() * 58;
    const spur = spurAmount(x, z);
    let r = rand() * total;
    let kind: Kind = "rod";
    for (const k of kinds) {
      r -= KINDS[k].weight;
      if (r <= 0) {
        kind = k;
        break;
      }
    }
    const K = KINDS[kind];
    if (spur < K.minSpur && rand() > 0.04) continue;
    if (kind === "elkhorn" && z > 0) continue; // elkhorn favours the shallow crest
    if (out[kind].length >= K.max) continue;
    const s = K.scale[0] + (K.scale[1] - K.scale[0]) * rand();
    const clash = kinds.some((k) =>
      out[k].some((p) => {
        const min = Math.max(KINDS[k].spacing * p.s, K.spacing * s) * (k === kind ? 1 : 0.5);
        return (p.x - x) ** 2 + (p.z - z) ** 2 < min * min;
      }),
    );
    if (clash) continue;
    const c = new Color(K.colors[Math.floor(rand() * K.colors.length)]);
    c.offsetHSL((rand() - 0.5) * 0.03, (rand() - 0.5) * 0.1, (rand() - 0.5) * 0.08);
    out[kind].push({
      x,
      z,
      y: floorHeight(x, z) - K.sink * s,
      s,
      ry: rand() * Math.PI * 2,
      tilt: (rand() - 0.5) * 0.3,
      seed: rand(),
      color: c,
    });
  }
  return out;
}

function makeMaterial(defines: Record<string, string>) {
  return new ShaderMaterial({
    uniforms: { ...U, uRim: { value: new Color("#6ff3e3") } },
    vertexShader: coralVert,
    fragmentShader: coralFrag,
    defines,
    ...(defines.PAT_FAN !== undefined ? { side: DoubleSide } : {}),
  });
}

function Colony({ geometries, items, defines }: { geometries: BufferGeometry[]; items: Placement[]; defines: Record<string, string> }) {
  // spread instances across geometry variants
  const groups = useMemo(() => geometries.map((g, gi) => ({ g, items: items.filter((_, i) => i % geometries.length === gi) })), [geometries, items]);
  const material = useMemo(() => makeMaterial(defines), [defines]);
  return (
    <>
      {groups.map(({ g, items }, i) => (items.length ? <ColonyMesh key={i} geometry={g} material={material} items={items} /> : null))}
    </>
  );
}

function ColonyMesh({ geometry, material, items }: { geometry: BufferGeometry; material: ShaderMaterial; items: Placement[] }) {
  const ref = useRef<InstancedMesh>(null);
  // each mesh owns its geometry copy because the per-instance seed attribute lives on it
  const own = useMemo(() => geometry.clone(), [geometry]);
  useLayoutEffect(() => {
    const mesh = ref.current!;
    const m = new Matrix4();
    const q = new Quaternion();
    const tiltQ = new Quaternion();
    const seeds = new Float32Array(items.length);
    items.forEach((p, i) => {
      q.setFromAxisAngle(new Vector3(0, 1, 0), p.ry);
      tiltQ.setFromAxisAngle(new Vector3(1, 0, 0), p.tilt);
      q.multiply(tiltQ);
      m.compose(new Vector3(p.x, p.y, p.z), q, new Vector3(p.s, p.s, p.s));
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, p.color);
      seeds[i] = p.seed;
    });
    mesh.geometry.setAttribute("aSeed", new InstancedBufferAttribute(seeds, 1));
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [items]);
  return <instancedMesh ref={ref} args={[own, material, items.length]} />;
}

export default function Corals({ seed = 0 }: { seed?: number }) {
  const placements = useMemo(() => place(seed), [seed]);
  const geos = useMemo(() => {
    const rand = mulberry32(7);
    return {
      mound: [mound(0.3), mound(1.7), mound(2.9)],
      brain: [brain()],
      staghorn: [0, 1, 2].map(() =>
        branching(rand, { depth: 5, len: [0.22, 0.36], radius: 0.034, taper: 0.86, spread: [0.35, 0.8], children: [1, 3], upBias: 0.25, segs: 6, capTips: true }),
      ),
      elkhorn: [0, 1].map(() =>
        branching(rand, { depth: 5, len: [0.2, 0.34], radius: 0.075, taper: 0.84, spread: [0.45, 0.95], children: [2, 3], upBias: 0.2, segs: 12, cross: [2.0, 0.72], capTips: true }),
      ),
      fan: [fan()],
      rod: [0, 1, 2].map(() =>
        branching(rand, { depth: 3, len: [0.38, 0.62], radius: 0.022, taper: 0.8, spread: [0.2, 0.55], children: [1, 3], upBias: 0.55, segs: 5, capTips: true }),
      ),
      barrel: [barrel()],
      tube: [0, 1].map(() =>
        branching(rand, { depth: 2, len: [0.35, 0.6], radius: 0.07, taper: 0.95, spread: [0.15, 0.35], children: [2, 3], upBias: 0.7, segs: 10 }),
      ),
      head: [mound(4.2), brain()],
    } satisfies Record<Kind, BufferGeometry[]>;
  }, []);

  return (
    <group>
      {(Object.keys(KINDS) as Kind[]).map((k) => (
        <Colony key={k} geometries={geos[k]} items={placements[k]} defines={KINDS[k].defines} />
      ))}
    </group>
  );
}
