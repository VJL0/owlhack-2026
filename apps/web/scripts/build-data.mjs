// Builds the frontend demo dataset from raw public sources in /data/raw.
//
//   observed  – NOAA Coral Reef Watch 5 km DHW/SST (ERDDAP), NOAA NHC HURDAT2,
//               USGS Nonindigenous Aquatic Species lionfish records
//   derived   – rolling windows and distances computed here from observed data
//   simulated – AIS fishing / vessel / SAR activity (Global Fishing Watch is not
//               wired yet); seeded so the demo is deterministic
//
// Output: data/build/atlas/*.json at the repo root (ignored by Git). The app reads
// Tiger Cloud, not these files: load them with `pnpm db:atlas`.
// Run: node scripts/build-data.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const RAW = path.resolve(here, "../../../data/raw");
const OUT = path.resolve(here, "../../../data/build/atlas");
fs.mkdirSync(OUT, { recursive: true });

const EPOCH = Date.UTC(2016, 0, 1);
const DAY = 86_400_000;
const toDay = (ms) => (ms - EPOCH) / DAY;
const r2 = (v) => Math.round(v * 100) / 100;

// Coordinates: reef lights (Wikipedia, List of lighthouses in Florida) and Looe Key (Wikipedia).
const SITES = [
  { id: "fowey-rocks", name: "Fowey Rocks", lat: 25.5906, lon: -80.0967, region: "Biscayne", anchor: "Fowey Rocks Light" },
  { id: "carysfort-reef", name: "Carysfort Reef", lat: 25.2217, lon: -80.2117, region: "Upper Keys", anchor: "Carysfort Reef Light" },
  { id: "molasses-reef", name: "Molasses Reef", lat: 25.0119, lon: -80.3765, region: "Upper Keys", anchor: "Molasses Reef Light" },
  { id: "alligator-reef", name: "Alligator Reef", lat: 24.8517, lon: -80.6183, region: "Upper Keys", anchor: "Alligator Reef Light" },
  { id: "tennessee-reef", name: "Tennessee Reef", lat: 24.7461, lon: -80.7824, region: "Middle Keys", anchor: "Tennessee Reef Light" },
  { id: "sombrero-key", name: "Sombrero Key", lat: 24.6279, lon: -81.1116, region: "Middle Keys", anchor: "Sombrero Key Light" },
  { id: "looe-key", name: "Looe Key", lat: 24.5486, lon: -81.4058, region: "Lower Keys", anchor: "Looe Key reef", designation: "Sanctuary Preservation Area" },
  { id: "sand-key", name: "Sand Key", lat: 24.4539, lon: -81.8775, region: "Lower Keys", anchor: "Sand Key Light" },
  { id: "pulaski-shoal", name: "Pulaski Shoal", lat: 24.6933, lon: -82.773, region: "Dry Tortugas", anchor: "Pulaski Shoal Light" },
];

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// ---------------------------------------------------------------- thermal (observed)
const thermal = { dates: [], days: [], sites: {} };
for (const s of SITES) {
  const rows = fs
    .readFileSync(path.join(RAW, "crw", `${s.id}.csv`), "utf8")
    .trim()
    .split("\n")
    .slice(2)
    .map((l) => l.split(","));
  if (!thermal.dates.length) {
    thermal.dates = rows.map((r) => r[0].slice(0, 10));
    thermal.days = rows.map((r) => r2(toDay(Date.parse(r[0]))));
  }
  s.grid = { lat: +rows[0][1], lon: +rows[0][2] };
  thermal.sites[s.id] = {
    dhw: rows.map((r) => r2(+r[3])),
    sst: rows.map((r) => r2(+r[4])),
    ssta: rows.map((r) => r2(+r[5])),
    baa: rows.map((r) => +r[6]),
  };
}

// ---------------------------------------------------------------- storms (observed)
const hurdat = fs
  .readFileSync(path.join(RAW, "hurdat2", "hurdat2-1851-2025-091226.txt"), "utf8")
  .split("\n");
