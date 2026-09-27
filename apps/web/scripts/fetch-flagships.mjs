// Downloads the public source data for the three flagship reefs into /data/raw
// and reduces the very large tables to what the atlas uses. Every download is
// pinned to a package revision (EDI), a dataset DOI (AIMS) or a git revision
// (Hugging Face), and its SHA-256 is written to data/raw/<source>/sources.json.
//
//   Moorea        MCR LTER data packages on EDI. PASTA refuses anonymous reads,
//                 so the bytes come from EDI's DataONE member node (gmn.lternet.edu),
//                 which serves the same objects under their PASTA identifiers.
//   Lizard Island AIMS Long-Term Monitoring Program, dataset 10.25845/5c09bc4ff315c,
//                 through the public API behind apps.aims.gov.au/reef-monitoring.
//   Soneva Fushi  wildflow/soneva-corals on Hugging Face (metadata only here;
//                 the splats are converted by prepare-splats.mjs).
//
//   Cyclones      NOAA NCEI IBTrACS v04r01 (South Pacific, South Indian, North Indian
//                 basins): every storm with a fix within 400 km of a flagship.
//   Heat stress   NOAA Coral Reef Watch 5 km v3.1 (NOAA CoastWatch ERDDAP), weekly samples
//                 from 2002: CRW's 1985–2002 SST comes from the Met Office OSTIA
//                 reanalysis, which carries a non-commercial, licence-required notice.
//
// Run: node scripts/fetch-flagships.mjs [moorea|lizard|soneva|ibtracs|crw ...]

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import readline from "node:readline";
import zlib from "node:zlib";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const RAW = path.resolve(here, "../../../data/raw");
const UA = { "User-Agent": "ReefAtlas/1.0 (+https://reefatlas.us)" };
const today = new Date().toISOString().slice(0, 10);

const want = new Set(process.argv.slice(2));
const run = (k) => want.size === 0 || want.has(k);

async function get(url) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { headers: UA });
    if (res.ok) return res;
    if (attempt >= 3 || res.status < 500) throw new Error(`${res.status} ${url}`);
    await new Promise((r) => setTimeout(r, 1500 * attempt));
  }
}

/** Download to a file, returning its SHA-256 and size. */
async function download(url, file) {
  const res = await get(url);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(file, buf);
  return { sha256: crypto.createHash("sha256").update(buf).digest("hex"), bytes: buf.length };
}

/** Stream a remote CSV line by line (hashing the raw bytes) without holding it in memory. */
async function streamCsv(url, onRow) {
  const res = await get(url);
  const hash = crypto.createHash("sha256");
  let bytes = 0;
  const body = Readable.fromWeb(res.body);
  body.on("data", (c) => {
    hash.update(c);
    bytes += c.length;
  });
  const rl = readline.createInterface({ input: body, crlfDelay: Infinity });
  let header = null;
  for await (const line of rl) {
    if (!line) continue;
    const cells = parseCsvLine(line);
    if (!header) header = cells;
    else onRow(cells, header);
  }
  return { sha256: hash.digest("hex"), bytes };
}

function parseCsvLine(line) {
  if (!line.includes('"')) return line.split(",");
  const out = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
}

const csv = (rows) => rows.map((r) => r.join(",")).join("\n") + "\n";

// ------------------------------------------------------------------ Moorea (MCR LTER)
const PASTA = "https://pasta.lternet.edu/package";
const gmn = (pastaUrl) => `https://gmn.lternet.edu/mn/v2/object/${encodeURIComponent(pastaUrl)}`;
const entity = (pkg, rev, id) => `${PASTA}/data/eml/knb-lter-mcr/${pkg}/${rev}/${id}`;

