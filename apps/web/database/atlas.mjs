// Reef Atlas app data in Tiger (migration 003): the Florida demonstration and the
// flagship documents. The read functions return exactly the objects the app used
// to import from src/data/*.json; the loader and the verifier use them too, so a
// verified load is byte-identical to what the app serves.
// Shared by server runtime and operational scripts. Never import in client code.
//
// `q(text, params)` runs one parameterized query and resolves to its rows.

// App time: days since 2016-01-01 UTC (see src/lib/time.ts).
const EPOCH_MS = Date.UTC(2016, 0, 1);
const DAY_MS = 86_400_000;
const r2 = (v) => Math.round(v * 100) / 100;
const toDay = (ms) => (ms - EPOCH_MS) / DAY_MS;
const fromDay = (t) => new Date(EPOCH_MS + Math.round(t * DAY_MS)).toISOString();
const ymd = (date) => date.toISOString().slice(0, 10);

export const floridaDatasets = ['sites', 'thermal', 'storms', 'lionfish', 'simulated', 'meta'];

/** Document id → the file it was built as (relative to the build output directory). */
export const documents = {
  'flagship/moorea': 'flagships/moorea.json',
  'flagship/lizard-island': 'flagships/lizard-island.json',
  'flagship/soneva-fushi': 'flagships/soneva-fushi.json',
  'moorea/lagoon': 'flagships/moorea-lagoon.json',
  'moorea/bleaching2019': 'flagships/moorea-bleaching2019.json',
  'soneva/splats': 'flagships/soneva-splats.json',
  'soneva/change': 'flagships/soneva-change.json',
};

// ------------------------------------------------------------------ read

async function readSites(q) {
  const rows = await q('SELECT site_id, name, latitude, longitude, region, anchor, designation, crw_latitude, crw_longitude FROM reef_data.florida_sites ORDER BY tract_order');
  return rows.map((r) => ({
    id: r.site_id, name: r.name, lat: r.latitude, lon: r.longitude, region: r.region, anchor: r.anchor,
    ...(r.designation === null ? {} : { designation: r.designation }),
    grid: { lat: r.crw_latitude, lon: r.crw_longitude },
  }));
}

async function readThermal(q) {
  const rows = await q(`SELECT t.site_id, t.sampled_at, t.dhw, t.sst, t.ssta, t.baa
    FROM reef_data.florida_thermal t JOIN reef_data.florida_sites s USING (site_id) ORDER BY s.tract_order, t.sampled_at`);
  const thermal = { dates: [], days: [], sites: {} };
  const instants = [];
  for (const r of rows) {
    let site = thermal.sites[r.site_id];
    if (!site) site = thermal.sites[r.site_id] = { dhw: [], sst: [], ssta: [], baa: [] };
    const i = site.dhw.length;
    if (Object.keys(thermal.sites).length === 1) {
      instants.push(r.sampled_at.getTime());
      thermal.dates.push(ymd(r.sampled_at));
      thermal.days.push(r2(toDay(r.sampled_at.getTime())));
    } else if (instants[i] !== r.sampled_at.getTime()) {
      throw new Error(`florida_thermal: ${r.site_id} is not sampled at the same instants as the other sites`);
    }
    site.dhw.push(r.dhw);
    site.sst.push(r.sst);
    site.ssta.push(r.ssta);
    site.baa.push(r.baa);
  }
  for (const [id, s] of Object.entries(thermal.sites)) if (s.dhw.length !== instants.length) throw new Error(`florida_thermal: ${id} has missing samples`);
  return thermal;
}

async function readStorms(q) {
  const [storms, fixes, passes] = await Promise.all([
    q(`SELECT s.storm_id, s.name, s.season, s.peak_wind_kt FROM reef_data.storms s
       ORDER BY (SELECT min(f.observed_at) FROM reef_data.storm_fixes f WHERE f.storm_id = s.storm_id), s.storm_id`),
    q(`SELECT storm_id, observed_at, record_identifier, status, latitude, longitude, max_wind_kt, min_pressure_mb
       FROM reef_data.storm_fixes ORDER BY storm_id, observed_at`),
    q(`SELECT p.storm_id, p.site_id, p.closest_at, p.distance_km, p.wind_kt
       FROM reef_data.storm_site_passes p JOIN reef_data.florida_sites s USING (site_id) ORDER BY p.storm_id, s.tract_order`),
  ]);
  const byId = new Map(storms.map((s) => [s.storm_id, { id: s.storm_id, name: s.name, year: s.season, peakWindKt: s.peak_wind_kt, closest: {}, pts: [] }]));
  for (const p of passes) byId.get(p.storm_id).closest[p.site_id] = { km: p.distance_km, t: r2(toDay(p.closest_at.getTime())), wind: p.wind_kt };
  for (const f of fixes) {
    const ms = f.observed_at.getTime();
    byId.get(f.storm_id).pts.push({
      t: r2(toDay(ms)), iso: `${new Date(ms).toISOString().slice(0, 16)}Z`, rec: f.record_identifier ?? '', status: f.status,
      lat: f.latitude, lon: f.longitude, wind: f.max_wind_kt, pres: f.min_pressure_mb,
    });
  }
  return [...byId.values()];
}

