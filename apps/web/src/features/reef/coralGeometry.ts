import {
  BufferAttribute,
  BufferGeometry,
  CylinderGeometry,
  LatheGeometry,
  PlaneGeometry,
  Quaternion,
  SphereGeometry,
  Vector2,
  Vector3,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { fbm2 } from "./terrain";

const UP = new Vector3(0, 1, 0);

function withTip(g: BufferGeometry, fn: (x: number, y: number, z: number) => number) {
  const p = g.attributes.position;
  const tip = new Float32Array(p.count);
  for (let i = 0; i < p.count; i++) tip[i] = fn(p.getX(i), p.getY(i), p.getZ(i));
  g.setAttribute("aTip", new BufferAttribute(tip, 1));
  return g;
}

interface BranchOptions {
  depth: number;
  len: [number, number];
  radius: number;
  taper: number;
  spread: [number, number];
  children: [number, number];
  upBias: number;
  segs: number;
  /** Cross-section scale (x, z) before orientation: flattens elkhorn blades. */
  cross?: [number, number];
  capTips?: boolean;
}

/** Recursive branching colony (Acropora, gorgonian rods). */
export function branching(rand: () => number, o: BranchOptions) {
  const parts: BufferGeometry[] = [];
  const q = new Quaternion();
  const grow = (start: Vector3, dir: Vector3, r: number, d: number) => {
    const len = (o.len[0] + (o.len[1] - o.len[0]) * rand()) * (1 - d * 0.06);
    const rEnd = Math.max(0.006, r * o.taper);
    const g = new CylinderGeometry(rEnd, r, len, o.segs, 2, true);
    const d0 = d / o.depth;
    const d1 = (d + 1) / o.depth;
    withTip(g, (_x, y) => d0 + ((y + len / 2) / len) * (d1 - d0));
    if (o.cross) g.scale(o.cross[0], 1, o.cross[1]);
    g.translate(0, len / 2, 0);
    q.setFromUnitVectors(UP, dir);
    g.applyQuaternion(q);
    g.translate(start.x, start.y, start.z);
    parts.push(g);
    const end = start.clone().addScaledVector(dir, len);
    if (d >= o.depth - 1) {
      if (o.capTips) {
        const cap = new SphereGeometry(rEnd * 1.15, o.segs, 4);
        withTip(cap, () => 1);
        if (o.cross) cap.scale(o.cross[0], 1, o.cross[1]);
        cap.applyQuaternion(q);
        cap.translate(end.x, end.y, end.z);
        parts.push(cap);
      }
      return;
    }
    const n = o.children[0] + Math.floor(rand() * (o.children[1] - o.children[0] + 1));
    for (let k = 0; k < n; k++) {
      const angle = o.spread[0] + (o.spread[1] - o.spread[0]) * rand();
      const axis = new Vector3(rand() - 0.5, 0, rand() - 0.5).cross(dir).normalize();
      if (axis.lengthSq() < 1e-4) axis.set(1, 0, 0);
      const nd = dir.clone().applyAxisAngle(axis, angle).lerp(UP, o.upBias).normalize();
      grow(end, nd, rEnd, d + 1);
    }
  };
  const first = new Vector3((rand() - 0.5) * 0.3, 1, (rand() - 0.5) * 0.3).normalize();
  grow(new Vector3(), first, o.radius, 0);
  const merged = mergeGeometries(parts, false)!;
  parts.forEach((p) => p.dispose());
  return merged;
}

/** Boulder star coral (Orbicella): lumpy lobed mound. */
export function mound(seed: number) {
  const g = new SphereGeometry(1, 96, 56);
  const p = g.attributes.position;
  const v = new Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = fbm2(v.x * 1.2 + seed * 3.1 + v.z * 0.6, v.y * 1.3 + v.z * 1.1 - seed, 2);
    const lobes = Math.sin(v.x * 3.2 + seed) * Math.sin(v.z * 2.8 - seed * 2) * 0.08;
    v.multiplyScalar(1 + (n - 0.5) * 0.42 + lobes);
    v.y = Math.max(v.y, -0.12) * 0.62;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  // collapsed poles leave zero-length normals, which become NaN on the GPU
  const nrm = g.attributes.normal;
  for (let i = 0; i < nrm.count; i++) {
    if (nrm.getX(i) ** 2 + nrm.getY(i) ** 2 + nrm.getZ(i) ** 2 < 1e-10) nrm.setXYZ(i, 0, p.getY(i) > 0 ? 1 : -1, 0);
  }
  return withTip(g, (_x, y) => Math.max(0, y / 0.62));
}

/** Brain coral: a low hemisphere; meanders are drawn in the shader. */
export function brain() {
  const g = new SphereGeometry(1, 72, 30, 0, Math.PI * 2, 0, Math.PI / 2);
  g.scale(1, 0.7, 1);
  g.translate(0, -0.06, 0);
  return withTip(g, (_x, y) => Math.max(0, y / 0.7));
}

/** Giant barrel sponge (Xestospongia muta). */
export function barrel() {
  const pts = [
    [0.3, 0],
    [0.46, 0.14],
    [0.6, 0.5],
    [0.67, 0.92],
    [0.65, 1.26],
    [0.6, 1.46],
    [0.53, 1.52],
    [0.47, 1.46],
    [0.45, 1.1],
    [0.38, 0.6],
    [0.18, 0.46],
    [0.001, 0.45],
  ].map(([x, y]) => new Vector2(x, y));
  const g = new LatheGeometry(pts, 48);
  return withTip(g, (_x, y) => y / 1.52);
}

/** Common sea fan (Gorgonia ventalina): a cupped fan; the lattice is cut in the shader. */
export function fan() {
  const g = new PlaneGeometry(1.7, 1.35, 28, 24);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i) + 0.675;
    const k = 0.18 + 0.82 * Math.min(1, y / 1.1);
    p.setXYZ(i, x * k, y, 0.14 * (x * k) * (x * k) - 0.05 * y);
  }
  g.computeVertexNormals();
  return withTip(g, (_x, y) => y / 1.35);
}