const allStorms = [];
for (let i = 0; i < hurdat.length; i++) {
  const line = hurdat[i];
  if (!/^AL\d{6},/.test(line)) continue;
  const [id, nameRaw, countRaw] = line.split(",").map((x) => x.trim());
  const count = +countRaw;
  const year = +id.slice(4);
  const pts = [];
  for (let k = 1; k <= count; k++) {
    const c = hurdat[i + k].split(",").map((x) => x.trim());
    const ymd = c[0];
    const hm = c[1].padStart(4, "0");
    const ms = Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8), +hm.slice(0, 2), +hm.slice(2));
    const lat = parseFloat(c[4]) * (c[4].endsWith("S") ? -1 : 1);
    const lon = parseFloat(c[5]) * (c[5].endsWith("W") ? -1 : 1);
    pts.push({ t: r2(toDay(ms)), iso: new Date(ms).toISOString().slice(0, 16) + "Z", rec: c[2], status: c[3], lat, lon, wind: +c[6], pres: +c[7] });
  }
  i += count;
  if (year < 2016 || year > 2024) continue;
  allStorms.push({ id, name: nameRaw.charAt(0) + nameRaw.slice(1).toLowerCase(), year, pts });
}

const MAX_KM = 400;
const storms = [];
for (const st of allStorms) {
  const closest = {};
  let min = Infinity;
  for (const s of SITES) {
    let best = null;
    // densify 6-hourly fixes to 30 min so closest approach is not quantised
    for (let k = 0; k < st.pts.length - 1; k++) {
      const a = st.pts[k], b = st.pts[k + 1];
      for (let f = 0; f < 1; f += 1 / 12) {
        const lat = a.lat + (b.lat - a.lat) * f;
        const lon = a.lon + (b.lon - a.lon) * f;
        const d = haversineKm(s.lat, s.lon, lat, lon);
        if (!best || d < best.km) best = { km: Math.round(d), t: r2(a.t + (b.t - a.t) * f), wind: Math.round(a.wind + (b.wind - a.wind) * f) };
      }
    }
    closest[s.id] = best;
    min = Math.min(min, best.km);
  }
  if (min > MAX_KM) continue;
  const peak = Math.max(...st.pts.map((p) => p.wind));
  // keep only the part of the track in the wider Gulf / Caribbean / W. Atlantic frame
  const pts = st.pts.filter((p) => p.lon > -98 && p.lon < -60 && p.lat > 10 && p.lat < 40);
  storms.push({ id: st.id, name: st.name, year: st.year, peakWindKt: peak, closest, pts });
}
storms.sort((a, b) => a.pts[0].t - b.pts[0].t);

// ---------------------------------------------------------------- lionfish (observed)
const nas = [
  ...JSON.parse(fs.readFileSync(path.join(RAW, "nas", "pterois_fl_monroe.json"), "utf8")).results,
  ...JSON.parse(fs.readFileSync(path.join(RAW, "nas", "pterois_fl_miamidade.json"), "utf8")).results,
];
const lionfish = nas
  .filter((x) => x.year >= 2016 && x.year <= 2024 && x.decimalLatitude && x.decimalLongitude)
  .map((x) => {
    const ms = Date.UTC(x.year, (x.month || 1) - 1, x.day || 1);
    const near = {};
    for (const s of SITES) near[s.id] = Math.round(haversineKm(s.lat, s.lon, x.decimalLatitude, x.decimalLongitude) * 10) / 10;
    return {
      key: x.key,
      t: r2(toDay(ms)),
      date: new Date(ms).toISOString().slice(0, 10),
      lat: x.decimalLatitude,
      lon: x.decimalLongitude,
      locality: (x.locality || "").replace(/^Atlantic Ocean, Florida( Keys)?, /, "").replace(/^Gulf of Mexico, Florida( Keys)?, /, ""),
      accuracy: x.latLongAccuracy,
      recordType: x.recordType,
      km: near,
    };
  })
  .sort((a, b) => a.t - b.t);