const MCR = {
  coral: { pkg: 4, rev: 44, id: "c0c1055650f980f3bf8021b6686786b4", name: "Percent Cover - Wide Table" },
  fish: { pkg: 6, rev: 65, id: "ac2c7a859ce8595ec1339e8530b9ba50", name: "Annual Fish Surveys" },
  cots: { pkg: 1039, rev: 13, id: "e41a5f8218737b1d03c5baa845b4c480", name: "COTS_abundance" },
  thermistorLter0: { pkg: 1035, rev: 18, id: "a7a0ae7c22a454a47424d3361b6c27ad", name: "MCR_LTER00_BackreefForereef_BottomMountThermistors_20250522" },
  thermistorLter2: { pkg: 1035, rev: 18, id: "fa4fcd8b5d790a19df8c8296fcbc6cd5", name: "MCR_LTER02_BackreefForereef_BottomMountThermistors_20250522" },
  lagoonDaily: { pkg: 1045, rev: 7, id: "7a8090507e95d40ba98d837388f7c506", name: "Temperature Summary by Day" },
  lagoonSites: { pkg: 1045, rev: 7, id: "79411816d26d08c38bbf4227495c2835", name: "Lagoon Bottom Mount Thermistor Locations (KMZ)" },
  bleaching2019: { pkg: 5050, rev: 1, id: "4dd5cdfec741b8d5eaa32858f8cf0f01", name: "Resilience Plots" },
};

