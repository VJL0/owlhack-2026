"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  ConeGeometry,
  DoubleSide,
  Group,
  LatheGeometry,
  Mesh,
  RingGeometry,
  ShaderMaterial,
  Vector2,
  Vector3,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { COMMON, OUTPUT } from "./glsl";
import { U } from "./env";
import { floorHeight } from "./terrain";
import { useStore } from "@/lib/store";
import { lionfishNear } from "@/lib/data";
import { setAnchor } from "./labels";

const vert = /* glsl */ `
${COMMON}
attribute float aPart;
varying vec3 vWorld;
varying vec3 vN;
varying vec3 vObj;
varying float vPart;
void main() {
  vec3 p = position;
  if (aPart > 0.5 && aPart < 1.5) {
    // pectoral rays undulate
    p.y += sin(uTime * 2.2 + p.z * 5.0) * 0.03 * abs(p.x) * 4.0;
  }
  vec4 w = modelMatrix * vec4(p, 1.0);
  vWorld = w.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  vObj = position;
  vPart = aPart;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const frag = /* glsl */ `
${COMMON}
varying vec3 vWorld;
varying vec3 vN;
varying vec3 vObj;
varying float vPart;
void main() {
  vec3 n = safeNormalize(vN);
  if (!gl_FrontFacing) n = -n;
  float band = step(0.5, fract(vObj.z * 9.0 + sin(vObj.y * 12.0) * 0.18 + abs(vObj.x) * 3.0));
  vec3 maroon = vec3(0.42, 0.06, 0.09);
  vec3 cream = vec3(0.95, 0.84, 0.74);
  vec3 col = mix(maroon, cream, band);
  if (vPart > 1.5) col = mix(col, cream, 0.4);
  float ndl = max(dot(n, uSunDir), 0.0);
  vec3 amb = mix(uWaterDeep * 2.0, uWaterShallow * 2.2, n.y * 0.5 + 0.5);
  vec3 lit = col * (amb + uSunColor * ndl);
  vec3 V = normalize(uCamPos - vWorld);
  lit += pow(clamp(1.0 - dot(n, V), 0.0, 1.0), 3.0) * vec3(1.0, 0.37, 0.56) * 0.35;
  lit *= 1.0 - uDim * 0.3;
  gl_FragColor = vec4(applyWater(lit, vWorld), 1.0);
  ${OUTPUT}
}`;

const ringFrag = /* glsl */ `
${COMMON}
varying vec3 vLocal;
void main() {
  float ang = atan(vLocal.z, vLocal.x) / 6.2831853;
  float dash = step(0.45, fract(ang * 56.0 - uTime * 0.06));
  float a = dash * 0.55 * (1.0 - uDim * 0.2);
  gl_FragColor = vec4(vec3(1.0, 0.37, 0.56) * a, a);
}`;

const ringVert = /* glsl */ `
varying vec3 vLocal;
void main() {
  vLocal = position;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
}`;

function tag(g: BufferGeometry, part: number) {
  g.setAttribute("aPart", new BufferAttribute(new Float32Array(g.attributes.position.count).fill(part), 1));
  return g.index ? g.toNonIndexed() : g;
}

function lionfishGeometry() {
  const body = new LatheGeometry(
    [
      [0.001, -0.5],
      [0.06, -0.4],
      [0.13, -0.15],
      [0.16, 0.08],
      [0.14, 0.28],
      [0.08, 0.44],
      [0.001, 0.5],
    ].map(([r, y]) => new Vector2(r, y)),
    16,
  );
  body.rotateX(Math.PI / 2);
  body.scale(0.6, 1.05, 1);
  const parts: BufferGeometry[] = [tag(body, 0)];
  // feathery pectoral fins: long rays fanning out on both sides
  for (const side of [-1, 1]) {
    for (let k = 0; k < 11; k++) {
      const len = 0.42 + Math.sin((k / 10) * Math.PI) * 0.28;
      const ray = new ConeGeometry(0.018, len, 4, 1, true);
      ray.translate(0, len / 2, 0);
      ray.rotateZ(-side * (Math.PI / 2 - 0.25));
      ray.rotateY(side * (-0.9 + (k / 10) * 1.6));
      ray.rotateX(0.25);
      ray.translate(side * 0.06, -0.02, 0.1);
      parts.push(tag(ray, 1));
    }
  }
  // venomous dorsal spines
  for (let k = 0; k < 13; k++) {
    const len = 0.32 + Math.sin((k / 12) * Math.PI) * 0.22;
    const spine = new ConeGeometry(0.012, len, 4, 1, true);
    spine.translate(0, len / 2, 0);
    spine.rotateX(-0.35);
    spine.translate(0, 0.12, 0.3 - k * 0.05);
    parts.push(tag(spine, 2));
  }
  return mergeGeometries(parts, false)!;
}

const SPOTS = [
  { x: -4.6, z: -2.4, ry: 0.6 },
  { x: 6.8, z: -8.5, ry: -1.9 },
  { x: -11.5, z: 2.6, ry: 2.4 },
];

export default function Lionfish() {
  const count = useStore((s) => lionfishNear(s.siteId, s.t).length);
  const shown = count === 0 ? 0 : Math.min(3, 1 + Math.floor(count / 4));
  const geometry = useMemo(() => lionfishGeometry(), []);
  const material = useMemo(() => new ShaderMaterial({ uniforms: { ...U }, vertexShader: vert, fragmentShader: frag, side: DoubleSide }), []);
  const ringGeo = useMemo(() => {
    const g = new RingGeometry(2.1, 2.16, 128, 1);
    g.rotateX(-Math.PI / 2);
    return g;
  }, []);
  const ringMat = useMemo(
    () =>
      new ShaderMaterial({
        uniforms: { ...U },
        vertexShader: ringVert,
        fragmentShader: ringFrag,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        side: DoubleSide,
      }),
    [],
  );
  const groups = useRef<(Group | null)[]>([]);
  const zoneTmp = useMemo(() => new Vector3(), []);
  const fish = useRef<(Mesh | null)[]>([]);

  useFrame(({ clock }, dt) => {
    const t = clock.elapsedTime;
    SPOTS.forEach((s, i) => {
      const g = groups.current[i];
      const f = fish.current[i];
      if (!g || !f) return;
      const target = i < shown ? 1 : 0;
      const k = g.scale.x + (target - g.scale.x) * Math.min(1, dt * 2.5);
      g.scale.setScalar(Math.max(0.0001, k));
      g.visible = k > 0.01;
      f.position.y = 1.15 + Math.sin(t * 0.7 + i) * 0.08;
      f.rotation.y = s.ry + Math.sin(t * 0.15 + i * 2) * 0.5;
      if (i === 0) {
        g.updateMatrixWorld();
        setAnchor("lionfish-zone", zoneTmp.set(0, 2.2, 0).applyMatrix4(g.matrixWorld), g.visible && k > 0.5);
      }
    });
  });

  return (
    <group>
      {SPOTS.map((s, i) => {
        const y = floorHeight(s.x, s.z);
        return (
          <group key={i} ref={(el) => (groups.current[i] = el)} position={[s.x, y, s.z]} scale={0.0001}>
            <mesh geometry={ringGeo} material={ringMat} position={[0, 0.08, 0]} renderOrder={4} />
            <mesh ref={(el) => (fish.current[i] = el)} geometry={geometry} material={material} scale={0.38} />
          </group>
        );
      })}
    </group>
  );
}