async function readLionfish(q) {
  const [records, distances] = await Promise.all([
    q('SELECT nas_key, observed_on::text AS observed_on, latitude, longitude, locality, accuracy, record_type FROM reef_data.lionfish_records ORDER BY source_row'),
    q(`SELECT d.nas_key, d.site_id, d.distance_km FROM reef_data.lionfish_site_distances d
       JOIN reef_data.florida_sites s USING (site_id) ORDER BY d.nas_key, s.tract_order`),
  ]);
  const km = new Map();
  for (const d of distances) {
    if (!km.has(d.nas_key)) km.set(d.nas_key, {});
    km.get(d.nas_key)[d.site_id] = d.distance_km;
  }
  return records.map((r) => ({
    key: r.nas_key, t: toDay(Date.parse(`${r.observed_on}T00:00:00Z`)), date: r.observed_on, lat: r.latitude, lon: r.longitude,
    locality: r.locality, accuracy: r.accuracy, recordType: r.record_type, km: km.get(r.nas_key) ?? {},
  }));
}

async function readSimulated(q) {
  const rows = await q(`SELECT a.site_id, to_char(a.month, 'YYYY-MM') AS month, a.fishing_hours, a.vessel_hours, a.sar_detections, a.sar_unmatched
    FROM reef_data.florida_simulated_activity a JOIN reef_data.florida_sites s USING (site_id) ORDER BY s.tract_order, a.month`);
  const simulated = { months: [], sites: {} };
  for (const r of rows) {
    let site = simulated.sites[r.site_id];
    if (!site) site = simulated.sites[r.site_id] = { fishingHours: [], vesselHours: [], sarDetections: [], sarUnmatched: [] };
    if (Object.keys(simulated.sites).length === 1) simulated.months.push(r.month);
    else if (simulated.months[site.fishingHours.length] !== r.month) throw new Error(`florida_simulated_activity: ${r.site_id} months differ`);
    site.fishingHours.push(r.fishing_hours);
    site.vesselHours.push(r.vessel_hours);
    site.sarDetections.push(r.sar_detections);
    site.sarUnmatched.push(r.sar_unmatched);
  }
  return simulated;
}

async function readMeta(q) {
  const [built, sources] = await Promise.all([
    q("SELECT to_char(built_on, 'YYYY-MM-DD') AS built_on FROM reef_data.atlas_imports WHERE dataset = 'florida/meta'"),
    q('SELECT source_key, name, url, kind FROM reef_data.florida_sources ORDER BY position'),
  ]);
  if (!built.length) throw new Error('The Florida bundle is not loaded');
  return { generated: built[0].built_on, sources: Object.fromEntries(sources.map((s) => [s.source_key, { name: s.name, url: s.url, kind: s.kind }])) };
}

const readers = { sites: readSites, thermal: readThermal, storms: readStorms, lionfish: readLionfish, simulated: readSimulated, meta: readMeta };

/** One Florida dataset, shaped as the former src/data/<name>.json. */
export const readFloridaDataset = (q, name) => readers[name](q);

/** Everything the Florida scene needs, in one object. */
export async function readFlorida(q) {
  const parts = await Promise.all(floridaDatasets.map((name) => readers[name](q)));
  return Object.fromEntries(floridaDatasets.map((name, i) => [name, parts[i]]));
}

/** A document's exact JSON text, or null when it does not exist. */
export async function readDocumentText(q, docId) {
  const rows = await q('SELECT body::text AS body FROM reef_data.atlas_documents WHERE doc_id = $1', [docId]);
  return rows.length ? rows[0].body : null;
}

// ------------------------------------------------------------------ load (admin scripts only)

const DELETE_ORDER = ['lionfish_site_distances', 'lionfish_records', 'storm_site_passes', 'storm_fixes', 'storms', 'florida_thermal', 'florida_simulated_activity', 'florida_sites', 'florida_sources'];

