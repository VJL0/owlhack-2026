// Builds the flagship dossiers (src/data/flagships/*.json) and the global reef
// layer (src/data/global-reefs.json) from the raw public data in /data/raw.
//
// Every lane, event and number carries its evidence type:
//   field     divers / photo surveys        sensor    thermistors on the reef
//   satellite NOAA Coral Reef Watch         track     IBTrACS cyclone best tracks
//   reported  a program's own attribution   derived   computed here from the above
//
// The "changes" are declines between consecutive surveys. For each one the script
// lists what the other records show inside that interval. It never says which
// pressure caused a change: co-occurrence is shown as co-occurrence.
//
// Run: node scripts/build-flagships.mjs   (after fetch-flagships.mjs)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, "../../..");
const RAW = path.join(ROOT, "data/raw");
const OUT = path.resolve(here, "../src/data/flagships");
fs.mkdirSync(OUT, { recursive: true });

// ------------------------------------------------------------------ helpers
const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function decYear(iso) {
  const d = new Date(iso.length <= 10 ? `${iso}T00:00:00Z` : iso.replace(" ", "T") + (iso.endsWith("Z") ? "" : "Z"));
  const y = d.getUTCFullYear();
  const a = Date.UTC(y, 0, 1);
  return y + (d.getTime() - a) / (Date.UTC(y + 1, 0, 1) - a);
}
function fmt(t) {
  const y = Math.floor(t);
  return `${MONTHS[Math.min(11, Math.floor((t - y) * 12))]} ${y}`;
}
function readCsv(file) {
  const [head, ...lines] = fs.readFileSync(file, "utf8").replace(/\r/g, "").trim().split("\n");
  const cols = head.split(",");
  return lines.map((l) => {
    const c = l.split(",");
    return Object.fromEntries(cols.map((k, i) => [k, c[i]]));
  });
}
const json = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN);
const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : NaN;
};
const sd = (a) => {
  const m = mean(a);
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / Math.max(1, a.length - 1));
};
const groupBy = (arr, key) => {
  const m = new Map();
  for (const x of arr) {
    const k = key(x);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(x);
  }
  return m;
};
function km(lat1, lon1, lat2, lon2) {
  const r = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(a));
}
const write = (name, obj) => {
  fs.writeFileSync(path.join(OUT, name), JSON.stringify(obj));
  console.log(name.padEnd(28), (fs.statSync(path.join(OUT, name)).size / 1024).toFixed(1), "KB");
};

// ------------------------------------------------------------------ shared sources
const SOURCES = {
  crw: {
    id: "crw",
    name: "Coral Reef Watch daily 5 km v3.1: degree heating weeks, CoralTemp SST, SST anomaly",
    provider: "NOAA Coral Reef Watch (via NOAA CoastWatch ERDDAP)",
    url: "https://coralreefwatch.noaa.gov/product/5km/index.php",
    license: "Free to use with credit to NOAA Coral Reef Watch",
  },
  ibtracs: {
    id: "ibtracs",
    name: "International Best Track Archive for Climate Stewardship (IBTrACS) v04r01",
    provider: "NOAA NCEI",
    url: "https://www.ncei.noaa.gov/products/international-best-track-archive",
    license: "Public domain (cite IBTrACS v04r01)",
  },
};

// ------------------------------------------------------------------ NOAA CRW (satellite)
function crw(id) {
  const rows = readCsv(path.join(RAW, "crw", `weekly-${id}.csv`)).filter((r) => r.CRW_DHW !== "NaN" && r.CRW_DHW !== "");
  return rows.map((r) => ({ t: r3(decYear(r.time.slice(0, 10))), dhw: +r.CRW_DHW, sst: +r.CRW_SST, ssta: +r.CRW_SSTANOMALY }));
}
function dhwLane(series, t0, note) {
  const pts = series.filter((p) => p.t >= t0).map((p) => [p.t, r2(p.dhw)]);
  return {
    id: "dhw",
    label: "Heat stress",
    unit: "°C-weeks (DHW)",
    evidence: "satellite",
    source: "crw",
    kind: "continuous",
    color: "#ff8a4c",
    points: pts,
    max: Math.max(8, Math.ceil(Math.max(...pts.map((p) => p[1])) / 4) * 4),
    refs: [
      { v: 4, label: "4: significant bleaching likely" },
      { v: 8, label: "8: severe bleaching, mortality likely" },
    ],
    note,
  };
}
/** Heat-stress episodes: runs of DHW > 0 whose peak reaches 4 °C-weeks. */
function heatEvents(series, t0) {
  const out = [];
  let run = null;
  for (const p of series) {
    if (p.t < t0) continue;
    if (p.dhw > 0) {
      if (!run) run = { start: p.t, peak: p };
      if (p.dhw > run.peak.dhw) run.peak = p;
      run.end = p.t;
    } else if (run) {
      if (run.peak.dhw >= 4) out.push(run);
      run = null;
    }
  }
  if (run && run.peak.dhw >= 4) out.push(run);
  return out.map((r) => ({
    t: r.peak.t,
    t1: r.end,
    kind: "heat",
    label: `DHW ${r1(r.peak.dhw)}`,
    detail: `Satellite heat stress peaked at ${r1(r.peak.dhw)} °C-weeks in ${fmt(r.peak.t)} (${r.peak.dhw >= 8 ? "severe bleaching and mortality likely" : "significant bleaching likely"}, by NOAA's thresholds).`,
    evidence: "satellite",
    source: "crw",
  }));
}
/** Heat stress counts as present from 1 °C-week (NOAA: stress accumulating); the value says how far past 4 and 8. */
const heatPresence = (dhw) => (dhw >= 1 ? "present" : "absent");
const heatValue = (p, what = "") =>
  p.dhw > 0
    ? `${what}peak ${r1(p.dhw)} °C-weeks, ${fmt(p.t)}${p.dhw >= 8 ? " (severe level)" : p.dhw >= 4 ? " (significant-bleaching level)" : " (below NOAA's bleaching level of 4)"}`
    : `${what}no accumulated heat stress`;
/** Cyclones that matter to a reef: tropical-storm winds within 150 km, or hurricane-force winds within 350 km (swell). */
const cycloneCounts = (s) => (s.km <= 150 && (s.wind === null || s.wind >= 34)) || (s.km <= 350 && s.wind !== null && s.wind >= 64);
const maxDhwBetween = (series, t0, t1) => series.filter((p) => p.t > t0 && p.t <= t1).reduce((m, p) => (p.dhw > m.dhw ? p : m), { dhw: 0, t: t0 });