// ---------------------------------------------------------------- simulated AIS / SAR
// Seeded PRNG (mulberry32)
function rng(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const MONTHS = [];
for (let y = 2016; y <= 2024; y++) for (let m = 0; m < 12; m++) MONTHS.push({ y, m, t: r2(toDay(Date.UTC(y, m, 1))), label: `${y}-${String(m + 1).padStart(2, "0")}` });

// Site character for the simulation: relative AIS fishing and traffic levels.
// Sand Key sits by the Key West ship channel, Fowey Rocks by the Miami approach,
// Pulaski Shoal near the Tortugas shrimp grounds.
const SIM_PROFILE = {
  "fowey-rocks": { fish: 0.5, traffic: 1.6 },
  "carysfort-reef": { fish: 0.7, traffic: 0.7 },
  "molasses-reef": { fish: 0.8, traffic: 0.9 },
  "alligator-reef": { fish: 0.9, traffic: 0.6 },
  "tennessee-reef": { fish: 1.0, traffic: 0.5 },
  "sombrero-key": { fish: 1.1, traffic: 0.7 },
  "looe-key": { fish: 1.2, traffic: 0.8 },
  "sand-key": { fish: 1.0, traffic: 1.8 },
  "pulaski-shoal": { fish: 1.5, traffic: 0.6 },
};
const simulated = { months: MONTHS.map((m) => m.label), sites: {} };
SITES.forEach((s, si) => {
  const rand = rng(1234 + si * 97);
  const p = SIM_PROFILE[s.id];
  const fishing = [], vessel = [], sar = [], unmatched = [];
  MONTHS.forEach(({ y, m }) => {
    // spiny lobster commercial season runs Aug 6 – Mar 31; stone crab Oct 15 – May 1
    const lobster = m >= 7 || m <= 2 ? 1 : 0.35;
    const crab = m >= 9 || m <= 4 ? 0.25 : 0;
    // tourism peak Jan–Apr; COVID-19 lull and US cruise halt (Mar 2020 – mid 2021)
    const season = 1 + 0.35 * Math.cos(((m - 2) / 12) * 2 * Math.PI);
    const covid = (y === 2020 && m >= 2) || (y === 2021 && m < 6) ? 0.55 : 1;
    const trend = 1 + (y - 2016) * 0.03;
    const f = 14 * p.fish * (lobster + crab) * trend * (0.75 + 0.5 * rand());
    const v = 120 * p.traffic * season * covid * trend * (0.8 + 0.4 * rand());
    const lambda = v / 26;
    let n = 0;
    for (let k = 0; k < 40; k++) if (rand() < lambda / 40) n++;
    let u = 0;
    for (let k = 0; k < n; k++) if (rand() < 0.28) u++;
    fishing.push(r2(f));
    vessel.push(r2(v));
    sar.push(n);
    unmatched.push(u);
  });
  simulated.sites[s.id] = { fishingHours: fishing, vesselHours: vessel, sarDetections: sar, sarUnmatched: unmatched };
});

// ---------------------------------------------------------------- write
const meta = {
  generated: new Date().toISOString().slice(0, 10),
  sources: {
    thermal: {
      name: "NOAA Coral Reef Watch 5 km v3.1 (daily), weekly samples",
      url: "https://pae-paha.pacioos.hawaii.edu/erddap/griddap/dhw_5km",
      kind: "observed",
    },
    storms: { name: "NOAA NHC HURDAT2 Atlantic best track (2025 release)", url: "https://www.nhc.noaa.gov/data/hurdat/", kind: "observed" },
    lionfish: { name: "USGS Nonindigenous Aquatic Species database, Pterois records", url: "https://nas.er.usgs.gov/", kind: "observed" },
    ais: { name: "Simulated AIS / SAR activity (Global Fishing Watch placeholder)", url: "https://globalfishingwatch.org/", kind: "simulated" },
  },
};

const write = (name, obj) => {
  fs.writeFileSync(path.join(OUT, name), JSON.stringify(obj));
  console.log(name.padEnd(16), (fs.statSync(path.join(OUT, name)).size / 1024).toFixed(1), "KB");
};
write("sites.json", SITES);
write("thermal.json", thermal);
write("storms.json", storms);
write("lionfish.json", lionfish);
write("simulated.json", simulated);
write("meta.json", meta);

console.log("\nstorms within", MAX_KM, "km:");
for (const st of storms) {
  const lk = st.closest["looe-key"];
  console.log(`  ${st.year} ${st.name.padEnd(8)} peak ${st.peakWindKt} kt  Looe Key: ${lk.km} km @ ${lk.wind} kt  ${new Date(EPOCH + lk.t * DAY).toISOString().slice(0, 10)}`);
}
console.log("lionfish records 2016–2024:", lionfish.length);