async function fetchMoorea() {
  const dir = path.join(RAW, "mcr");
  fs.mkdirSync(dir, { recursive: true });
  const sources = {};
  const note = (key, file, res, extra = {}) => {
    const e = MCR[key];
    sources[key] = {
      file,
      package: `knb-lter-mcr.${e.pkg}.${e.rev}`,
      entity: e.name,
      url: entity(e.pkg, e.rev, e.id),
      retrieved: today,
      sha256: res.sha256,
      bytes: res.bytes,
      license: "CC BY 4.0",
      ...extra,
    };
    console.log(`mcr ${key.padEnd(16)} ${(res.bytes / 1e6).toFixed(1)} MB -> ${file}`);
  };
  const src = (k) => gmn(entity(MCR[k].pkg, MCR[k].rev, MCR[k].id));

  // Small tables are kept as published.
  for (const [key, file] of [
    ["coral", "coral_wide.csv"],
    ["cots", "cots.csv"],
    ["bleaching2019", "bleaching2019_colonies.csv"],
  ]) {
    note(key, file, await download(src(key), path.join(dir, file)));
  }

  // Lagoon network: keep one mean and max per sensor and day.
  {
    const rows = [["site", "date", "mean_c", "max_c"]];
    const res = await streamCsv(src("lagoonDaily"), (c, h) => {
      const r = Object.fromEntries(h.map((k, i) => [k, c[i]]));
      if (r.mean_temp_c === "" || r.mean_temp_c === "NA") return;
      rows.push([r.site, r.date_local, (+r.mean_temp_c).toFixed(3), (+r.max_temp_c).toFixed(3)]);
    });
    fs.writeFileSync(path.join(dir, "lagoon_daily.csv"), csv(rows));
    note("lagoonDaily", "lagoon_daily.csv", res, { reduced: "site, local date, daily mean and max temperature" });
  }

  // Lagoon sensor positions: a KMZ (zip) holding doc.kml. Extract the placemarks.
  {
    const res = await get(src("lagoonSites"));
    const buf = Buffer.from(await res.arrayBuffer());
    const kml = unzipFirst(buf);
    const rows = [["site", "lat", "lon"]];
    for (const pm of kml.matchAll(/<Placemark>([\s\S]*?)<\/Placemark>/g)) {
      const name = pm[1].match(/<name>([\s\S]*?)<\/name>/)[1].trim();
      const [lon, lat] = pm[1].match(/<coordinates>([\s\S]*?)<\/coordinates>/)[1].trim().split(",").map(Number);
      rows.push([name, lat.toFixed(6), lon.toFixed(6)]);
    }
    fs.writeFileSync(path.join(dir, "lagoon_sites.csv"), csv(rows));
    note("lagoonSites", "lagoon_sites.csv", { sha256: crypto.createHash("sha256").update(buf).digest("hex"), bytes: buf.length }, {
      reduced: "placemark name, latitude, longitude from doc.kml",
    });
  }

  // Fish: biomass density per transect and coarse trophic group.
  // The 5 m swath (250 m²) counts mobile fishes; the 1 m swath (50 m²) the small,
  // site-attached ones, so each swath is divided by its own area before summing.
  {
    const acc = new Map();
    const res = await streamCsv(src("fish"), (c, h) => {
      const r = Object.fromEntries(h.map((k, i) => [k, c[i]]));
      const b = +r.Biomass;
      if (!(b >= 0)) return; // -1 = not available
      const area = r.Swath === "1" ? 50 : 250;
      const key = [r.Year, r.Habitat, r.Site, r.Transect, r.Coarse_Trophic || "na"].join("|");
      acc.set(key, (acc.get(key) ?? 0) + b / area);
      const all = [r.Year, r.Habitat, r.Site, r.Transect, "_transect"].join("|");
      if (!acc.has(all)) acc.set(all, 0); // records that the transect was surveyed
    });
    const rows = [["year", "habitat", "site", "transect", "trophic", "biomass_g_m2"]];
    for (const [k, v] of [...acc].sort()) {
      const [y, hab, site, tr, g] = k.split("|");
      if (g === "_transect") continue;
      rows.push([y, hab, site, tr, g, v.toFixed(3)]);
    }
    // transects surveyed (even with no fish of a group) so means use the right denominator
    const tr = [["year", "habitat", "site", "transect"]];
    for (const k of [...acc.keys()].filter((k) => k.endsWith("|_transect")).sort()) tr.push(k.split("|").slice(0, 4));
    fs.writeFileSync(path.join(dir, "fish_biomass_transect.csv"), csv(rows));
    fs.writeFileSync(path.join(dir, "fish_transects.csv"), csv(tr));
    note("fish", "fish_biomass_transect.csv", res, { reduced: "sum of Biomass / swath area (1 m: 50 m², 5 m: 250 m²) per transect and Coarse_Trophic" });
  }

  // Bottom-mounted thermistors: daily mean and max per sensor depth (local date).
  for (const [key, site] of [
    ["thermistorLter0", "LTER_0"],
    ["thermistorLter2", "LTER_2"],
  ]) {
    const acc = new Map();
    const res = await streamCsv(src(key), (c) => {
      // site,time_local,time_utc,reef_type_code,sensor_type,sensor_depth_m,temperature_c
      const t = +c[6];
      if (!Number.isFinite(t)) return;
      const k = `${c[3]}|${c[5]}|${c[1].slice(0, 10)}`;
      const a = acc.get(k);
      if (a) {
        a[0] += t;
        a[1]++;
        a[2] = Math.max(a[2], t);
      } else acc.set(k, [t, 1, t]);
    });
    const rows = [["site", "habitat", "depth_m", "date", "mean_c", "max_c", "n"]];
    for (const [k, [s, n, mx]] of [...acc].sort()) {
      const [hab, depth, date] = k.split("|");
      if (n < 24) continue; // a partial day (deployment or recovery)
      rows.push([site, hab, depth, date, (s / n).toFixed(3), mx.toFixed(3), n]);
    }
    const file = `thermistor_daily_${site.toLowerCase()}.csv`;
    fs.writeFileSync(path.join(dir, file), csv(rows));
    note(key, file, res, { reduced: "daily mean/max of temperature_c by reef_type_code, sensor_depth_m and local date; days with < 24 readings dropped" });
  }

  fs.writeFileSync(path.join(dir, "sources.json"), JSON.stringify(sources, null, 2) + "\n");
}

/** Minimal reader for a single-entry zip (stored or deflated). */
function unzipFirst(buf) {
  if (buf.readUInt32LE(0) !== 0x04034b50) return buf.toString("utf8");
  const method = buf.readUInt16LE(8);
  const size = buf.readUInt32LE(18);
  const nameLen = buf.readUInt16LE(26);
  const extraLen = buf.readUInt16LE(28);
  const start = 30 + nameLen + extraLen;
  const data = buf.subarray(start, start + size);
  return (method === 8 ? zlib.inflateRawSync(data) : data).toString("utf8");
}

