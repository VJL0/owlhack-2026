// Measures change between co-registered Soneva surveys, and the noise floor it
// has to beat. For each plot the first survey is the baseline; every later
// survey is compared cell by cell (5 cm, top-down) on the height of the reef's
// top surface, after removing any overall vertical offset.
//
// Surveys taken a few days apart (the reef cannot have changed much) show how
// much two reconstructions disagree anyway. A later survey only shows change
// where it disagrees more than that.
//
// Input: LOD3 splat PLYs (cached in data/cache/soneva). Output:
// data/build/atlas/flagships/soneva-change.json (derived; loaded into Tiger by `pnpm db:atlas`).
//
// Run: node scripts/analyze-soneva.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, "../../..");
const REV = "200aaf30cda920bd9b0e5d5da8838d4165c9e289";
const HF = `https://huggingface.co/datasets/wildflow/soneva-corals/resolve/${REV}`;
const CACHE = path.join(ROOT, "data/cache/soneva");
const LOD = 3;
const CELL = 0.05; // metres
const THRESH = 0.1; // a cell "changed" if its top surface moved more than 10 cm

const metadata = JSON.parse(fs.readFileSync(path.join(ROOT, "data/raw/soneva/metadata.json"), "utf8"));
const surveys = Object.keys(metadata).sort();

async function load(survey) {
  fs.mkdirSync(CACHE, { recursive: true });
  const file = path.join(CACHE, `${survey}-lod${LOD}.ply`);
  if (!fs.existsSync(file)) {
    const res = await fetch(`${HF}/${survey}/splats/ply/lod${LOD}.ply`);
    if (!res.ok) throw new Error(`${res.status} ${survey}`);
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  }
  const buf = fs.readFileSync(file);
  const end = buf.indexOf("end_header\n");
  const header = buf.subarray(0, end).toString("latin1");
  const n = Number(header.match(/element vertex (\d+)/)[1]);
  const props = [...header.matchAll(/property float (\S+)/g)].map((m) => m[1]);
  const start = end + 11;
  const f = new Float32Array(buf.buffer.slice(buf.byteOffset + start, buf.byteOffset + start + n * props.length * 4));
  const c = Object.fromEntries(props.map((p, i) => [p, i]));
  const out = [];
  for (let i = 0; i < n; i++) {
    const o = i * props.length;
    if (1 / (1 + Math.exp(-f[o + c.opacity])) < 0.3) continue; // solid splats only
    out.push(f[o + c.x], f[o + c.y], f[o + c.z]);
  }
  return Float32Array.from(out);
}

function quantile(arr, q) {
  const s = Float32Array.from(arr).sort();
  return s[Math.floor(q * (s.length - 1))];
}

/** Top-surface height per cell (max z), NaN where empty. */
function heightMap(xyz, box, w, h) {
  const zm = new Float32Array(w * h).fill(NaN);
  for (let i = 0; i < xyz.length; i += 3) {
    const cx = Math.floor((xyz[i] - box.x0) / CELL);
    const cy = Math.floor((xyz[i + 1] - box.y0) / CELL);
    if (cx < 0 || cy < 0 || cx >= w || cy >= h) continue;
    const k = cy * w + cx;
    if (!(zm[k] >= xyz[i + 2])) zm[k] = xyz[i + 2];
  }
  return zm;
}

const byPlot = new Map();
for (const s of surveys) {
  const plot = s.split("_")[2];
  if (!byPlot.has(plot)) byPlot.set(plot, []);
  byPlot.get(plot).push(s);
}

const result = { method: `Top-surface height per ${CELL * 100} cm cell from LOD${LOD} splats (opacity > 0.3); a cell counts as changed when its height differs from the plot's first survey by more than ${THRESH * 100} cm after removing the median vertical offset.`, plots: {} };
for (const [plot, list] of byPlot) {
  const clouds = [];
  for (const s of list) clouds.push(await load(s));
  const base = clouds[0];
  const xs = base.filter((_, i) => i % 3 === 0), ys = base.filter((_, i) => i % 3 === 1);
  const box = { x0: quantile(xs, 0.02), x1: quantile(xs, 0.98), y0: quantile(ys, 0.02), y1: quantile(ys, 0.98) };
  const w = Math.ceil((box.x1 - box.x0) / CELL), h = Math.ceil((box.y1 - box.y0) / CELL);
  const maps = clouds.map((c) => heightMap(c, box, w, h));
  const baseDate = metadata[list[0]].capture_date;
  const rows = [];
  for (let k = 1; k < list.length; k++) {
    const dz = [];
    for (let i = 0; i < w * h; i++) if (!Number.isNaN(maps[0][i]) && !Number.isNaN(maps[k][i])) dz.push(maps[k][i] - maps[0][i]);
    const shift = quantile(dz, 0.5);
    let changed = 0, lower = 0, higher = 0;
    for (const d of dz) {
      const v = d - shift;
      if (Math.abs(v) > THRESH) changed++;
      if (v < -THRESH) lower++;
      if (v > THRESH) higher++;
    }
    const date = metadata[list[k]].capture_date;
    const days = (Date.parse(date) - Date.parse(baseDate)) / 86_400_000;
    rows.push({ date, days, cells: dz.length, areaM2: +(dz.length * CELL * CELL).toFixed(1), changedPct: +((100 * changed) / dz.length).toFixed(1), lowerPct: +((100 * lower) / dz.length).toFixed(1), higherPct: +((100 * higher) / dz.length).toFixed(1), shiftCm: +(shift * 100).toFixed(1) });
  }
  result.plots[plot] = { baseline: baseDate, comparisons: rows };
  console.log(plot, baseDate, rows.map((r) => `${r.date} (+${r.days} d): ${r.changedPct}%`).join("  "));
}
fs.mkdirSync(path.join(ROOT, "data/build/atlas/flagships"), { recursive: true });
fs.writeFileSync(path.join(ROOT, "data/build/atlas/flagships/soneva-change.json"), JSON.stringify(result, null, 2) + "\n");
