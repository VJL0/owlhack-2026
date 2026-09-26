"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import {
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  EdgesGeometry,
  Group,
  IcosahedronGeometry,
  LineBasicMaterial,
  Points,
  QuadraticBezierCurve3,
  Quaternion,
  ShaderMaterial,
  SphereGeometry,
  TubeGeometry,
  Vector3,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { useStore } from "@/lib/store";
import { snapshot, type FeatureSnapshot } from "@/lib/data";
import { predict, PAIRS, PRESSURES, type ModelOutput, type Pair, type Pressure } from "@/lib/model";
import { PRESSURE_DEFS } from "@/lib/pressures";
import { heatRgb } from "@/lib/colors";
import { setAnchor } from "./labels";

export const CONSTELLATION_CENTER = new Vector3(0, -3.3, -4);

// Interacting pairs (heat–fishing, heat–storm, fishing–lionfish) sit on adjacent
// corners, so every interaction arc runs along the outside of the diamond.
const NODE_POS: Record<Pressure, Vector3> = {
  heat: new Vector3(0, 2.05, 0),
  fishing: new Vector3(-3.4, 0.1, 0.5),
  storm: new Vector3(3.4, 0.1, 0.5),
  lionfish: new Vector3(0, -1.95, 0.9),
};

/** Labels sit on the outer side of each node so they never cross the reef core. */
const LABEL_SIDE: Record<Pressure, 1 | -1> = { heat: 1, fishing: -1, lionfish: 1, storm: 1 };



// ------------------------------------------------------------------ shaders

const plasmaVert = /* glsl */ `
varying vec3 vN;
varying vec3 vPos;
varying vec3 vView;
void main() {
  vN = normalize(normalMatrix * normal);
  vPos = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vView = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;

const plasmaFrag = /* glsl */ `
uniform float uTime;
uniform vec3 uColor;
uniform vec3 uHot;
uniform float uGlow;
varying vec3 vN;
varying vec3 vPos;
varying vec3 vView;
float h(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
float n3(vec3 p) {
  vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h(i), h(i + vec3(1,0,0)), f.x), mix(h(i + vec3(0,1,0)), h(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(h(i + vec3(0,0,1)), h(i + vec3(1,0,1)), f.x), mix(h(i + vec3(0,1,1)), h(i + vec3(1,1,1)), f.x), f.y), f.z);
}
void main() {
  vec3 p = vPos * 2.2 + vec3(0.0, uTime * 0.35, uTime * 0.2);
  float n = n3(p) * 0.6 + n3(p * 2.1) * 0.3 + n3(p * 4.3) * 0.1;
  vec3 col = mix(uColor * 0.6, uHot, smoothstep(0.35, 0.85, n));
  float fr = pow(clamp(1.0 - dot(normalize(vN), vView), 0.0, 1.0), 2.0);
  col += uHot * fr * 1.2;
  gl_FragColor = vec4(min(col * (1.1 + uGlow * 1.2), vec3(3.0)), 1.0);
}`;

const haloFrag = /* glsl */ `
uniform vec3 uColor;
uniform float uGlow;
varying vec3 vN;
varying vec3 vView;
void main() {
  float fr = pow(clamp(1.0 - abs(dot(normalize(vN), vView)), 0.0, 1.0), 3.0);
  float a = fr * (0.35 + uGlow * 0.9);
  gl_FragColor = vec4(uColor * a, a);
}`;

const arcVert = /* glsl */ `
uniform float uWidth;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec3 p = position + normal * (uWidth - 0.02);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;

const arcFrag = /* glsl */ `
uniform float uTime;
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform float uOpacity;
uniform float uSpeed;
varying vec2 vUv;
void main() {
  float t = vUv.x;
  float pulse = smoothstep(0.75, 1.0, fract(t * 5.0 - uTime * uSpeed));
  vec3 c = mix(uColorA, uColorB, t);
  float a = uOpacity * (0.35 + 0.65 * pulse);
  gl_FragColor = vec4(c * a * 1.6, a);
}`;

