// Converts Gaussian splat PLYs from wildflow/soneva-corals (Hugging Face, CC BY 4.0)
// into compact SPZ files the browser can stream, keeping every survey of a plot
// in the plot's shared, co-registered frame.
//
//   PLY (62 floats per splat, spherical harmonics to degree 3)
//     -> crop to the surveyed plot, drop near-transparent splats and floaters
//     -> shift by one origin per plot (so the surveys still line up)
//     -> SPZ v2 (Niantic's gzip format: 24-bit positions, 8-bit everything else,
//        degree-0 colour only), about 7x smaller than the PLY
//
// Output: public/splats/soneva/<plot>/<date>-lod<N>.spz and a manifest in
// data/build/atlas/flagships/soneva-splats.json (loaded into Tiger by `pnpm db:atlas`).
// Source PLYs are cached in data/cache (ignored).
//
// Run: node scripts/prepare-splats.mjs <plot> [lod=2]   e.g.  node scripts/prepare-splats.mjs ootsl1 2

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, "../../..");
const REV = "200aaf30cda920bd9b0e5d5da8838d4165c9e289";
const HF = `https://huggingface.co/datasets/wildflow/soneva-corals/resolve/${REV}`;
const CACHE = path.join(ROOT, "data/cache/soneva");
const OUT = path.resolve(here, "../public/splats/soneva");
const MANIFEST = path.join(ROOT, "data/build/atlas/flagships/soneva-splats.json");

const plot = process.argv[2];
const lod = Number(process.argv[3] ?? 2);
if (!plot) throw new Error("usage: prepare-splats.mjs <plot> [lod]");

const metadata = JSON.parse(fs.readFileSync(path.join(ROOT, "data/raw/soneva/metadata.json"), "utf8"));
const surveys = Object.keys(metadata)
  .filter((k) => k.split("_")[2] === plot)
  .sort();
if (!surveys.length) throw new Error(`no surveys for plot ${plot}`);

async function cached(survey) {
  fs.mkdirSync(CACHE, { recursive: true });
  const file = path.join(CACHE, `${survey}-lod${lod}.ply`);
  if (!fs.existsSync(file)) {
    const url = `${HF}/${survey}/splats/ply/lod${lod}.ply`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  }
  return file;
}

function readPly(file) {
  const buf = fs.readFileSync(file);
  const end = buf.indexOf("end_header\n");
  const header = buf.subarray(0, end).toString("latin1");
  if (!header.includes("binary_little_endian")) throw new Error("expected binary little-endian PLY");
  const n = Number(header.match(/element vertex (\d+)/)[1]);
  const props = [...header.matchAll(/property float (\S+)/g)].map((m) => m[1]);
  const start = end + "end_header\n".length;
  const floats = new Float32Array(buf.buffer.slice(buf.byteOffset + start, buf.byteOffset + start + n * props.length * 4));
  const col = Object.fromEntries(props.map((p, i) => [p, i]));
  return { n, stride: props.length, floats, col, sha256: crypto.createHash("sha256").update(buf).digest("hex") };
}

const sigmoid = (x) => 1 / (1 + Math.exp(-x));
const quantile = (arr, q) => {
  const s = Float32Array.from(arr).sort();
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(q * (s.length - 1))))];
};

/** Crop box and origin from the plot's first survey, shared by all of its surveys. */
function frameOf(ply) {
  const { n, stride, floats, col } = ply;
  const xs = new Float32Array(n), ys = new Float32Array(n), zs = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    xs[i] = floats[i * stride + col.x];
    ys[i] = floats[i * stride + col.y];
    zs[i] = floats[i * stride + col.z];
  }
  const pad = 0.4;
  const box = {
    x: [quantile(xs, 0.005) - pad, quantile(xs, 0.995) + pad],
    y: [quantile(ys, 0.005) - pad, quantile(ys, 0.995) + pad],
    z: [quantile(zs, 0.002) - 0.6, quantile(zs, 0.998) + 0.6],
  };
  const origin = [(box.x[0] + box.x[1]) / 2, (box.y[0] + box.y[1]) / 2, quantile(zs, 0.5)];
  return { box, origin };
}