// ------------------------------------------------------------------ IBTrACS (track)
const ibtracs = (() => {
  const rows = readCsv(path.join(RAW, "ibtracs", "near-flagships.csv"));
  return [...groupBy(rows, (r) => r.SID)].map(([sid, fixes]) => ({
    sid,
    name: fixes[0].NAME === "NOT_NAMED" || fixes[0].NAME === "UNNAMED" ? "Unnamed storm" : fixes[0].NAME.charAt(0) + fixes[0].NAME.slice(1).toLowerCase(),
    season: +fixes[0].SEASON,
    fixes: fixes
      .filter((f) => f.TRACK_TYPE === "main")
      .map((f) => ({ t: decYear(f.ISO_TIME), lat: +f.LAT, lon: +f.LON, wind: +(f.USA_WIND?.trim() || f.WMO_WIND?.trim() || NaN) })),
  }));
})();
/** Storms whose track passes within maxKm of a point, with the closest approach (tracks densified to ~30 min). */
function stormsNear(lat, lon, maxKm, t0 = 0) {
  const out = [];
  for (const s of ibtracs) {
    let best = null;
    for (let i = 0; i < s.fixes.length - 1; i++) {
      const a = s.fixes[i];
      const b = s.fixes[i + 1];
      for (let f = 0; f < 1; f += 1 / 6) {
        const la = a.lat + (b.lat - a.lat) * f;
        let dlon = b.lon - a.lon;
        if (dlon > 180) dlon -= 360;
        if (dlon < -180) dlon += 360;
        const lo = a.lon + dlon * f;
        const d = km(lat, lon, la, lo);
        const w = Number.isFinite(a.wind) && Number.isFinite(b.wind) ? a.wind + (b.wind - a.wind) * f : Number.isFinite(a.wind) ? a.wind : b.wind;
        if (!best || d < best.km) best = { km: d, t: a.t + (b.t - a.t) * f, wind: w };
      }
    }
    if (best && best.km <= maxKm && best.t >= t0) {
      const peak = Math.max(...s.fixes.map((f) => f.wind).filter(Number.isFinite), 0);
      out.push({ name: s.name, sid: s.sid, t: r3(best.t), km: Math.round(best.km), wind: Number.isFinite(best.wind) ? Math.round(best.wind) : null, peak });
    }
  }
  return out.sort((a, b) => a.t - b.t);
}
const stormEvent = (s) => ({
  t: s.t,
  kind: "cyclone",
  label: s.name,
  detail: `${s.name} passed ${s.km} km away on its closest approach (${fmt(s.t)})${s.wind ? `, with sustained winds near ${s.wind} kt` : ""}. Peak intensity on its whole track: ${s.peak ? `${Math.round(s.peak)} kt` : "not recorded"}.`,
  evidence: "track",
  source: "ibtracs",
});

/** Intervals with no reading for at least minDays in a daily series (sorted ISO dates). */
function sensorGaps(dates, minDays, label, lane) {
  const out = [];
  for (let i = 1; i < dates.length; i++) {
    const a = Date.parse(dates[i - 1]);
    const b = Date.parse(dates[i]);
    const days = (b - a) / 86_400_000;
    if (days >= minDays) out.push({ t0: r3(decYear(dates[i - 1])), t1: r3(decYear(dates[i])), label: `${label}: no data for ${Math.round(days)} days`, lane });
  }
  return out;
}

/** Declines between consecutive surveys of the main lane. */
function declines(points, { minAbs, minRel }) {
  const out = [];
  for (let i = 1; i < points.length; i++) {
    const [t0, a] = points[i - 1];
    const [t1, b] = points[i];
    if (a - b >= minAbs || (a > 0 && (a - b) / a >= minRel && a - b >= 1)) out.push({ t0, t1, before: a, after: b });
  }
  return out;
}