// ------------------------------------------------------------------ geometry helpers

/** Lionfish node: a core bristling with spines, read as "venomous" without colour. */
function spikyGeometry() {
  const parts: BufferGeometry[] = [new IcosahedronGeometry(0.62, 1).toNonIndexed()];
  const up = new Vector3(0, 1, 0);
  const q = new Quaternion();
  const dir = new Vector3();
  const pos = new IcosahedronGeometry(1, 0).attributes.position;
  const seen = new Set<string>();
  for (let i = 0; i < pos.count; i++) {
    dir.fromBufferAttribute(pos, i).normalize();
    const key = dir.toArray().map((x) => x.toFixed(3)).join(",");
    if (seen.has(key)) continue;
    seen.add(key);
    const spine = new ConeGeometry(0.09, 0.8, 5, 1);
    spine.translate(0, 0.95, 0);
    spine.applyQuaternion(q.setFromUnitVectors(up, dir));
    parts.push(spine.toNonIndexed());
  }
  return mergeGeometries(parts, false)!;
}

function spiralPoints(n = 300) {
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const arm = i % 3;
    const f = i / n;
    const a = arm * ((Math.PI * 2) / 3) + f * Math.PI * 5;
    const r = 0.12 + f * 1.05;
    pos[i * 3] = Math.cos(a) * r + (Math.random() - 0.5) * 0.06;
    pos[i * 3 + 1] = (Math.random() - 0.5) * 0.12 * (1 - f);
    pos[i * 3 + 2] = Math.sin(a) * r + (Math.random() - 0.5) * 0.06;
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(pos, 3));
  return g;
}

// ------------------------------------------------------------------ component

interface Props {
  open: boolean;
}