// ------------------------------------------------------------------ Lizard Island (AIMS LTMP)
const AIMS = "https://api.aims.gov.au/data-v2.0/10.25845/5c09bc4ff315c";
const REEF = "Lizard Isles";

async function fetchLizard() {
  const dir = path.join(RAW, "aims");
  fs.mkdirSync(dir, { recursive: true });
  const q = encodeURIComponent(REEF);
  const files = {
    "lizard_manta.json": `${AIMS}/data?domain_name=${q}&domain_category=reef&data_type=manta`,
    "lizard_photo_transect.json": `${AIMS}/data?domain_name=${q}&domain_category=reef&data_type=photo-transect`,
    "lizard_juvenile.json": `${AIMS}/data?domain_name=${q}&domain_category=reef&data_type=juvenile`,
    "lizard_cots.json": `${AIMS}/cots-by-domain?domain_category=reef&domain_name=${q}`,
    "lizard_disturbance.json": `${AIMS}/disturbance?reef=${q}&aggregation=reef&zone=_`,
    "lizard_sites.json": `${AIMS}/site?aims_reef_name=${q}`,
    "ltmp_reefs.json": `${AIMS}/reef`,
  };
  const sources = {};
  for (const [file, url] of Object.entries(files)) {
    const res = await download(url, path.join(dir, file));
    // Re-serialise with stable key order so reruns diff cleanly.
    const json = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
    fs.writeFileSync(path.join(dir, file), JSON.stringify(json, null, 0) + "\n");
    sources[file] = { url, dataset: "AIMS Long-Term Monitoring Program (doi:10.25845/5c09bc4ff315c)", retrieved: today, ...res, license: "CC BY 4.0" };
    console.log(`aims ${file.padEnd(28)} ${(res.bytes / 1e3).toFixed(0)} KB`);
  }
  fs.writeFileSync(path.join(dir, "sources.json"), JSON.stringify(sources, null, 2) + "\n");
}

// ------------------------------------------------------------------ Soneva Fushi (wildflow/soneva-corals)
const SONEVA_REV = "200aaf30cda920bd9b0e5d5da8838d4165c9e289";
const HF = `https://huggingface.co/datasets/wildflow/soneva-corals/resolve/${SONEVA_REV}`;

async function fetchSoneva() {
  const dir = path.join(RAW, "soneva");
  fs.mkdirSync(dir, { recursive: true });
  const res = await download(`${HF}/metadata.json`, path.join(dir, "metadata.json"));
  const sources = {
    "metadata.json": { url: `${HF}/metadata.json`, dataset: "wildflow/soneva-corals", revision: SONEVA_REV, retrieved: today, ...res, license: "CC BY 4.0" },
  };
  fs.writeFileSync(path.join(dir, "sources.json"), JSON.stringify(sources, null, 2) + "\n");
  console.log(`soneva metadata.json ${(res.bytes / 1e3).toFixed(0)} KB`);
}

// ------------------------------------------------------------------ NOAA Coral Reef Watch (weekly)
// Pixel centres chosen next to each flagship's monitored reef (all ocean pixels).
const CRW_SITES = [
  { id: "moorea", lat: -17.475, lon: -149.825, note: "north shore forereef, between MCR LTER 1 and 2" },
  { id: "lizard-island", lat: -14.675, lon: 145.475, note: "AIMS LTMP reef 'Lizard Isles'" },
  { id: "soneva-fushi", lat: 5.125, lon: 73.075, note: "Soneva Fushi house reef plots" },
];
// NOAA's CoastWatch ERDDAP serves the CRW daily 5 km products as separate datasets.
const ERDDAP = "https://coastwatch.noaa.gov/erddap/griddap";
const CRW_VARS = [
  { dataset: "noaacrwdhwDaily", variable: "degree_heating_week", column: "CRW_DHW" },
  { dataset: "noaacrwsstDaily", variable: "analysed_sst", column: "CRW_SST" },
  { dataset: "noaacrwsstanomalyDaily", variable: "sea_surface_temperature_anomaly", column: "CRW_SSTANOMALY" },
];
const CRW_START = Date.UTC(2002, 0, 6, 12); // a Sunday, the weekly cadence used for Florida too
const CRW_END = Date.UTC(2026, 8, 13, 12);
const WEEK = 7 * 86_400_000;
const isoZ = (ms) => new Date(ms).toISOString().replace(".000", "");