/** Replace the whole Florida bundle. Run inside the caller's transaction. */
export async function loadFlorida(client, { sites, thermal, storms, lionfish, simulated, meta }) {
  for (const table of DELETE_ORDER) await client.query(`DELETE FROM reef_data.${table}`);
  const ids = sites.map((s) => s.id);
  await client.query(
    `INSERT INTO reef_data.florida_sites (site_id, tract_order, name, region, anchor, designation, latitude, longitude, crw_latitude, crw_longitude)
     SELECT * FROM unnest($1::text[], $2::int[], $3::text[], $4::text[], $5::text[], $6::text[], $7::float8[], $8::float8[], $9::float8[], $10::float8[])`,
    [ids, sites.map((_, i) => i + 1), sites.map((s) => s.name), sites.map((s) => s.region), sites.map((s) => s.anchor), sites.map((s) => s.designation ?? null),
      sites.map((s) => s.lat), sites.map((s) => s.lon), sites.map((s) => s.grid.lat), sites.map((s) => s.grid.lon)],
  );

  const at = thermal.days.map(fromDay);
  thermal.dates.forEach((d, i) => { if (at[i].slice(0, 10) !== d) throw new Error(`thermal: day ${thermal.days[i]} is not on ${d}`); });
  const th = { site: [], at: [], dhw: [], sst: [], ssta: [], baa: [] };
  for (const id of ids) {
    const s = thermal.sites[id];
    at.forEach((instant, i) => { th.site.push(id); th.at.push(instant); th.dhw.push(s.dhw[i]); th.sst.push(s.sst[i]); th.ssta.push(s.ssta[i]); th.baa.push(s.baa[i]); });
  }
  await client.query('INSERT INTO reef_data.florida_thermal (site_id, sampled_at, dhw, sst, ssta, baa) SELECT * FROM unnest($1::text[], $2::timestamptz[], $3::float8[], $4::float8[], $5::float8[], $6::int[])',
    [th.site, th.at, th.dhw, th.sst, th.ssta, th.baa]);

  await client.query('INSERT INTO reef_data.storms (storm_id, name, season, peak_wind_kt) SELECT * FROM unnest($1::text[], $2::text[], $3::int[], $4::int[])',
    [storms.map((s) => s.id), storms.map((s) => s.name), storms.map((s) => s.year), storms.map((s) => s.peakWindKt)]);
  const fx = storms.flatMap((s) => s.pts.map((p) => ({ id: s.id, ...p, at: new Date(Date.parse(p.iso.replace('Z', ':00Z'))).toISOString() })));
  await client.query('INSERT INTO reef_data.storm_fixes (storm_id, observed_at, record_identifier, status, latitude, longitude, max_wind_kt, min_pressure_mb) SELECT * FROM unnest($1::text[], $2::timestamptz[], $3::text[], $4::text[], $5::float8[], $6::float8[], $7::int[], $8::int[])',
    [fx.map((p) => p.id), fx.map((p) => p.at), fx.map((p) => p.rec || null), fx.map((p) => p.status), fx.map((p) => p.lat), fx.map((p) => p.lon), fx.map((p) => p.wind), fx.map((p) => p.pres)]);
  const ps = storms.flatMap((s) => Object.entries(s.closest).map(([site, c]) => ({ id: s.id, site, ...c })));
  await client.query('INSERT INTO reef_data.storm_site_passes (storm_id, site_id, closest_at, distance_km, wind_kt) SELECT * FROM unnest($1::text[], $2::text[], $3::timestamptz[], $4::int[], $5::int[])',
    [ps.map((p) => p.id), ps.map((p) => p.site), ps.map((p) => fromDay(p.t)), ps.map((p) => p.km), ps.map((p) => p.wind)]);

  await client.query('INSERT INTO reef_data.lionfish_records (nas_key, source_row, observed_on, latitude, longitude, locality, accuracy, record_type) SELECT * FROM unnest($1::int[], $2::int[], $3::date[], $4::float8[], $5::float8[], $6::text[], $7::text[], $8::text[])',
    [lionfish.map((r) => r.key), lionfish.map((_, i) => i + 1), lionfish.map((r) => r.date), lionfish.map((r) => r.lat), lionfish.map((r) => r.lon),
      lionfish.map((r) => r.locality), lionfish.map((r) => r.accuracy), lionfish.map((r) => r.recordType)]);
  const ld = lionfish.flatMap((r) => Object.entries(r.km).map(([site, km]) => ({ key: r.key, site, km })));
  await client.query('INSERT INTO reef_data.lionfish_site_distances (nas_key, site_id, distance_km) SELECT * FROM unnest($1::int[], $2::text[], $3::float8[])',
    [ld.map((d) => d.key), ld.map((d) => d.site), ld.map((d) => d.km)]);

  const sim = { site: [], month: [], f: [], v: [], d: [], u: [] };
  for (const id of ids) {
    const s = simulated.sites[id];
    simulated.months.forEach((m, i) => { sim.site.push(id); sim.month.push(`${m}-01`); sim.f.push(s.fishingHours[i]); sim.v.push(s.vesselHours[i]); sim.d.push(s.sarDetections[i]); sim.u.push(s.sarUnmatched[i]); });
  }
  await client.query('INSERT INTO reef_data.florida_simulated_activity (site_id, month, fishing_hours, vessel_hours, sar_detections, sar_unmatched) SELECT * FROM unnest($1::text[], $2::date[], $3::float8[], $4::float8[], $5::int[], $6::int[])',
    [sim.site, sim.month, sim.f, sim.v, sim.d, sim.u]);

  const src = Object.entries(meta.sources);
  await client.query('INSERT INTO reef_data.florida_sources (source_key, position, name, url, kind) SELECT * FROM unnest($1::text[], $2::int[], $3::text[], $4::text[], $5::text[])',
    [src.map(([k]) => k), src.map((_, i) => i + 1), src.map(([, s]) => s.name), src.map(([, s]) => s.url), src.map(([, s]) => s.kind)]);
}

/** Insert or replace one document from its exact JSON text. */
export async function loadDocument(client, docId, text) {
  await client.query('INSERT INTO reef_data.atlas_documents (doc_id, body) VALUES ($1, $2::json) ON CONFLICT (doc_id) DO UPDATE SET body = EXCLUDED.body', [docId, text]);
}