export default function Constellation({ open }: Props) {
  const siteId = useStore((s) => s.siteId);
  // per day, so a storm's closest-approach day is inside its own window
  const week = useStore((s) => Math.floor(s.t));
  const selection = useStore((s) => s.selection);
  const hover = useStore((s) => s.hover);
  const select = useStore((s) => s.select);
  const setHover = useStore((s) => s.setHover);

  const snap: FeatureSnapshot = useMemo(() => snapshot(siteId, week), [siteId, week]);
  const model: ModelOutput = useMemo(() => predict(snap), [snap]);

  const root = useRef<Group>(null);
  const appear = useRef(0);

  // materials
  const heatMat = useMemo(
    () =>
      new ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uColor: { value: new Color("#ff8a4c") }, uHot: { value: new Color("#ffd9a0") }, uGlow: { value: 0 } },
        vertexShader: plasmaVert,
        fragmentShader: plasmaFrag,
      }),
    [],
  );
  const halos = useMemo(
    () =>
      Object.fromEntries(
        PRESSURES.map((p) => [
          p,
          new ShaderMaterial({
            uniforms: { uColor: { value: new Color(PRESSURE_DEFS[p].color) }, uGlow: { value: 0 } },
            vertexShader: plasmaVert,
            fragmentShader: haloFrag,
            transparent: true,
            depthWrite: false,
            blending: AdditiveBlending,
            side: BackSide,
          }),
        ]),
      ) as Record<Pressure, ShaderMaterial>,
    [],
  );
  const geos = useMemo(
    () => ({
      sphere: new SphereGeometry(1, 48, 32),
      halo: new SphereGeometry(1.45, 32, 20),
      net: new EdgesGeometry(new IcosahedronGeometry(1, 1)),
      spiky: spikyGeometry(),
      spiral: spiralPoints(),
      core: new EdgesGeometry(new IcosahedronGeometry(0.5, 1)),
      hit: new SphereGeometry(1, 12, 8),
    }),
    [],
  );
  const lineMats = useMemo(
    () => ({
      fishing: new LineBasicMaterial({ color: new Color("#8fd3ff").multiplyScalar(1.6), transparent: true, opacity: 0.9 }),
      core: new LineBasicMaterial({ color: new Color("#6ff3e3").multiplyScalar(1.8), transparent: true, opacity: 0.9 }),
    }),
    [],
  );
  const solidMats = useMemo(
    () => ({
      lionfish: new ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uColor: { value: new Color("#ff5f8f") }, uHot: { value: new Color("#ffd1e0") }, uGlow: { value: 0 } },
        vertexShader: plasmaVert,
        fragmentShader: plasmaFrag,
      }),
      coreFill: new ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uColor: { value: new Color("#1f8f86") }, uHot: { value: new Color("#bafff6") }, uGlow: { value: 0.4 } },
        vertexShader: plasmaVert,
        fragmentShader: plasmaFrag,
      }),
      fishingCore: new ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uColor: { value: new Color("#2a6f99") }, uHot: { value: new Color("#cdeeff") }, uGlow: { value: 0 } },
        vertexShader: plasmaVert,
        fragmentShader: plasmaFrag,
      }),
    }),
    [],
  );
  const spiralMat = useMemo(
    () =>
      new ShaderMaterial({
        uniforms: { uColor: { value: new Color("#cfc4ff") }, uSize: { value: 6 } },
        vertexShader: /* glsl */ `uniform float uSize; void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix*mv; gl_PointSize = uSize * (8.0 / -mv.z); }`,
        fragmentShader: /* glsl */ `uniform vec3 uColor; void main(){ float r = length(gl_PointCoord - 0.5); float a = clamp(1.0 - r * 2.0, 0.0, 1.0); a *= a; gl_FragColor = vec4(min(uColor * a * 0.45, vec3(2.0)), a); }`,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
      }),
    [],
  );

  // arcs: pressure → reef (contribution) and pressure ↔ pressure (interaction)
  const arcs = useMemo(() => {
    const mk = (a: Vector3, b: Vector3, bulge: Vector3) => {
      const mid = a.clone().add(b).multiplyScalar(0.5).add(bulge);
      const curve = new QuadraticBezierCurve3(a.clone(), mid, b.clone());
      // label sits just outside the arc's midpoint
      const labelAt = curve.getPoint(0.5).add(bulge.clone().setZ(0).normalize().multiplyScalar(0.55));
      return { curve, geo: new TubeGeometry(curve, 90, 0.02, 8, false), hit: new TubeGeometry(curve, 40, 0.22, 6, false), mid: labelAt };
    };
    const toCore = Object.fromEntries(
      PRESSURES.map((p) => {
        const a = NODE_POS[p];
        return [p, mk(a, new Vector3(), new Vector3(0, 0, 0.6).add(a.clone().multiplyScalar(0.12)))];
      }),
    ) as Record<Pressure, ReturnType<typeof mk>>;
    const pairs = Object.fromEntries(
      PAIRS.map((pair) => {
        const [a, b] = pair.split(":") as [Pressure, Pressure];
        const out = NODE_POS[a].clone().add(NODE_POS[b]).setZ(0).normalize().multiplyScalar(1.35).add(new Vector3(0, 0, 0.35));
        return [pair, mk(NODE_POS[a], NODE_POS[b], out)];
      }),
    ) as Record<Pair, ReturnType<typeof mk>>;
    return { toCore, pairs };
  }, []);

  const arcMats = useMemo(() => {
    const mat = (a: string, b: string) =>
      new ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uColorA: { value: new Color(a) },
          uColorB: { value: new Color(b) },
          uOpacity: { value: 0.5 },
          uSpeed: { value: 0.5 },
          uWidth: { value: 0.02 },
        },
        vertexShader: arcVert,
        fragmentShader: arcFrag,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
      });
    return {
      toCore: Object.fromEntries(PRESSURES.map((p) => [p, mat(PRESSURE_DEFS[p].color, "#6ff3e3")])) as Record<Pressure, ShaderMaterial>,
      pairs: Object.fromEntries(
        PAIRS.map((pair) => {
          const [a, b] = pair.split(":") as [Pressure, Pressure];
          return [pair, mat(PRESSURE_DEFS[a].color, PRESSURE_DEFS[b].color)];
        }),
      ) as Record<Pair, ShaderMaterial>,
    };
  }, []);

  useEffect(() => {
    // keep heat colour honest to the DHW ramp
    const [r, g, b] = heatRgb(snap.maxDhw84d);
    (heatMat.uniforms.uColor.value as Color).setRGB(r / 255, g / 255, b / 255).convertSRGBToLinear();
  }, [snap.maxDhw84d, heatMat]);

  const nodeRefs = useRef<Partial<Record<Pressure, Group | null>>>({});
  const spiralRef = useRef<Points>(null);

  const spiralSize = useRef(0.3);
  const anchorTmp = useMemo(() => new Vector3(), []);
  const maxShap = Math.max(0.2, ...PRESSURES.map((p) => Math.abs(model.shap[p])));
  const maxInt = Math.max(0.05, ...PAIRS.map((p) => Math.abs(model.interaction[p])));

  useFrame(({ clock, camera }, dt) => {
    const t = clock.elapsedTime;
    appear.current += ((open ? 1 : 0) - appear.current) * Math.min(1, dt * 2.2);
    const k = appear.current;
    const g = root.current;
    if (!g) return;
    g.visible = k > 0.01;
    g.scale.setScalar(0.6 + 0.4 * k);
    // a diagram, so it turns to face the viewer (about the vertical axis only)
    const face = Math.atan2(camera.position.x - CONSTELLATION_CENTER.x, camera.position.z - CONSTELLATION_CENTER.z);
    g.rotation.y = face + Math.sin(t * 0.08) * 0.08;
    g.position.copy(CONSTELLATION_CENTER).add(new Vector3(0, (1 - k) * -2.5, 0));

    heatMat.uniforms.uTime.value = t;
    solidMats.lionfish.uniforms.uTime.value = t;
    solidMats.coreFill.uniforms.uTime.value = t;
    solidMats.fishingCore.uniforms.uTime.value = t;

    const sel = selection;
    const hov = hover;
    const focusP = (p: Pressure) =>
      (sel?.kind === "pressure" && sel.id === p) || (hov?.kind === "pressure" && hov.id === p) || (sel?.kind === "pair" && sel.id.includes(p));
    const anySel = !!sel;

    PRESSURES.forEach((p, i) => {
      const node = nodeRefs.current[p];
      const imp = Math.abs(model.shap[p]) / maxShap;
      const size = 0.25 + Math.min(1.2, model.magnitude[p]) * 0.45;
      if (p === "storm") spiralSize.current = size;
      if (node) {
        const pulse = 1 + Math.sin(t * (1.2 + imp * 3.2) + i) * (0.03 + imp * 0.07);
        node.scale.setScalar(size * pulse * k);
        node.position.copy(NODE_POS[p]).add(new Vector3(0, Math.sin(t * 0.6 + i * 1.7) * 0.08, 0));
      }
      const glow = imp * (focusP(p) ? 1.6 : anySel ? 0.4 : 1);
      halos[p].uniforms.uGlow.value = glow;
      if (p === "heat") heatMat.uniforms.uGlow.value = glow * 0.6;
      if (p === "lionfish") solidMats.lionfish.uniforms.uGlow.value = glow * 0.4;
      if (p === "fishing") solidMats.fishingCore.uniforms.uGlow.value = glow * 0.4;

      const am = arcMats.toCore[p];
      am.uniforms.uTime.value = t;
      am.uniforms.uWidth.value = 0.012 + imp * 0.05;
      am.uniforms.uOpacity.value = k * (0.25 + imp * 0.6) * (anySel && !focusP(p) ? 0.35 : 1);
      am.uniforms.uSpeed.value = 0.25 + imp * 0.8;
    });

    PAIRS.forEach((pair) => {
      const v = Math.abs(model.interaction[pair]) / maxInt;
      const am = arcMats.pairs[pair];
      const focused = (sel?.kind === "pair" && sel.id === pair) || (hov?.kind === "pair" && hov.id === pair);
      am.uniforms.uTime.value = t;
      am.uniforms.uWidth.value = 0.008 + v * 0.045 + (focused ? 0.02 : 0);
      am.uniforms.uOpacity.value = k * (0.15 + v * 0.7) * (anySel && !focused ? 0.3 : focused ? 1.6 : 1);
      am.uniforms.uSpeed.value = 0.2 + v * 0.6;
    });

    if (spiralRef.current) spiralRef.current.rotation.y = -t * 0.9;

    // label anchors for the DOM layer
    g.updateMatrixWorld();
    const showLabels = open && k > 0.6;
    PRESSURES.forEach((p) => {
      const node = nodeRefs.current[p];
      const r = node ? node.scale.x / Math.max(k, 0.01) : 0.5;
      anchorTmp.copy(NODE_POS[p]).add(new Vector3(LABEL_SIDE[p] * (r * 1.05 + 0.12), 0, 0)).applyMatrix4(g.matrixWorld);
      setAnchor(`node:${p}`, anchorTmp, showLabels);
    });
    setAnchor("core", anchorTmp.set(0, -0.62, 0).applyMatrix4(g.matrixWorld), showLabels);
    PAIRS.forEach((pair) => setAnchor(`pair:${pair}`, anchorTmp.copy(arcs.pairs[pair].mid).applyMatrix4(g.matrixWorld), showLabels));
    spiralMat.uniforms.uSize.value = 2.5 + spiralSize.current * 5;
  });

  const nodeEvents = (p: Pressure) => ({
    onPointerOver: (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation();
      setHover({ kind: "pressure", id: p });
      document.body.style.cursor = "pointer";
    },
    onPointerOut: () => {
      setHover(null);
      document.body.style.cursor = "";
    },
    onClick: (e: ThreeEvent<MouseEvent>) => {
      e.stopPropagation();
      select({ kind: "pressure", id: p });
    },
  });

  const pairEvents = (pair: Pair) => ({
    onPointerOver: (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation();
      setHover({ kind: "pair", id: pair });
      document.body.style.cursor = "pointer";
    },
    onPointerOut: () => {
      setHover(null);
      document.body.style.cursor = "";
    },
    onClick: (e: ThreeEvent<MouseEvent>) => {
      e.stopPropagation();
      select({ kind: "pair", id: pair });
    },
  });

  return (
    <group ref={root} visible={false}>
      {/* the reef itself, as the model sees it */}
      <group>
        <lineSegments geometry={geos.core} material={lineMats.core} />
        <mesh geometry={geos.sphere} material={solidMats.coreFill} scale={0.26} />
      </group>

      {PRESSURES.map((p) => (
        <mesh key={`a-${p}`} geometry={arcs.toCore[p].geo} material={arcMats.toCore[p]} renderOrder={8} />
      ))}
      {PAIRS.map((pair) => (
        <group key={pair}>
          <mesh geometry={arcs.pairs[pair].geo} material={arcMats.pairs[pair]} renderOrder={8} />
          <mesh geometry={arcs.pairs[pair].hit} visible={false} {...pairEvents(pair)} />
        </group>
      ))}

      {PRESSURES.map((p) => (
        <group key={p} ref={(el) => (nodeRefs.current[p] = el)} position={NODE_POS[p]}>
          <mesh geometry={geos.hit} visible={false} scale={1.5} {...nodeEvents(p)} />
          <mesh geometry={geos.halo} material={halos[p]} />
          {p === "heat" && <mesh geometry={geos.sphere} material={heatMat} />}
          {p === "fishing" && (
            <>
              <lineSegments geometry={geos.net} material={lineMats.fishing} />
              <mesh geometry={geos.sphere} material={solidMats.fishingCore} scale={0.42} />
            </>
          )}
          {p === "lionfish" && <mesh geometry={geos.spiky} material={solidMats.lionfish} scale={0.8} />}
          {p === "storm" && (
            <>
              <points ref={spiralRef} geometry={geos.spiral} material={spiralMat} />
              <mesh geometry={geos.sphere} material={solidMats.coreFill} scale={0.14} />
            </>
          )}
        </group>
      ))}
    </group>
  );
}
