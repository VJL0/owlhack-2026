"use client";

import { useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import {
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  PlaneGeometry,
  Points,
  Quaternion,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from "three";
import { COMMON, OUTPUT } from "./glsl";
import { U } from "./env";
import { floorHeight, mulberry32, spurAmount } from "./terrain";

// ------------------------------------------------------------------ seafloor

const floorVert = /* glsl */ `
attribute float aSpur;
varying vec3 vWorld;
varying vec3 vN;
varying float vSpur;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  vSpur = aSpur;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const floorFrag = /* glsl */ `
${COMMON}
varying vec3 vWorld;
varying vec3 vN;
varying float vSpur;
void main() {
  vec3 n = safeNormalize(vN);
  float g = fbm(vWorld.xz * 0.9);
  vec3 sand = vec3(0.70, 0.66, 0.54) * (0.8 + 0.32 * g);
  float ripple = sin(vWorld.x * 4.4 + vWorld.z * 0.7 + fbm(vWorld.xz * 0.6) * 5.0) * 0.5 + 0.5;
  sand *= 0.88 + 0.14 * ripple;
  float r = fbm(vWorld.xz * 2.2 + 5.0);
  vec3 rock = mix(vec3(0.13, 0.14, 0.11), vec3(0.32, 0.29, 0.21), r);
  float speck = smoothstep(0.7, 0.92, vnoise(vWorld.xz * 5.5));
  rock = mix(rock, vec3(0.52, 0.27, 0.40), speck * 0.4); // crustose coralline algae
  float spur = smoothstep(0.22, 0.7, vSpur + (g - 0.5) * 0.35);
  vec3 col = mix(sand, rock, spur);
  float ndl = max(dot(n, uSunDir), 0.0) * sunVis(vWorld);
  vec3 amb = mix(uWaterDeep * 1.6, uWaterShallow * 1.8, n.y * 0.5 + 0.5);
  vec3 lit = col * (amb + uSunColor * ndl * 0.8);
  lit += col * uSunColor * causticsAt(vWorld, n) * 1.7;
  lit *= 1.0 - uDim * 0.65;
  gl_FragColor = vec4(applyWater(lit, vWorld), 1.0);
  ${OUTPUT}
}`;

export function Seafloor() {
  const geometry = useMemo(() => {
    const g = new PlaneGeometry(170, 170, 260, 260);
    g.rotateX(-Math.PI / 2);
    const pos = g.attributes.position;
    const spur = new Float32Array(pos.count);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      pos.setY(i, floorHeight(x, z));
      spur[i] = spurAmount(x, z);
    }
    g.setAttribute("aSpur", new BufferAttribute(spur, 1));
    g.computeVertexNormals();
    return g;
  }, []);
  const material = useMemo(() => new ShaderMaterial({ uniforms: { ...U }, vertexShader: floorVert, fragmentShader: floorFrag }), []);
  return <mesh geometry={geometry} material={material} />;
}

// ------------------------------------------------------------------ water volume (background)

const volumeFrag = /* glsl */ `
${COMMON}
varying vec3 vWorld;
void main() {
  vec3 d = normalize(vWorld - uCamPos);
  vec3 c = waterColorFor(d);
  float up = max(d.y, 0.0);
  float streak = fbm(vec2(atan(d.z, d.x) * 7.0, uTime * 0.04)) * pow(up, 2.5);
  c += uSunColor * streak * 0.08 * (1.0 - uStorm);
  c *= 1.0 - uDim * 0.5;
  gl_FragColor = vec4(c, 1.0);
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

export function WaterVolume() {
  const ref = useRef<Mesh>(null);
  const material = useMemo(
    () => new ShaderMaterial({ uniforms: { ...U }, vertexShader: worldVert, fragmentShader: volumeFrag, side: BackSide, depthWrite: false }),
    [],
  );
  const geometry = useMemo(() => new SphereGeometry(190, 48, 24), []);
  useFrame(({ camera }) => ref.current?.position.copy(camera.position));
  return <mesh ref={ref} geometry={geometry} material={material} renderOrder={-10} frustumCulled={false} />;
}

// ------------------------------------------------------------------ sea surface from below

const surfaceFrag = /* glsl */ `
${COMMON}
varying vec3 vWorld;
void main() {
  vec3 v = normalize(vWorld - uCamPos);
  float cosT = clamp(v.y, 0.0, 1.0);
  // Snell's window: the sky compressed into a ~97° cone overhead
  float window = smoothstep(0.56, 0.8, cosT);
  vec2 q = vWorld.xz * 0.11;
  float w = fbm(q * 2.0 + vec2(uTime * 0.07, -uTime * 0.05) + fbm(q * 3.0 - uTime * 0.06) * 1.6);
  float sparkle = pow(max(caustics(vWorld.xz * 0.22, uTime * 0.9), 0.0), 1.4);
  vec3 sky = vec3(0.62, 0.93, 1.0) * (0.7 + 0.7 * w) + sparkle * 0.9 * uSunColor;
  vec3 tir = uWaterShallow * (0.5 + 0.6 * w) + sparkle * 0.12;
  vec3 col = mix(tir, sky * (0.8 + uSunColor * 0.5), window);
  col *= 1.0 - uStorm * 0.6;
  col *= 1.0 - uDim * 0.5;
  float dist = length(vWorld - uCamPos);
  col = mix(col, waterColorFor(v), smoothstep(18.0, 95.0, dist));
  gl_FragColor = vec4(col, 1.0);
  ${OUTPUT}
}`;

export function SeaSurface() {
  const material = useMemo(
    () => new ShaderMaterial({ uniforms: { ...U }, vertexShader: worldVert, fragmentShader: surfaceFrag, side: DoubleSide, depthWrite: true }),
    [],
  );
  const geometry = useMemo(() => {
    const g = new PlaneGeometry(420, 420, 1, 1);
    g.rotateX(Math.PI / 2);
    return g;
  }, []);
  return <mesh geometry={geometry} material={material} position={[0, 0, 0]} renderOrder={-5} />;
}

// ------------------------------------------------------------------ light shafts

const shaftVert = /* glsl */ `
attribute float aSeed;
varying vec2 vUv;
varying float vSeed;
void main() {
  vUv = uv;
  vSeed = aSeed;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
}`;

const shaftFrag = /* glsl */ `
${COMMON}
varying vec2 vUv;
varying float vSeed;
void main() {
  float across = 1.0 - abs(vUv.x * 2.0 - 1.0);
  float flicker = 0.45 + 0.55 * vnoise(vec2(vUv.x * 3.0 + uTime * 0.18 + vSeed * 13.0, uTime * 0.11 + vSeed));
  float a = pow(clamp(vUv.y, 0.0, 1.0), 1.5) * pow(clamp(across, 0.0, 1.0), 2.0) * flicker * 0.15;
  a *= (1.0 - uStorm * 0.9) * (1.0 - uDim * 0.75);
  gl_FragColor = vec4(uSunColor * a, a);
}`;

export function LightShafts({ count = 18 }: { count?: number }) {
  const ref = useRef<InstancedMesh>(null);
  const { base, geometry, material } = useMemo(() => {
    const rand = mulberry32(9);
    const base = Array.from({ length: count }, () => ({
      x: (rand() - 0.5) * 56,
      z: (rand() - 0.5) * 50 - 6,
      w: 1.4 + rand() * 3.2,
      lean: (rand() - 0.5) * 0.12,
    }));
    const geometry = new PlaneGeometry(1, 30, 1, 1);
    geometry.translate(0, -15, 0);
    geometry.setAttribute("aSeed", new InstancedBufferAttribute(new Float32Array(base.map(() => rand())), 1));
    const material = new ShaderMaterial({
      uniforms: { ...U },
      vertexShader: shaftVert,
      fragmentShader: shaftFrag,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
    });
    return { base, geometry, material };
  }, [count]);

  const m = useMemo(() => new Matrix4(), []);
  const q = useMemo(() => new Quaternion(), []);
  const lean = useMemo(() => new Quaternion(), []);
  const s = useMemo(() => new Vector3(), []);
  const p = useMemo(() => new Vector3(), []);
  const axisY = useMemo(() => new Vector3(0, 1, 0), []);
  const axisZ = useMemo(() => new Vector3(0, 0, 1), []);

  useFrame(({ camera }) => {
    const mesh = ref.current;
    if (!mesh) return;
    base.forEach((b, i) => {
      q.setFromAxisAngle(axisY, Math.atan2(camera.position.x - b.x, camera.position.z - b.z));
      lean.setFromAxisAngle(axisZ, b.lean);
      q.multiply(lean);
      p.set(b.x, 0, b.z);
      s.set(b.w, 1, 1);
      m.compose(p, q, s);
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
  });

  return <instancedMesh ref={ref} args={[geometry, material, count]} frustumCulled={false} renderOrder={5} />;
}

// ------------------------------------------------------------------ marine snow

const snowVert = /* glsl */ `
${COMMON}
attribute float aSize;
attribute float aSeed;
uniform vec3 uBox;
uniform float uPixelRatio;
varying float vAlpha;
void main() {
  vec3 drift = vec3(0.05 + uStorm * 2.6, -0.035, 0.03 + uStorm * 0.9) * uTime;
  vec3 p = position + drift + vec3(sin(uTime * 0.3 + aSeed * 10.0), cos(uTime * 0.25 + aSeed * 7.0), 0.0) * 0.18;
  p = mod(p - uCamPos + uBox * 0.5, uBox) - uBox * 0.5 + uCamPos;
  p.y = min(p.y, uSurfaceY - 0.2);
  vec4 mv = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float d = -mv.z;
  gl_PointSize = aSize * uPixelRatio * (24.0 / max(d, 0.1));
  vAlpha = smoothstep(0.3, 2.0, d) * (1.0 - smoothstep(12.0, 24.0, d));
}`;

const snowFrag = /* glsl */ `
${COMMON}
varying float vAlpha;
void main() {
  float r = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.05, r) * vAlpha * (0.32 + uStorm * 0.45) * (1.0 - uDim * 0.5);
  vec3 c = mix(vec3(0.72, 0.88, 0.86), uSunColor, 0.35);
  gl_FragColor = vec4(c, a);
}`;

export function MarineSnow({ count = 2600 }: { count?: number }) {
  const { gl } = useThree();
  const points = useMemo(() => {
    const rand = mulberry32(21);
    const box = new Vector3(42, 20, 42);
    const pos = new Float32Array(count * 3);
    const size = new Float32Array(count);
    const seed = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = rand() * box.x;
      pos[i * 3 + 1] = rand() * box.y;
      pos[i * 3 + 2] = rand() * box.z;
      size[i] = 0.6 + Math.pow(rand(), 3) * 3.2;
      seed[i] = rand();
    }
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(pos, 3));
    g.setAttribute("aSize", new BufferAttribute(size, 1));
    g.setAttribute("aSeed", new BufferAttribute(seed, 1));
    const mat = new ShaderMaterial({
      uniforms: { ...U, uBox: { value: box }, uPixelRatio: { value: gl.getPixelRatio() } },
      vertexShader: snowVert,
      fragmentShader: snowFrag,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    const p = new Points(g, mat);
    p.frustumCulled = false;
    return p;
  }, [count, gl]);
  return <primitive object={points} renderOrder={6} />;
}