// =================================================================== MOOREA
function buildMoorea() {
  const dir = path.join(RAW, "mcr");
  const CORAL_T = 0.29; // photoquadrats every April
  const FISH_T = 0.58; // fish and COTS transects in late July / early August
  const heat = crw("moorea");

  // ---- coral and macroalgae cover (photoquadrats). Island mean of the six site means.
  const coral = readCsv(path.join(dir, "coral_wide.csv"));
  const cols = Object.keys(coral[0]);
  const NON_CORAL = new Set(["Date", "Location", "Sand", "CTB", "Non_Coralline_Crustose_Algae", "Soft_Coral", "Macroalgae", "Millepora", "Unknown_or_Other"]);
  const coralCols = cols.filter((c) => !NON_CORAL.has(c));
  const HABITATS = [
    { key: "Outer 10 m", label: "Outer reef, 10 m" },
    { key: "Outer 17 m", label: "Outer reef, 17 m" },
    { key: "Fringing Reef", label: "Fringing reef" },
  ];
  const quads = coral.map((r) => {
    const m = r.Location.match(/^(LTER \d) (Fringing Reef|Outer 10 m|Outer 17 m)/);
    const num = (v) => (v === "" || v === "ND" || v === undefined ? 0 : +v);
    return { year: +r.Date, site: m?.[1], hab: m?.[2], coral: coralCols.reduce((s, c) => s + num(r[c]), 0), macro: num(r.Macroalgae) };
  });
  const coverSeries = (hab, field) => {
    const pts = [];
    for (const [year, rows] of [...groupBy(quads.filter((q) => q.hab === hab), (q) => q.year)].sort((a, b) => a[0] - b[0])) {
      const siteMeans = [...groupBy(rows, (q) => q.site).values()].map((qs) => mean(qs.map((q) => q[field])));
      const m = mean(siteMeans);
      const se = sd(siteMeans) / Math.sqrt(siteMeans.length);
      pts.push([r3(year + CORAL_T), r1(m), r1(Math.max(0, m - 1.96 * se)), r1(m + 1.96 * se)]);
    }
    return pts;
  };
  const coral10 = coverSeries("Outer 10 m", "coral");
  const coralLane = {
    id: "coral",
    label: "Live coral cover",
    unit: "% of the reef",
    evidence: "field",
    source: "mcr-coral",
    kind: "survey",
    color: "#ff7a6b",
    points: coral10,
    others: HABITATS.slice(1).map((h) => ({ label: h.label, points: coverSeries(h.key, "coral").map((p) => [p[0], p[1]]) })),
    max: 70,
    note: "Outer reef at 10 m: mean of six sites, 40 photoquadrats each, every April. Band: 95% interval across sites.",
  };
  const macroLane = {
    id: "macroalgae",
    label: "Macroalgae",
    unit: "% of the reef",
    evidence: "field",
    source: "mcr-coral",
    kind: "survey",
    color: "#9bd46a",
    points: coverSeries("Outer 10 m", "macro"),
    others: HABITATS.slice(1).map((h) => ({ label: h.label, points: coverSeries(h.key, "macro").map((p) => [p[0], p[1]]) })),
    max: 35,
    note: "Same photoquadrats as coral cover. Seaweed can take space that dead coral leaves.",
  };

  // ---- crown-of-thorns starfish (counts on 24 permanent 5 x 50 m transects per habitat)
  const cots = readCsv(path.join(dir, "cots.csv"));
  const cotsBy = (hab) =>
    [...groupBy(cots.filter((r) => r.Habitat === hab), (r) => +r.Year)].sort((a, b) => a[0] - b[0]).map(([y, rs]) => [r3(y + FISH_T), rs.reduce((s, r) => s + +r.COTS, 0)]);
  const cotsFore = cotsBy("Forereef");
  const cotsLane = {
    id: "cots",
    label: "Crown-of-thorns starfish",
    unit: "counted on 24 transects",
    evidence: "field",
    source: "mcr-cots",
    kind: "count",
    color: "#c792ea",
    points: cotsFore,
    others: [
      { label: "Backreef", points: cotsBy("Backreef") },
      { label: "Fringing reef", points: cotsBy("Fringing") },
    ],
    max: Math.max(...cotsFore.map((p) => p[1])),
    note: "Forereef (about 12 m): starfish counted on 24 permanent 50 x 5 m transects (6,000 m²), each July or August.",
  };

  // ---- herbivorous fish (Primary Consumer) biomass density, g per m²
  const fish = readCsv(path.join(dir, "fish_biomass_transect.csv"));
  const transects = readCsv(path.join(dir, "fish_transects.csv"));
  const herbBy = (hab) => {
    const pts = [];
    for (const [y, trs] of [...groupBy(transects.filter((t) => t.habitat === hab), (t) => +t.year)].sort((a, b) => a[0] - b[0])) {
      const vals = trs.map((t) => {
        const f = fish.find((r) => r.year === t.year && r.habitat === hab && r.site === t.site && r.transect === t.transect && r.trophic === "Primary Consumer");
        return f ? +f.biomass_g_m2 : 0;
      });
      const m = mean(vals);
      const se = sd(vals) / Math.sqrt(vals.length);
      pts.push([r3(y + FISH_T), r1(m), r1(Math.max(0, m - 1.96 * se)), r1(m + 1.96 * se)]);
    }
    return pts;
  };
  const herbFore = herbBy("Forereef");
  const herbLane = {
    id: "herbivores",
    label: "Herbivorous fish",
    unit: "g per m²",
    evidence: "field",
    source: "mcr-fish",
    kind: "survey",
    color: "#5ad1c4",
    points: herbFore,
    others: [
      { label: "Backreef", points: herbBy("Backreef").map((p) => [p[0], p[1]]) },
      { label: "Fringing reef", points: herbBy("Fringing").map((p) => [p[0], p[1]]) },
    ],
    max: Math.ceil(Math.max(...herbFore.map((p) => p[3])) / 10) * 10,
    note: "Forereef biomass of grazing fishes (the survey's 'primary consumers'), from lengths and counts on the same 24 transects. From 2006; 2005 used a different method.",
  };

  // ---- reef temperature: bottom thermistors, weekly means of daily means
  const therm = (file, hab, depth) => readCsv(path.join(dir, file)).filter((r) => r.habitat === hab && r.depth_m === String(depth));
  const lter0 = therm("thermistor_daily_lter_0.csv", "Forereef", 10);
  const lter2 = therm("thermistor_daily_lter_2.csv", "Forereef", 10);
  const weekly = (rows) => {
    const byWeek = groupBy(rows, (r) => Math.floor(Date.parse(r.date) / (7 * 86_400_000)));
    return [...byWeek].sort((a, b) => a[0] - b[0]).map(([, rs]) => [r3(decYear(rs[Math.floor(rs.length / 2)].date)), r2(mean(rs.map((r) => +r.mean_c)))]);
  };
  const tempLane = {
    id: "reef-temp",
    label: "Water temperature on the reef",
    unit: "°C at 10 m",
    evidence: "sensor",
    source: "mcr-thermistor",
    kind: "continuous",
    color: "#64d2ff",
    points: weekly(lter0),
    others: [{ label: "Site LTER 2, 10 m", points: weekly(lter2) }],
    max: 31,
    note: "Bottom-mounted thermistor at LTER 0 on the north-shore forereef, 10 m deep, logging every few minutes. Weekly means.",
  };
  // the lane's own floor: temperatures live in a narrow band
  tempLane.min = 25.5;

  // On-reef heat stress, NOAA's method applied to the thermistor itself: the site's
  // maximum monthly mean (MMM) from 2005–2012, daily HotSpots of at least 1 °C,
  // summed over 12 weeks. Derived here; compared with the satellite on the DHW lane.
  const monthly = groupBy(lter0.filter((r) => r.date >= "2005" && r.date < "2013"), (r) => r.date.slice(5, 7));
  const MMM = Math.max(...[...monthly.values()].map((rs) => mean(rs.map((r) => +r.mean_c))));
  const byDate = new Map(lter0.map((r) => [r.date, +r.mean_c]));
  const insitu = [];
  {
    const DAY = 86_400_000;
    const first = Date.parse(lter0[0].date);
    const last = Date.parse(lter0.at(-1).date);
    const hs = [];
    for (let ms = first; ms <= last; ms += DAY) {
      const v = byDate.get(new Date(ms).toISOString().slice(0, 10));
      hs.push(v === undefined ? null : v - MMM);
    }
    for (let i = 0; i < hs.length; i += 7) {
      let sum = 0;
      let seen = 0;
      for (let k = Math.max(0, i - 83); k <= i; k++) {
        if (hs[k] === null) continue;
        seen++;
        if (hs[k] >= 1) sum += hs[k];
      }
      if (seen >= 60 && hs[i] !== null) insitu.push([r3(decYear(new Date(first + i * DAY).toISOString().slice(0, 10))), r2(sum / 7)]);
    }
  }
  const insituBetween = (t0, t1) => insitu.filter((p) => p[0] > t0 && p[0] <= t1).reduce((m, p) => (p[1] > m.dhw ? { t: p[0], dhw: p[1] } : m), { t: t0, dhw: 0 });
  const insituCoverage = (t0, t1) => insitu.filter((p) => p[0] > t0 && p[0] <= t1).length / Math.max(1, (t1 - t0) * 52);

  const gaps = [
    ...sensorGaps(lter0.map((r) => r.date), 21, "LTER 0 thermistor, 10 m", "reef-temp"),
    ...sensorGaps(lter2.map((r) => r.date), 21, "LTER 2 thermistor, 10 m", "reef-temp"),
  ];
  const lastTherm = lter0.at(-1).date;
  gaps.push({ t0: r3(decYear(lastTherm)), t1: r3(decYear("2025-05-30")), label: `Thermistor record published to ${lastTherm}`, lane: "reef-temp" });

  const lat = -17.48, lon = -149.82;
  const storms = stormsNear(-17.53, -149.83, 400, 2005).filter(cycloneCounts);
  const events = [...heatEvents(heat, 2005), ...storms.map(stormEvent)].sort((a, b) => a.t - b.t);

  // ---- changes: declines in outer-reef coral cover between consecutive April surveys
  const changes = declines(coral10.map((p) => [p[0], p[1]]), { minAbs: 3, minRel: 0.3 }).map((d) => {
    const y0 = Math.round(d.t0 - CORAL_T);
    const heatPeak = maxDhwBetween(heat, d.t0, d.t1);
    const reefPeak = insituBetween(d.t0, d.t1);
    const coverage = insituCoverage(d.t0, d.t1);
    const cotsCount = cotsFore.find((p) => Math.round(p[0] - FISH_T) === y0)?.[1];
    const herb = herbFore.find((p) => Math.round(p[0] - FISH_T) === y0)?.[1];
    const herbMedian = median(herbFore.map((p) => p[1]));
    const macro0 = macroLane.points.find((p) => p[0] === d.t0)?.[1];
    const macro1 = macroLane.points.find((p) => p[0] === d.t1)?.[1];
    const near = storms.filter((s) => s.t > d.t0 && s.t <= d.t1);
    const drivers = [
      {
        driver: "Heat stress (satellite)",
        presence: heatPresence(heatPeak.dhw),
        value: heatValue(heatPeak),
        evidence: "satellite",
        source: "crw",
      },
      {
        driver: "Heat stress on the reef",
        presence: coverage < 0.5 ? "not measured" : heatPresence(reefPeak.dhw),
        value: coverage < 0.5 ? `the 10 m thermistor covers ${Math.round(coverage * 100)}% of this interval` : heatValue(reefPeak, "thermistor at 10 m: "),
        evidence: "derived",
        source: "mcr-thermistor",
      },
      {
        driver: "Crown-of-thorns starfish",
        presence: cotsCount === undefined ? "not measured" : cotsCount >= 5 ? "present" : "absent",
        // 5 or more on 24 transects: above the 0–2 of quiet years
        value: cotsCount === undefined ? "no count" : `${cotsCount} counted on the forereef, Aug ${y0}`,
        evidence: "field",
        source: "mcr-cots",
      },
      {
        driver: "Cyclone",
        presence: near.length ? "present" : "absent",
        value: near.length ? near.map((s) => `${s.name}, ${s.km} km away at ${s.wind ?? "?"} kt, ${fmt(s.t)}`).join("; ") : "none close or strong enough",
        evidence: "track",
        source: "ibtracs",
      },
      {
        driver: "Fewer grazing fish",
        presence: herb === undefined ? "not measured" : herb < 0.75 * herbMedian ? "present" : "absent",
        value: herb === undefined ? "no fish survey" : `${herb} g/m² in Aug ${y0} (series median ${r1(herbMedian)})`,
        evidence: "field",
        source: "mcr-fish",
      },
      {
        driver: "Seaweed taking space",
        presence: macro0 === undefined || macro1 === undefined ? "not measured" : macro1 - macro0 >= 3 ? "present" : "absent",
        value: macro0 === undefined ? "no survey" : `macroalgae ${macro0}% → ${macro1}%`,
        evidence: "field",
        source: "mcr-coral",
      },
    ];
    const present = drivers.filter((x) => x.presence === "present").map((x) => x.driver.toLowerCase());
    return {
      id: `coral-${y0}`,
      t0: d.t0,
      t1: d.t1,
      metric: "coral",
      before: d.before,
      after: d.after,
      unit: "%",
      title: `${y0} → ${y0 + 1}: coral ${d.before}% → ${d.after}%`,
      summary: `Between the April ${y0} and April ${y0 + 1} surveys, live coral on the outer reef at 10 m went from ${d.before}% to ${d.after}%. ${
        present.length ? `Also in that interval: ${present.join(", ")}.` : "No measured pressure crossed its threshold in that interval."
      }`,
      drivers,
    };
  });

  // ---- 2019 bleaching plots (TagLab segmentation of co-registered orthomosaics)
  const colonies = readCsv(path.join(dir, "bleaching2019_colonies.csv"));
  const plots = {};
  for (const r of colonies) {
    const plot = (r["Image name"].match(/Plot\d+/) || [])[0];
    if (!plot) continue;
    const year = r.Date.slice(0, 4);
    plots[plot] ??= { "2018": [], "2019": [] };
    const area = +r["Planar area"]; // cm²
    plots[plot][year].push([Math.round(+r["Centroid x"]), Math.round(+r["Centroid y"]), r1(area), r["Class name"] === "Pocillopora_dead" ? 1 : 0]);
  }
  const plotSummary = Object.entries(plots)
    .sort()
    .map(([id, yrs]) => {
      const sum = (arr, dead) => r2(arr.filter((c) => c[3] === dead).reduce((s, c) => s + c[2], 0) / 1e4);
      return { id, live2018: sum(yrs["2018"], 0), dead2018: sum(yrs["2018"], 1), live2019: sum(yrs["2019"], 0), dead2019: sum(yrs["2019"], 1), n2018: yrs["2018"].length, n2019: yrs["2019"].length };
    });
  write("moorea-bleaching2019.json", { plots, summary: plotSummary });

  // ---- island-wide lagoon thermistor network (2021 onward): weekly means per sensor
  const lagoonSites = readCsv(path.join(dir, "lagoon_sites.csv")).map((r) => ({ id: r.site, lat: +r.lat, lon: +r.lon }));
  const lagoonRows = readCsv(path.join(dir, "lagoon_daily.csv"));
  const weeks = [...new Set(lagoonRows.map((r) => Math.floor(Date.parse(r.date) / (7 * 86_400_000))))].sort((a, b) => a - b);
  const wIndex = new Map(weeks.map((w, i) => [w, i]));
  const grid = Object.fromEntries(lagoonSites.map((s) => [s.id, new Array(weeks.length).fill(null)]));
  const acc = new Map();
  for (const r of lagoonRows) {
    const k = `${r.site}|${wIndex.get(Math.floor(Date.parse(r.date) / (7 * 86_400_000)))}`;
    const a = acc.get(k) ?? [0, 0];
    a[0] += +r.max_c;
    a[1]++;
    acc.set(k, a);
  }
  for (const [k, [s, n]] of acc) {
    const [site, wi] = k.split("|");
    if (grid[site]) grid[site][+wi] = r2(s / n);
  }
  write("moorea-lagoon.json", {
    note: "Weekly mean of each sensor's daily maximum temperature (°C), bottom-mounted thermistors logging every 2 minutes.",
    weeks: weeks.map((w) => r3(decYear(new Date(w * 7 * 86_400_000 + 3.5 * 86_400_000).toISOString().slice(0, 10)))),
    sites: lagoonSites,
    temps: grid,
  });

  const peak2019 = maxDhwBetween(heat, 2019, 2019.9);
  const reef2019 = insituBetween(2019, 2019.9);
  const dossier = {
    id: "moorea",
    name: "Moorea",
    place: "Society Islands, French Polynesia",
    lat,
    lon,
    role: "Understand the past",
    question: "What happened between surveys, and which pressures were there when coral disappeared?",
    summary: `Twenty-one years of coral, fish and starfish surveys at the same permanent sites, with thermistors on the reef itself. Outer-reef coral at 10 m fell from ${coral10.find((p) => Math.round(p[0]) === 2007)[1]}% (2007) to ${coral10.find((p) => Math.round(p[0]) === 2010)[1]}% (2010) while divers counted starfish, recovered to ${coral10.find((p) => Math.round(p[0]) === 2019)[1]}% by 2019, and was ${coral10.find((p) => Math.round(p[0]) === 2020)[1]}% a year later. In between, the reef's own thermistor recorded ${r1(reef2019.dhw)} °C-weeks of heat stress, the only time since 2005 it passed NOAA's bleaching level (the satellite pixel shows ${r1(peak2019.dhw)}). By April 2025 cover was ${coral10.at(-1)[1]}%.`,
    span: [2005, 2026.8],
    stats: [
      { value: String(coral10.length), label: "April coral surveys" },
      { value: String(cotsFore.length), label: "starfish and fish surveys" },
      { value: "2005", label: "reef thermistors since" },
      { value: String(lagoonSites.length), label: "lagoon sensors since 2021" },
    ],
    lanes: [
      coralLane,
      cotsLane,
      herbLane,
      macroLane,
      {
        ...dhwLane(heat, 2005, `NOAA Coral Reef Watch 5 km pixel on the north shore (satellite). Faint line: the same measure computed from the 10 m thermistor on the reef (derived; its warmest-month mean is ${MMM.toFixed(2)} °C).`),
        others: [{ label: "On the reef: thermistor at 10 m, NOAA method (derived)", points: insitu }],
      },
      tempLane,
    ],
    events,
    gaps,
    surveys: [
      ...coral10.map((p) => ({ t: p[0], label: `Coral photoquadrats, Apr ${Math.round(p[0] - CORAL_T)}` })),
      ...cotsFore.map((p) => ({ t: p[0], label: `Fish and starfish transects, Aug ${Math.round(p[0] - FISH_T)}` })),
    ],
    changes,
    missing: [
      { title: "No survey between April and April", detail: "Coral is photographed once a year. A loss that shows up in April happened somewhere in the previous 12 months; the satellite and thermistor records narrow down when." },
      { title: "The 2019 bleaching imagery is not public", detail: "The co-registered orthomosaics behind the 2019 bleaching study are not in the data package; only the colony outlines segmented from them are (shown below)." },
      { title: "Thermistor record ends mid-2024", detail: `The published forereef thermistor series stops on ${lastTherm}, so the 2024–2025 decline has satellite heat data but no on-reef temperature yet.` },
      { title: "No fishing effort data", detail: "Global Fishing Watch needs an API token that this build does not have, and AIS misses most small-boat reef fishing. Herbivore biomass from the fish transects is the closest field evidence." },
    ],
    next: [],
    points: [
      { id: "LTER 1", name: "LTER 1", lat: -17.479, lon: -149.838, kind: "site", note: "North shore; the LTER 0 thermistor is here" },
      { id: "LTER 2", name: "LTER 2", lat: -17.474, lon: -149.804, kind: "site", note: "North shore" },
      { id: "LTER 3", name: "LTER 3", lat: -17.512, lon: -149.761, kind: "site", note: "Southeast shore" },
      { id: "LTER 4", name: "LTER 4", lat: -17.542, lon: -149.767, kind: "site", note: "Southeast shore" },
      { id: "LTER 5", name: "LTER 5", lat: -17.580, lon: -149.872, kind: "site", note: "Southwest shore" },
      { id: "LTER 6", name: "LTER 6", lat: -17.518, lon: -149.923, kind: "site", note: "Southwest shore" },
    ],
    sources: [
      { id: "mcr-coral", name: "Long-term population and community dynamics: corals (knb-lter-mcr.4.44)", provider: "Moorea Coral Reef LTER, P. Edmunds", url: "https://portal.edirepository.org/nis/mapbrowse?scope=knb-lter-mcr&identifier=4&revision=44", license: "CC BY 4.0" },
      { id: "mcr-fish", name: "Long-term population and community dynamics: fishes (knb-lter-mcr.6.65)", provider: "Moorea Coral Reef LTER, A. Brooks", url: "https://portal.edirepository.org/nis/mapbrowse?scope=knb-lter-mcr&identifier=6&revision=65", license: "CC BY 4.0" },
      { id: "mcr-cots", name: "Long-term population dynamics of Acanthaster planci (knb-lter-mcr.1039.13)", provider: "Moorea Coral Reef LTER", url: "https://portal.edirepository.org/nis/mapbrowse?scope=knb-lter-mcr&identifier=1039&revision=13", license: "CC BY 4.0" },
      { id: "mcr-thermistor", name: "Benthic water temperature (knb-lter-mcr.1035.18) and island-wide lagoon temperature (knb-lter-mcr.1045.7)", provider: "Moorea Coral Reef LTER, J. Leichter", url: "https://portal.edirepository.org/nis/mapbrowse?scope=knb-lter-mcr&identifier=1035&revision=18", license: "CC BY 4.0" },
      { id: "mcr-bleaching", name: "Quantifying 2019 coral bleaching; data for Kopecky et al. 2023 (knb-lter-mcr.5050.1)", provider: "Moorea Coral Reef LTER, K. Kopecky", url: "https://doi.org/10.3390/rs15164077", license: "CC BY 4.0" },
      SOURCES.crw,
      SOURCES.ibtracs,
    ],
    extras: { bleaching2019: plotSummary, lagoonSensors: lagoonSites.length, lastThermistor: lastTherm, mmm: r2(MMM) },
  };
  // Where to look next: the most recent evidence and what it leaves open.
  const lastCoral = coral10.at(-1);
  const lastHeat = heat.at(-1);
  const heatSince = maxDhwBetween(heat, lastCoral[0], lastHeat.t);
  dossier.next = [
    {
      title: `Last coral survey: ${fmt(lastCoral[0])}, ${lastCoral[1]}% on the outer reef`,
      detail:
        heatSince.dhw > 0
          ? `Since then satellite heat stress has peaked at ${r1(heatSince.dhw)} °C-weeks (${fmt(heatSince.t)}); the latest weekly value is ${r1(lastHeat.dhw)} (${fmt(lastHeat.t)}).`
          : `The satellite shows no accumulated heat stress since then (to ${fmt(lastHeat.t)}). The next April survey will say whether anything is left to recover from.`,
      evidence: "satellite",
    },
    {
      title: `Starfish came back: ${cotsFore.slice(-3).map((p) => p[1]).join(", ")} on the forereef in ${cotsFore.slice(-3).map((p) => Math.round(p[0] - FISH_T)).join(", ")}`,
      detail: "Counts on the same 24 transects that saw 108 in 2008. The second outbreak overlapped the 2023–2025 decline; the fringing reef counts rose in 2025.",
      evidence: "field",
    },
  ];
  write("moorea.json", dossier);
  return dossier;
}

