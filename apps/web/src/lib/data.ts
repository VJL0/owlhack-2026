import { clamp, monthIndex } from "./time";

// The Florida scene's data lives in Tiger Cloud (reef_data.florida_* tables) and
// arrives once from /api/atlas/florida before the experience starts; see
// FloridaGate. The exports below are live bindings filled by setFloridaData.

export type Provenance = "observed" | "derived" | "model" | "simulated";

export interface Site {
  id: string;
  name: string;
  lat: number;
  lon: number;
  region: string;
  anchor: string;
  designation?: string;
  grid: { lat: number; lon: number };
}

export interface StormPoint {
  t: number;
  iso: string;
  rec: string;
  status: string;
  lat: number;
  lon: number;
  wind: number;
  pres: number;
}

export interface Storm {
  id: string;
  name: string;
  year: number;
  peakWindKt: number;
  closest: Record<string, { km: number; t: number; wind: number }>;
  pts: StormPoint[];
}

export interface LionfishRecord {
  key: number;
  t: number;
  date: string;
  lat: number;
  lon: number;
  locality: string;
  accuracy: string;
  recordType: string;
  km: Record<string, number>;
}

interface Thermal {
  dates: string[];
  days: number[];
  sites: Record<string, { dhw: number[]; sst: number[]; ssta: number[]; baa: number[] }>;
}

interface Simulated {
  months: string[];
  sites: Record<string, { fishingHours: number[]; vesselHours: number[]; sarDetections: number[]; sarUnmatched: number[] }>;
}

interface Meta {
  generated: string;
  sources: Record<string, { name: string; url: string; kind: Provenance }>;
}

export interface FloridaData {
  sites: Site[];
  thermal: Thermal;
  storms: Storm[];
  lionfish: LionfishRecord[];
  simulated: Simulated;
  meta: Meta;
}

export let SITES: Site[] = [];
export let THERMAL: Thermal = { dates: [], days: [], sites: {} };
export let STORMS: Storm[] = [];
export let LIONFISH: LionfishRecord[] = [];
export let SIMULATED: Simulated = { months: [], sites: {} };
export let META: Meta = { generated: "", sources: {} };
/** Reef tract order, north to south-west (Biscayne → Dry Tortugas). */
export let TRACT_ORDER: string[] = [];

export function setFloridaData(d: FloridaData) {
  SITES = d.sites;
  THERMAL = d.thermal;
  STORMS = d.storms;
  LIONFISH = d.lionfish;
  SIMULATED = d.simulated;
  META = d.meta;
  TRACT_ORDER = SITES.map((s) => s.id);
}

export const floridaReady = () => SITES.length > 0;

let pending: Promise<void> | null = null;
/** Fetch the Florida data once per page; a failed attempt can be retried. */
export function loadFloridaData() {
  pending ??= fetch("/api/atlas/florida")
    .then((r) => {
      if (!r.ok) throw new Error(`Florida data: HTTP ${r.status}`);
      return r.json() as Promise<FloridaData>;
    })
    .then(setFloridaData)
    .catch((e) => {
      pending = null;
      throw e;
    });
  return pending;
}

export const siteById = (id: string) => SITES.find((s) => s.id === id) ?? SITES[0];

// ------------------------------------------------------------------ thermal

function sampleIndex(t: number) {
  const days = THERMAL.days;
  if (t <= days[0]) return { i: 0, f: 0 };
  if (t >= days[days.length - 1]) return { i: days.length - 2, f: 1 };
  // weekly spacing: direct index then correct
  let i = Math.floor((t - days[0]) / 7);
  i = Math.max(0, Math.min(days.length - 2, i));
  while (i > 0 && days[i] > t) i--;
  while (i < days.length - 2 && days[i + 1] < t) i++;
  return { i, f: (t - days[i]) / (days[i + 1] - days[i]) };
}

export interface ThermalState {
  dhw: number;
  sst: number;
  ssta: number;
  baa: number;
  sampleDate: string;
}

export function thermalAt(siteId: string, t: number): ThermalState {
  const s = THERMAL.sites[siteId];
  const { i, f } = sampleIndex(t);
  const mix = (a: number[]) => a[i] + (a[i + 1] - a[i]) * f;
  const j = f < 0.5 ? i : i + 1;
  return { dhw: mix(s.dhw), sst: mix(s.sst), ssta: mix(s.ssta), baa: s.baa[j], sampleDate: THERMAL.dates[j] };
}

export function maxDhwWindow(siteId: string, t: number, windowDays: number) {
  const s = THERMAL.sites[siteId];
  const days = THERMAL.days;
  let m = 0;
  for (let i = 0; i < days.length; i++) {
    if (days[i] > t) break;
    if (days[i] >= t - windowDays) m = Math.max(m, s.dhw[i]);
  }
  return m;
}

/** NOAA CRW Bleaching Alert Area levels as published in the 5 km product (0–4). */
export const BAA_LABELS = ["No stress", "Bleaching watch", "Bleaching warning", "Alert level 1", "Alert level 2"];

