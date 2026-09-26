// Deterministic value noise + the reef's spur-and-groove terrain.
// Scene units are metres; the sea surface sits at y = 0.

function hash(x: number, y: number) {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function noise2(x: number, y: number) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi);
  const b = hash(xi + 1, yi);
  const c = hash(xi, yi + 1);
  const d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

export function fbm2(x: number, y: number, oct = 4) {
  let s = 0;
  let a = 0.5;
  for (let i = 0; i < oct; i++) {
    s += a * noise2(x, y);
    x *= 2.03;
    y *= 2.03;
    a *= 0.5;
  }
  return s;
}

export function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Each reef site samples a different patch of the same noise field.
let OX = 0;
let OZ = 0;
export function setTerrainSite(index: number) {
  OX = index * 37.3;
  OZ = index * 11.7;
}

/**
 * Florida's fore reef is classic spur-and-groove: coral ridges running
 * seaward, separated by sand channels. Here the crest lies toward -z and the
 * bottom deepens toward +z.
 */
export function spurAmount(x: number, z: number) {
  const warp = (fbm2((x + OX) * 0.045 + 3.1, (z + OZ) * 0.045 - 1.7) - 0.5) * 7;
  const s = 0.5 + 0.5 * Math.cos(((x + warp + OX * 0.37) / 10) * Math.PI * 2);
  const fade = 1 - Math.min(1, Math.max(0, (z - 14) / 22));
  return Math.pow(s, 2.1) * fade;
}

export function floorHeight(x: number, z: number) {
  const nx = x + OX;
  const nz = z + OZ;
  const base = -9 - z * 0.075 + (fbm2(nx * 0.03, nz * 0.03) - 0.5) * 1.2;
  const spur = spurAmount(x, z);
  const spurH = spur * (2.4 + (fbm2(nx * 0.09 + 9, nz * 0.09) - 0.5) * 1.6);
  const rough = (fbm2(nx * 0.55, nz * 0.55) - 0.5) * 0.55 * spur + (noise2(nx * 2.3, nz * 2.3) - 0.5) * 0.07;
  return base + spurH + rough;
}

export const REEF_CENTER: [number, number, number] = [0, -7.2, -3];