async function crwSeries(s, v) {
  const out = new Map();
  const cacheDir = path.join(RAW, "../cache/crw");
  fs.mkdirSync(cacheDir, { recursive: true });
  // Two-year chunks keep each request small (ERDDAP reads one file per time step).
  // Chunks are cached, so a rerun after a transient server error only fills the holes.
  for (let a = CRW_START; a <= CRW_END; a += 104 * WEEK) {
    const b = Math.min(CRW_END, a + 103 * WEEK);
    const cache = path.join(cacheDir, `${s.id}-${v.dataset}-${isoZ(a).slice(0, 10)}-${isoZ(b).slice(0, 10)}.csv`);
    const url = `${ERDDAP}/${v.dataset}.csv?${v.variable}%5B(${isoZ(a)}):7:(${isoZ(b)})%5D%5B(${s.lat})%5D%5B(${s.lon})%5D`;
    let text = fs.existsSync(cache) ? fs.readFileSync(cache, "utf8") : "";
    for (let attempt = 1; attempt <= 6 && !text.startsWith("time,"); attempt++) {
      try {
        const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(300_000) });
        if (res.ok) text = await res.text();
      } catch {}
      if (!text.startsWith("time,")) await new Promise((r) => setTimeout(r, 8000 * attempt));
    }
    if (!text.startsWith("time,")) throw new Error(`CRW ${s.id} ${v.dataset} ${isoZ(a)} failed; rerun to resume`);
    fs.writeFileSync(cache, text);
    // ERDDAP's stride counts array steps, not days: a missing day in one product
    // shifts its samples by a day. Key every sample by its week instead.
    for (const line of text.trim().split("\n").slice(2)) {
      const c = line.split(",");
      out.set(Math.round((Date.parse(c[0]) - CRW_START) / WEEK), { t: c[0], v: c[3] });
    }
  }
  return out;
}

async function fetchCrw() {
  const dir = path.join(RAW, "crw");
  const sources = fs.existsSync(path.join(dir, "sources.json")) ? JSON.parse(fs.readFileSync(path.join(dir, "sources.json"), "utf8")) : {};
  await Promise.all(
    CRW_SITES.map(async (s) => {
      const series = [];
      for (const v of CRW_VARS) {
        series.push(await crwSeries(s, v));
        console.log(`crw ${s.id} ${v.dataset} ${series.at(-1).size} weeks`);
      }
      const weeks = [...series[0].keys()].sort((a, b) => a - b);
      const rows = [["time", "latitude", "longitude", ...CRW_VARS.map((v) => v.column)]];
      for (const w of weeks) rows.push([series[0].get(w).t, s.lat, s.lon, ...series.map((m) => m.get(w)?.v ?? "NaN")]);
      const body = csv(rows);
      const file = `weekly-${s.id}.csv`;
      fs.writeFileSync(path.join(dir, file), body);
      sources[file] = {
        dataset: "NOAA Coral Reef Watch daily global 5 km v3.1 (DHW, CoralTemp SST, SST anomaly), sampled every 7 days",
        url: CRW_VARS.map((v) => `${ERDDAP}/${v.dataset}`),
        pixel: { lat: s.lat, lon: s.lon },
        note: s.note,
        retrieved: today,
        sha256: crypto.createHash("sha256").update(body).digest("hex"),
        license: "NOAA Coral Reef Watch: free to use with credit (from 2002 the SST is GHRSST-based)",
      };
    }),
  );
  fs.writeFileSync(path.join(dir, "sources.json"), JSON.stringify(sources, null, 2) + "\n");
}

if (run("moorea")) await fetchMoorea();
if (run("lizard")) await fetchLizard();
if (run("soneva")) await fetchSoneva();
if (run("ibtracs")) await fetchIbtracs();
if (run("crw")) await fetchCrw();