// ------------------------------------------------------------------ storms

export interface StormFix {
  storm: Storm;
  lat: number;
  lon: number;
  wind: number;
  status: string;
  km: number;
}

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371;
  const toR = Math.PI / 180;
  const dLat = (lat2 - lat1) * toR;
  const dLon = (lon2 - lon1) * toR;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toR) * Math.cos(lat2 * toR) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function stormPositionAt(storm: Storm, t: number) {
  const p = storm.pts;
  if (!p.length || t < p[0].t || t > p[p.length - 1].t) return null;
  let i = 0;
  while (i < p.length - 2 && p[i + 1].t < t) i++;
  const a = p[i];
  const b = p[i + 1] ?? a;
  const f = b.t === a.t ? 0 : clamp((t - a.t) / (b.t - a.t));
  return {
    lat: a.lat + (b.lat - a.lat) * f,
    lon: a.lon + (b.lon - a.lon) * f,
    wind: a.wind + (b.wind - a.wind) * f,
    status: f < 0.5 ? a.status : b.status,
  };
}

/** Storms on the map at time t, with their current fix. */
export function activeStorms(t: number): { storm: Storm; lat: number; lon: number; wind: number; status: string }[] {
  const out = [];
  for (const storm of STORMS) {
    const pos = stormPositionAt(storm, t);
    if (pos) out.push({ storm, ...pos });
  }
  return out;
}

/** Nearest active storm to a site right now (within maxKm). */
export function nearestActiveStorm(siteId: string, t: number, maxKm = 400): StormFix | null {
  const site = siteById(siteId);
  let best: StormFix | null = null;
  for (const a of activeStorms(t)) {
    const km = haversineKm(site.lat, site.lon, a.lat, a.lon);
    if (km <= maxKm && (!best || km < best.km)) best = { ...a, km };
  }
  return best;
}

export interface StormExposure {
  maxWindKt: number;
  nearestKm: number | null;
  count: number;
  storms: { name: string; year: number; km: number; wind: number; t: number }[];
}

/** Storm exposure over a trailing window: closest approaches within radiusKm. */
export function stormExposure(siteId: string, t: number, windowDays = 365, radiusKm = 150): StormExposure {
  const list = [];
  for (const s of STORMS) {
    const c = s.closest[siteId];
    if (c && c.t <= t && c.t >= t - windowDays && c.km <= radiusKm) list.push({ name: s.name, year: s.year, km: c.km, wind: c.wind, t: c.t });
  }
  return {
    maxWindKt: list.reduce((m, s) => Math.max(m, s.wind), 0),
    nearestKm: list.length ? Math.min(...list.map((s) => s.km)) : null,
    count: list.length,
    storms: list,
  };
}

// ------------------------------------------------------------------ lionfish

export function lionfishNear(siteId: string, t: number, windowDays = 365, radiusKm = 25) {
  return LIONFISH.filter((r) => r.t <= t && r.t >= t - windowDays && r.km[siteId] <= radiusKm);
}

// ------------------------------------------------------------------ simulated AIS / SAR

export function simulatedAt(siteId: string, t: number) {
  const s = SIMULATED.sites[siteId];
  const m = monthIndex(t);
  const sum = (a: number[], n: number) => {
    let v = 0;
    for (let k = Math.max(0, m - n + 1); k <= m; k++) v += a[k];
    return v;
  };
  return {
    fishingHours30d: s.fishingHours[m],
    fishingHours90d: sum(s.fishingHours, 3),
    vesselHours30d: s.vesselHours[m],
    sar90d: sum(s.sarDetections, 3),
    sarUnmatched90d: sum(s.sarUnmatched, 3),
  };
}

// ------------------------------------------------------------------ feature snapshot

/** Mirrors one row of reef_feature_snapshots (site × moment). */
export interface FeatureSnapshot {
  siteId: string;
  t: number;
  dhw: number;
  sst: number;
  ssta: number;
  baa: number;
  maxDhw84d: number;
  fishingHours90d: number;
  vesselHours30d: number;
  sar90d: number;
  sarUnmatched90d: number;
  lionfish365d: number;
  stormMaxWind365d: number;
  stormNearestKm365d: number | null;
  stormCount365d: number;
}

export function snapshot(siteId: string, t: number): FeatureSnapshot {
  const th = thermalAt(siteId, t);
  const sim = simulatedAt(siteId, t);
  const ex = stormExposure(siteId, t);
  return {
    siteId,
    t,
    dhw: th.dhw,
    sst: th.sst,
    ssta: th.ssta,
    baa: th.baa,
    maxDhw84d: maxDhwWindow(siteId, t, 84),
    fishingHours90d: sim.fishingHours90d,
    vesselHours30d: sim.vesselHours30d,
    sar90d: sim.sar90d,
    sarUnmatched90d: sim.sarUnmatched90d,
    lionfish365d: lionfishNear(siteId, t).length,
    stormMaxWind365d: ex.maxWindKt,
    stormNearestKm365d: ex.nearestKm,
    stormCount365d: ex.count,
  };
}