// =================================================================== LIZARD ISLAND
function buildLizard() {
  const dir = path.join(RAW, "aims");
  const heat = crw("lizard-island");
  const manta = json(path.join(dir, "lizard_manta.json")).sort((a, b) => +a.date - +b.date);
  const photo = json(path.join(dir, "lizard_photo_transect.json"));
  const juvenile = json(path.join(dir, "lizard_juvenile.json"));
  const cots = json(path.join(dir, "lizard_cots.json")).sort((a, b) => +a.survey_date - +b.survey_date);
  const dist = json(path.join(dir, "lizard_disturbance.json"));
  const sites = json(path.join(dir, "lizard_sites.json"));

  const hc = manta.map((m) => [r3(+m.date), r1(m.mean * 100), r1(m.lower * 100), r1(m.upper * 100)]);
  const photoHc = photo
    .filter((p) => p.purpose === "GROUP_LEVEL" && p.variable === "HARD CORAL")
    .sort((a, b) => +a.date - +b.date)
    .map((p) => [r3(+p.date), r1(p.mean * 100), r1(p.lower * 100), r1(p.upper * 100)]);
  const coralLane = {
    id: "coral",
    label: "Hard coral cover",
    unit: "% of the reef",
    evidence: "field",
    source: "aims-ltmp",
    kind: "survey",
    color: "#ff7a6b",
    points: hc,
    others: [{ label: "Fixed sites, photo transects at 9 m", points: photoHc.map((p) => [p[0], p[1]]) }],
    max: 40,
    note: "Manta tow around the whole reef perimeter (AIMS Long-Term Monitoring Program), with its 95% interval. Faint line: the three fixed 9 m sites, photographed on transects.",
  };
  const cotsPts = cots.map((c) => [r3(+c.survey_date), +c.cotsptow]);
  const cotsLane = {
    id: "cots",
    label: "Crown-of-thorns starfish",
    unit: "per manta tow",
    evidence: "field",
    source: "aims-ltmp",
    kind: "count",
    color: "#c792ea",
    points: cotsPts,
    max: Math.max(...cotsPts.map((p) => p[1])),
    note: "Starfish seen per two-minute manta tow around the reef, same surveys as coral cover.",
  };
  const juv = juvenile
    .filter((j) => j.purpose === "GROUP_LEVEL" && j.variable === "ABUNDANCE")
    .sort((a, b) => +a.date - +b.date)
    .map((j) => [r3(+j.date), r1(j.mean), r1(j.lower), r1(j.upper)]);
  const juvLane = {
    id: "juvenile",
    label: "Juvenile corals",
    unit: "per m²",
    evidence: "field",
    source: "aims-ltmp",
    kind: "survey",
    color: "#ffd166",
    points: juv,
    max: Math.ceil(Math.max(...juv.map((p) => p[3])) / 10) * 10,
    note: "Young colonies counted at the fixed 9 m sites: the reef's capacity to recover.",
  };

  const CODE = { s: "storm", c: "cots", b: "bleaching", m: "multiple", u: "unknown", d: "unknown" };
  const reported = dist
    .filter((d) => d.sample_type === "MANTA")
    .map((d) => ({
      t: r3(+d.ddate),
      kind: CODE[d.disturbance] ?? "unknown",
      year: d.year,
      label: d.disturbance === "u" ? "Cause unknown" : d.tooltip.charAt(0).toUpperCase() + d.tooltip.slice(1),
      detail: `AIMS attributes the ${d.year} change to: ${d.tooltip}. Survey note: “${d.description.trim()}”.`,
      evidence: "reported",
      source: "aims-ltmp",
    }));
  const storms = stormsNear(-14.67, 145.46, 400, 1985).filter(cycloneCounts);
  const events = [...heatEvents(heat, 2002), ...storms.map(stormEvent), ...reported].sort((a, b) => a.t - b.t);
  // AIMS labels each survey (and each attribution) by report year.
  const reportYear = new Map(manta.map((m) => [r3(+m.date), m.report_year]));

  // Survey gaps: stretches of more than 18 months between manta surveys.
  const gaps = [];
  for (let i = 1; i < hc.length; i++) {
    const dt = hc[i][0] - hc[i - 1][0];
    if (dt > 1.5) gaps.push({ t0: hc[i - 1][0], t1: hc[i][0], label: `No survey for ${r1(dt)} years`, lane: "coral" });
  }
  gaps.push({ t0: 1985, t1: 2002, label: "Satellite heat stress not shown before 2002 (licence of the SST source)", lane: "dhw" });

  const changes = declines(hc.map((p) => [p[0], p[1]]), { minAbs: 3, minRel: 0.3 }).map((d) => {
    const heatPeak = d.t1 < 2002 ? null : maxDhwBetween(heat, d.t0, d.t1);
    const c0 = cotsPts.find((p) => p[0] === d.t0)?.[1];
    const c1 = cotsPts.find((p) => p[0] === d.t1)?.[1];
    const near = storms.filter((s) => s.t > d.t0 && s.t <= d.t1);
    const ry = reportYear.get(d.t1);
    const rep = reported.filter((r) => r.year === ry);
    const drivers = [
      {
        driver: "Heat stress (satellite)",
        presence: heatPeak === null ? "not measured" : heatPresence(heatPeak.dhw),
        value: heatPeak === null ? "before the satellite record used here (2002)" : heatValue(heatPeak),
        evidence: "satellite",
        source: "crw",
      },
      {
        driver: "Crown-of-thorns starfish",
        presence: c0 === undefined ? "not measured" : Math.max(c0, c1 ?? 0) >= 0.22 ? "present" : "absent",
        value: `${c0 ?? "?"} → ${c1 ?? "?"} per tow`,
        evidence: "field",
        source: "aims-ltmp",
      },
      {
        driver: "Cyclone",
        presence: near.length ? "present" : "absent",
        value: near.length ? near.map((s) => `${s.name}, ${s.km} km away at ${s.wind ?? "?"} kt, ${fmt(s.t)}`).join("; ") : "none close or strong enough",
        evidence: "track",
        source: "ibtracs",
      },
      {
        driver: "Cause reported by AIMS",
        presence: rep.some((r) => r.kind !== "unknown") ? "present" : "not measured",
        value: rep.length ? (rep.every((r) => r.kind === "unknown") ? "AIMS logged the cause as unknown" : rep.map((r) => r.label).join("; ")) : "no attribution in the disturbance log",
        evidence: "reported",
        source: "aims-ltmp",
      },
    ];
    const y1 = Math.floor(d.t1);
    const present = drivers.filter((x) => x.presence === "present" && x.driver !== "Cause reported by AIMS").map((x) => x.driver.toLowerCase());
    return {
      id: `coral-${y1}`,
      t0: d.t0,
      t1: d.t1,
      metric: "coral",
      before: d.before,
      after: d.after,
      unit: "%",
      title: `${Math.floor(d.t0)} → ${y1}: coral ${d.before}% → ${d.after}%`,
      summary: `Between the ${fmt(d.t0)} and ${fmt(d.t1)} surveys, reef-wide hard coral went from ${d.before}% to ${d.after}%${d.t1 - d.t0 > 1.5 ? `, with ${r1(d.t1 - d.t0)} years between the two looks` : ""}. ${
        present.length ? `Measured in that interval: ${present.join(", ")}.` : "No measured pressure crossed its threshold in that interval."
      }${rep.length ? ` AIMS's own log: ${rep.map((r) => r.label.toLowerCase()).join("; ")}.` : ""}`,
      drivers,
    };
  });

  const lastSurvey = hc.at(-1);
  const lastHeat = heat.at(-1);
  const heatSince = maxDhwBetween(heat, lastSurvey[0], lastHeat.t);
  const dossier = {
    id: "lizard-island",
    name: "Lizard Island",
    place: "Northern Great Barrier Reef, Australia",
    lat: -14.67,
    lon: 145.46,
    role: "Detect what's happening",
    question: "When heat, starfish and cyclones overlap, which one was there, and what did the surveys miss?",
    summary: `Forty years of AIMS surveys at one reef. Coral has been knocked down by starfish outbreaks (1995–1998, 2013), cyclones (Ita 2014, Nathan 2015) and heat (2016, 2024), and has recovered each time. From 2011 to 2021 the reef was surveyed every second year: Cyclone Nathan (March 2015) and the 2016 bleaching both happened inside one gap, between the December 2014 and December 2016 surveys.`,
    span: [1985, 2026.8],
    stats: [
      { value: String(hc.length), label: "reef-wide coral surveys since 1985" },
      { value: String(gaps.filter((g) => g.lane === "coral").length), label: "gaps longer than 18 months" },
      { value: String(storms.length), label: "cyclones close or strong enough to matter" },
      { value: String(reported.length), label: "changes attributed by AIMS" },
    ],
    lanes: [coralLane, cotsLane, juvLane, dhwLane(heat, 2002, "NOAA Coral Reef Watch 5 km pixel at Lizard Island. Shown from 2002 only.")],
    events,
    gaps,
    surveys: hc.map((p) => ({ t: p[0], label: `AIMS manta tow survey, ${fmt(p[0])}` })),
    changes,
    missing: [
      { title: "Biennial surveys from 2011 to 2021", detail: "AIMS visited this reef every second year in that decade. Cyclone Nathan (2015) and the 2016 bleaching both happened between looks." },
      { title: "Reef temperature loggers not wired", detail: "AIMS has decades of in-water temperature at Lizard Island, but its data API needs a key this build does not have. Heat here comes from satellite only." },
      { title: "One drop AIMS itself flags as uncertain", detail: "The disturbance log marks some declines as 'unknown' and one 2024 photo-transect drop as possibly erroneous. These are shown as reported, not explained away." },
      { title: "Starfish eDNA and 3D colony models not integrated yet", detail: "AIMS's COTS eDNA trial and the St Andrews 2018–2022 colony meshes (CC BY 4.0) exist, but the meshes sit behind a browser check that scripts cannot pass." },
    ],
    next: [
      {
        title: `Last AIMS survey: ${fmt(lastSurvey[0])}, ${lastSurvey[1]}% hard coral`,
        detail: `Since then satellite heat stress has peaked at ${r1(heatSince.dhw)} °C-weeks (${fmt(heatSince.t)}); latest weekly value ${r1(lastHeat.dhw)} (${fmt(lastHeat.t)}).`,
        evidence: "satellite",
      },
    ],
    points: sites
      .filter((s) => s.reef_zone === "Fixed sites surveys")
      .map((s) => ({ id: `site-${s.site_no}`, name: `Site ${s.site_no}`, lat: +s.latitude, lon: +s.longitude, kind: "site", note: "AIMS fixed photo-transect site, 9 m" })),
    sources: [
      { id: "aims-ltmp", name: "AIMS Long-Term Monitoring Program: manta tow, photo transects, juvenile corals, COTS, disturbances (doi:10.25845/5c09bc4ff315c)", provider: "Australian Institute of Marine Science", url: "https://apps.aims.gov.au/reef-monitoring/reef/lizard%20isles/manta", license: "CC BY 4.0" },
      SOURCES.crw,
      SOURCES.ibtracs,
    ],
    extras: { disturbances: dist.map((d) => ({ year: d.year, type: d.sample_type, code: d.disturbance, tooltip: d.tooltip, description: d.description.trim() })) },
  };
  write("lizard-island.json", dossier);
  return dossier;
}