function toSpz(ply, frame) {
  const { n, stride, floats, col } = ply;
  const keep = [];
  for (let i = 0; i < n; i++) {
    const o = i * stride;
    const x = floats[o + col.x], y = floats[o + col.y], z = floats[o + col.z];
    if (x < frame.box.x[0] || x > frame.box.x[1] || y < frame.box.y[0] || y > frame.box.y[1] || z < frame.box.z[0] || z > frame.box.z[1]) continue;
    if (sigmoid(floats[o + col.opacity]) < 0.02) continue;
    const maxScale = Math.exp(Math.max(floats[o + col.scale_0], floats[o + col.scale_1], floats[o + col.scale_2]));
    if (maxScale > 0.6) continue; // metre-wide floaters in open water
    keep.push(i);
  }
  const m = keep.length;
  const FRAC = 12; // 1/4096 m ≈ 0.24 mm position steps
  const header = Buffer.alloc(16);
  header.writeUInt32LE(0x5053474e, 0); // "NGSP"
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(m, 8);
  header.writeUInt8(0, 12); // SH degree
  header.writeUInt8(FRAC, 13);
  header.writeUInt8(0, 14); // flags
  const pos = Buffer.alloc(m * 9);
  const alpha = Buffer.alloc(m);
  const color = Buffer.alloc(m * 3);
  const scale = Buffer.alloc(m * 3);
  const rot = Buffer.alloc(m * 3);
  const u8 = (v) => Math.max(0, Math.min(255, Math.round(v)));
  let k = 0;
  for (const i of keep) {
    const o = i * stride;
    const p = [floats[o + col.x] - frame.origin[0], floats[o + col.y] - frame.origin[1], floats[o + col.z] - frame.origin[2]];
    for (let a = 0; a < 3; a++) {
      const fixed = Math.round(p[a] * (1 << FRAC));
      pos.writeIntLE(Math.max(-8388608, Math.min(8388607, fixed)), k * 9 + a * 3, 3);
    }
    alpha[k] = u8(sigmoid(floats[o + col.opacity]) * 255);
    for (let a = 0; a < 3; a++) {
      color[k * 3 + a] = u8(floats[o + col[`f_dc_${a}`]] * 0.15 * 255 + 127.5);
      scale[k * 3 + a] = u8((floats[o + col[`scale_${a}`]] + 10) * 16);
    }
    // PLY stores (w, x, y, z); SPZ v2 stores x, y, z with w >= 0 implied.
    let w = floats[o + col.rot_0], x = floats[o + col.rot_1], y = floats[o + col.rot_2], z = floats[o + col.rot_3];
    const len = Math.hypot(w, x, y, z) || 1;
    const sgn = w < 0 ? -1 : 1;
    [x, y, z] = [x, y, z].map((v) => (sgn * v) / len);
    rot[k * 3] = u8(x * 127.5 + 127.5);
    rot[k * 3 + 1] = u8(y * 127.5 + 127.5);
    rot[k * 3 + 2] = u8(z * 127.5 + 127.5);
    k++;
  }
  return { bytes: zlib.gzipSync(Buffer.concat([header, pos, alpha, color, scale, rot]), { level: 9 }), count: m };
}

const manifest = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, "utf8")) : { dataset: "wildflow/soneva-corals", revision: REV, license: "CC BY 4.0", plots: {} };
const plies = [];
for (const s of surveys) plies.push({ survey: s, ply: readPly(await cached(s)) });
const frame = frameOf(plies[0].ply);
fs.mkdirSync(path.join(OUT, plot), { recursive: true });
const entries = [];
for (const { survey, ply } of plies) {
  const date = survey.split("_")[3];
  const { bytes, count } = toSpz(ply, frame);
  const rel = `${plot}/${date}-lod${lod}.spz`;
  fs.writeFileSync(path.join(OUT, rel), bytes);
  entries.push({
    survey,
    date: `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6)}`,
    file: `/splats/soneva/${rel}`,
    lod,
    splats: count,
    sourceSplats: ply.n,
    bytes: bytes.length,
    source: `${HF}/${survey}/splats/ply/lod${lod}.ply`,
    sourceSha256: ply.sha256,
  });
  console.log(`${survey} lod${lod}: ${ply.n} -> ${count} splats, ${(bytes.length / 1e6).toFixed(2)} MB`);
}
manifest.plots[plot] = { frame: { origin: frame.origin, box: frame.box, up: "+z", units: "m" }, surveys: entries };
fs.mkdirSync(path.dirname(MANIFEST), { recursive: true });
fs.mkdirSync(path.dirname(MANIFEST), { recursive: true });
fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + "\n");
