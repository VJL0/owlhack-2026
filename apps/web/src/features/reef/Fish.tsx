"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  InstancedBufferAttribute,
  InstancedMesh,
  LatheGeometry,
  Matrix4,
  Quaternion,
  ShaderMaterial,
  Vector2,
  Vector3,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { COMMON, OUTPUT } from "./glsl";
import { U } from "./env";
import { floorHeight, mulberry32 } from "./terrain";

const fishVert = /* glsl */ `
${COMMON}
attribute float aBody;
attribute float aSeed;
attribute float aSpecies;
varying vec3 vWorld;
varying vec3 vN;
varying vec3 vObj;
varying float vBody;
varying float vSpecies;
void main() {
  vec3 p = position;
  float wave = sin(uTime * (8.0 + aSeed * 4.0) + aSeed * 40.0 - position.z * 7.0);
  p.x += wave * 0.06 * pow(max(aBody, 0.0), 1.5);
  vec4 w = modelMatrix * instanceMatrix * vec4(p, 1.0);
  vWorld = w.xyz;
  vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
  vObj = position;
  vBody = aBody;
  vSpecies = aSpecies;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const fishFrag = /* glsl */ `
${COMMON}
varying vec3 vWorld;
varying vec3 vN;
varying vec3 vObj;
varying float vBody;
varying float vSpecies;
void main() {
  vec3 n = safeNormalize(vN);
  if (!gl_FrontFacing) n = -n;
  vec3 col;
  if (vSpecies < 0.5) {
    // yellowtail snapper: blue-silver body, yellow midline stripe and tail
    col = mix(vec3(0.36, 0.44, 0.62), vec3(0.8, 0.84, 0.9), smoothstep(0.05, -0.1, vObj.y));
    float stripe = smoothstep(0.035, 0.012, abs(vObj.y - 0.01)) * step(vObj.z, 0.36);
    col = mix(col, vec3(1.0, 0.8, 0.16), max(stripe, smoothstep(0.78, 0.84, vBody)));
  } else if (vSpecies < 1.5) {
    // blue tang
    col = vec3(0.1, 0.24, 0.78) * (0.9 + 0.2 * smoothstep(-0.1, 0.12, vObj.y));
    col = mix(col, vec3(0.95, 0.85, 0.4), smoothstep(0.66, 0.7, vBody) * (1.0 - smoothstep(0.72, 0.76, vBody)) * 0.8);
  } else if (vSpecies < 2.5) {
    // bluestriped grunt
    col = vec3(0.95, 0.78, 0.25);
    float s = smoothstep(0.55, 0.8, sin(vObj.y * 58.0 + vObj.z * 5.0));
    col = mix(col, vec3(0.28, 0.52, 0.92), s * step(vBody, 0.8));
  } else {
    // sergeant major: pale with five dark bars
    col = mix(vec3(0.78, 0.84, 0.62), vec3(0.95, 0.9, 0.45), smoothstep(-0.02, 0.1, vObj.y));
    float bar = smoothstep(0.35, 0.6, sin(vObj.z * 30.0)) * step(vBody, 0.78);
    col = mix(col, vec3(0.06, 0.07, 0.08), bar * 0.85);
  }
  col *= mix(0.6, 1.15, smoothstep(-0.12, 0.12, vObj.y)); // countershading
  float ndl = max(dot(n, uSunDir), 0.0);
  vec3 amb = mix(uWaterDeep * 2.0, uWaterShallow * 2.2, n.y * 0.5 + 0.5);
  vec3 lit = col * (amb + uSunColor * ndl * 0.9);
  vec3 V = normalize(uCamPos - vWorld);
  float fr = pow(clamp(1.0 - dot(n, V), 0.0, 1.0), 2.5);
  lit += fr * uSunColor * 0.18;
  lit *= 1.0 - uDim * 0.6;
  gl_FragColor = vec4(applyWater(lit, vWorld), 1.0);
  ${OUTPUT}
}`;

function fishGeometry() {
  const profile = [
    [0.001, -0.5],
    [0.05, -0.42],
    [0.1, -0.24],
    [0.15, -0.02],
    [0.16, 0.12],
    [0.13, 0.3],
    [0.07, 0.44],
    [0.001, 0.5],
  ].map(([r, y]) => new Vector2(r, y));
  const body = new LatheGeometry(profile, 14);
  body.rotateX(Math.PI / 2);
  body.scale(0.42, 1, 1);

  const fin = (pts: number[][]) => {
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(new Float32Array(pts.flat()), 3));
    g.setAttribute("normal", new BufferAttribute(new Float32Array(pts.flatMap(() => [1, 0, 0])), 3));
    g.setAttribute("uv", new BufferAttribute(new Float32Array(pts.flatMap(() => [0, 0])), 2));
    g.setIndex(pts.map((_, i) => i));
    return g;
  };
  const tail = fin([
    [0, 0, -0.44],
    [0, 0.21, -0.74],
    [0, 0.03, -0.6],
    [0, 0, -0.44],
    [0, -0.03, -0.6],
    [0, -0.21, -0.74],
  ]);
  const dorsal = fin([
    [0, 0.13, 0.16],
    [0, 0.25, -0.06],
    [0, 0.11, -0.26],
  ]);
  const g = mergeGeometries([body, tail, dorsal], false)!;
  const p = g.attributes.position;
  const aBody = new Float32Array(p.count);
  for (let i = 0; i < p.count; i++) aBody[i] = (0.5 - p.getZ(i)) / 1.24;
  g.setAttribute("aBody", new BufferAttribute(aBody, 1));
  return g;
}

const SCHOOLS = [
  { species: 0, n: 56, size: 0.4, speed: [1.1, 2.1], depth: 2.6 },
  { species: 1, n: 30, size: 0.27, speed: [0.8, 1.6], depth: 1.4 },
  { species: 2, n: 42, size: 0.3, speed: [0.7, 1.5], depth: 1.2 },
  { species: 3, n: 24, size: 0.2, speed: [0.9, 1.7], depth: 1.9 },
];

export default function Fish() {
  const ref = useRef<InstancedMesh>(null);
  const count = SCHOOLS.reduce((a, s) => a + s.n, 0);

  const { geometry, material, fish } = useMemo(() => {
    const rand = mulberry32(77);
    const geometry = fishGeometry();
    const fish: { pos: Vector3; vel: Vector3; school: number; scale: number }[] = [];
    const seeds = new Float32Array(count);
    const species = new Float32Array(count);
    SCHOOLS.forEach((s, si) => {
      const cx = (rand() - 0.5) * 20;
      const cz = -8 + (rand() - 0.5) * 16;
      for (let k = 0; k < s.n; k++) {
        const i = fish.length;
        const x = cx + (rand() - 0.5) * 6;
        const z = cz + (rand() - 0.5) * 6;
        fish.push({
          pos: new Vector3(x, floorHeight(x, z) + s.depth + rand() * 1.5, z),
          vel: new Vector3(rand() - 0.5, 0, rand() - 0.5).normalize().multiplyScalar(1),
          school: si,
          scale: s.size * (0.8 + rand() * 0.4),
        });
        seeds[i] = rand();
        species[i] = s.species;
      }
    });
    geometry.setAttribute("aSeed", new InstancedBufferAttribute(seeds, 1));
    geometry.setAttribute("aSpecies", new InstancedBufferAttribute(species, 1));
    const material = new ShaderMaterial({ uniforms: { ...U }, vertexShader: fishVert, fragmentShader: fishFrag, side: DoubleSide });
    return { geometry, material, fish };
  }, [count]);

  const tmp = useMemo(
    () => ({
      m: new Matrix4(),
      q: new Quaternion(),
      s: new Vector3(),
      coh: new Vector3(),
      ali: new Vector3(),
      sep: new Vector3(),
      steer: new Vector3(),
      d: new Vector3(),
      target: new Vector3(),
      fwd: new Vector3(0, 0, 1),
      dir: new Vector3(),
    }),
    [],
  );

  useFrame(({ clock }, delta) => {
    const mesh = ref.current;
    if (!mesh) return;
    const dt = Math.min(delta, 0.05);
    const t = clock.elapsedTime;
    const { m, q, s, coh, ali, sep, steer, d, target, fwd, dir } = tmp;
    const storm = U.uStorm.value;

    for (let i = 0; i < fish.length; i++) {
      const f = fish[i];
      const S = SCHOOLS[f.school];
      coh.set(0, 0, 0);
      ali.set(0, 0, 0);
      sep.set(0, 0, 0);
      let n = 0;
      for (let j = 0; j < fish.length; j++) {
        if (j === i) continue;
        const o = fish[j];
        d.subVectors(o.pos, f.pos);
        const dist2 = d.lengthSq();
        if (dist2 < 0.36) sep.addScaledVector(d, -1 / Math.max(dist2, 0.02));
        if (o.school !== f.school || dist2 > 7) continue;
        coh.add(o.pos);
        ali.add(o.vel);
        n++;
      }
      steer.copy(sep).multiplyScalar(0.9);
      if (n) {
        coh.divideScalar(n).sub(f.pos);
        ali.divideScalar(n).sub(f.vel);
        steer.addScaledVector(coh, 0.5).addScaledVector(ali, 0.8);
      }
      // each school wanders the reef on its own slow loop
      const k = f.school * 1.7;
      target.set(Math.sin(t * 0.05 + k) * 15, 0, -6 + Math.cos(t * 0.037 + k * 2) * 11);
      target.y = floorHeight(target.x, target.z) + S.depth * (1 - storm * 0.5) + 0.8;
      steer.addScaledVector(d.subVectors(target, f.pos), 0.05);

      const floorY = floorHeight(f.pos.x, f.pos.z) + 0.7;
      if (f.pos.y < floorY + 0.6) steer.y += (floorY + 0.6 - f.pos.y) * 4;
      if (f.pos.y > -1.6) steer.y -= (f.pos.y + 1.6) * 4;

      f.vel.addScaledVector(steer, dt);
      f.vel.y *= 0.96;
      const sp = f.vel.length();
      const min = S.speed[0] * (1 + storm * 0.6);
      const max = S.speed[1] * (1 + storm * 0.6);
      if (sp < min) f.vel.multiplyScalar(min / Math.max(sp, 1e-4));
      else if (sp > max) f.vel.multiplyScalar(max / sp);
      f.pos.addScaledVector(f.vel, dt);

      dir.copy(f.vel).normalize();
      q.setFromUnitVectors(fwd, dir);
      s.setScalar(f.scale);
      m.compose(f.pos, q, s);
      mesh.setMatrixAt(i, m);
    }
    mesh.instanceMatrix.needsUpdate = true;
  });

  return <instancedMesh ref={ref} args={[geometry, material, count]} frustumCulled={false} />;
}