// =================================================================== SONEVA FUSHI
function buildSoneva() {
  const meta = json(path.join(RAW, "soneva", "metadata.json"));
  const splats = json(path.join(OUT, "soneva-splats.json"));
  const change = fs.existsSync(path.join(OUT, "soneva-change.json")) ? json(path.join(OUT, "soneva-change.json")) : null;
  const heat = crw("soneva-fushi");
  const PLOT_NAMES = { hb: "Host Beach reef flat", ootbm: "OOTB M crest", ootbr: "OOTB R", ootsl1: "OOTS L slope", ootsr2: "OOTS R flat", ootsr3: "OOTS R gully" };
  const SHORT = { hb: "HB", ootbm: "OOTB M", ootbr: "OOTB R", ootsl1: "OOTS L", ootsr2: "OOTS R2", ootsr3: "OOTS R3" };
  const surveys = Object.entries(meta).map(([k, v]) => ({ key: k, plot: k.split("_")[2], date: v.capture_date, t: r3(decYear(v.capture_date)), images: v.raw.img_count, site: v.site, notes: v.notes, corner: v.corners?.[0], depths: Object.values(v.scalebar_depth_m ?? {}) }));
  const byPlot = groupBy(surveys, (s) => s.plot);
  const points = [];
  const badCoords = [];
  for (const [plot, list] of byPlot) {
    const c = list[0].corner;
    if (!c || Math.abs(c.lat - c.lon) < 1e-9 || c.lon < 70) {
      badCoords.push(plot);
      continue;
    }
    points.push({ id: plot, name: SHORT[plot] ?? plot, lat: c.lat, lon: c.lon, kind: "plot", note: list[0].notes });
  }
  const events = [
    ...heatEvents(heat, 2024),
    ...stormsNear(5.11, 73.07, 400, 2023).filter(cycloneCounts).map(stormEvent),
    ...surveys.map((s) => ({
      t: s.t,
      kind: "survey",
      label: `${SHORT[s.plot] ?? s.plot} survey`,
      detail: `${PLOT_NAMES[s.plot] ?? s.plot}: ${s.images} photos on ${s.date}, rebuilt in 3D.`,
      evidence: "field",
      source: "soneva",
    })),
  ].sort((a, b) => a.t - b.t);
  const lastHeat = heat.at(-1);
  const dossier = {
    id: "soneva-fushi",
    name: "Soneva Fushi",
    place: "Baa Atoll, Maldives",
    lat: 5.112,
    lon: 73.075,
    role: "See the change",
    question: "What does the same patch of reef look like, survey after survey, in real 3D?",
    summary: `${surveys.length} photogrammetry surveys of ${byPlot.size} plots on one house reef, June 2025 to March 2026, reconstructed as Gaussian splats and co-registered so each colony stays in place across dates. The record is short, so the question here is what can be seen in 3D and what counts as change rather than noise.`,
    span: [2024, 2026.8],
    stats: [
      { value: String(surveys.length), label: "3D surveys" },
      { value: String(byPlot.size), label: "reef plots" },
      { value: String(surveys.reduce((s, x) => s + x.images, 0).toLocaleString("en-US")), label: "underwater photos" },
      { value: "0.5 mm", label: "orthomosaic pixel" },
    ],
    lanes: [
      dhwLane(heat, 2024, "NOAA Coral Reef Watch 5 km pixel next to Soneva Fushi."),
      {
        id: "ssta",
        label: "Sea surface temperature anomaly",
        unit: "°C vs normal",
        evidence: "satellite",
        source: "crw",
        kind: "continuous",
        color: "#64d2ff",
        points: heat.filter((p) => p.t >= 2024).map((p) => [p.t, r2(p.ssta)]),
        max: 3,
        min: -1.5,
        note: "Difference from the long-term mean for the week.",
      },
    ],
    events,
    gaps: [],
    surveys: surveys.map((s) => ({ t: s.t, label: `${PLOT_NAMES[s.plot] ?? s.plot}: ${s.images} photos, ${s.date}` })),
    changes: [],
    missing: [
      { title: "Less than one year of 3D", detail: "The public release covers June 2025 to March 2026. There is no before-and-after for the 2024 heat stress, which peaked before the first survey." },
      { title: "No live or dead coral labels", detail: "The release has geometry and colour, not segmentation. Height change is measurable; whether a colony died is not, without annotation." },
      { title: "No temperature on the reef", detail: "Heat here comes from the 5 km satellite pixel only." },
      ...(badCoords.length ? [{ title: `Coordinates missing for ${badCoords.map((p) => p.toUpperCase()).join(", ")}`, detail: "The dataset's metadata repeats the latitude where the longitude should be, so that plot is not placed on the map." }] : []),
    ],
    next: [
      {
        title: `Latest satellite heat stress: ${r1(lastHeat.dhw)} °C-weeks (${fmt(lastHeat.t)})`,
        detail: "A new survey of the same plots after any heat peak would give the first before-and-after in 3D.",
        evidence: "satellite",
      },
    ],
    points,
    sources: [
      { id: "soneva", name: "Soneva CSM Coral Reef Time-Series Photogrammetry (wildflow/soneva-corals)", provider: "Soneva Conservation and Sustainability Maldives and Wildflow", url: "https://huggingface.co/datasets/wildflow/soneva-corals", license: "CC BY 4.0" },
      SOURCES.crw,
      SOURCES.ibtracs,
    ],
    extras: {
      plots: [...byPlot].map(([plot, list]) => ({ id: plot, name: PLOT_NAMES[plot] ?? plot, notes: list[0].notes, depths: list.flatMap((s) => s.depths), surveys: list.map((s) => ({ date: s.date, images: s.images })) })),
      splats: splats.plots,
      change,
    },
  };
  write("soneva-fushi.json", dossier);
  return dossier;
}

// =================================================================== GLOBAL REEF LAYER
// The two supplied CSVs (also served from Tiger Cloud): yearly peak DHW 2021–2025
// per reef, and the survey archive (2013–2020). Output: one row per reef.
function buildGlobal() {
  const risk = readCsv(path.join(ROOT, "bleaching_risk_2021_2025.csv"));
  const stress = readCsv(path.join(ROOT, "reef_stress_analysis.csv"));
  const reefs = new Map();
  const get = (r) => {
    if (!reefs.has(r.reef_id)) reefs.set(r.reef_id, { id: +r.reef_id, lat: +r.latitude, lon: +r.longitude, dhw: [null, null, null, null, null], last: 0, n: 0 });
    return reefs.get(r.reef_id);
  };
  for (const r of risk) get(r).dhw[+r.year - 2021] = r1(+r.peak_dhw);
  for (const r of stress) {
    const x = get(r);
    x.last = Math.max(x.last, +r.year);
    x.n++;
  }
  const rows = [...reefs.values()].sort((a, b) => a.id - b.id).map((x) => [x.id, r3(x.lat), r3(x.lon), ...x.dhw, x.last || null, x.n]);
  fs.writeFileSync(
    path.resolve(here, "../src/data/global-reefs.json"),
    JSON.stringify({ columns: ["reef_id", "lat", "lon", "dhw2021", "dhw2022", "dhw2023", "dhw2024", "dhw2025", "last_survey_year", "surveys"], rows }),
  );
  console.log("global-reefs.json".padEnd(28), rows.length, "reefs");
}

buildMoorea();
buildLizard();
buildSoneva();
buildGlobal();
