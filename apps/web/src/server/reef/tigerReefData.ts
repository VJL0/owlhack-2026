import "server-only";
import { tigerPool } from "@/lib/server/tiger";
import { ReefDataError, type ReefData, type SiteInfo, type StormPass } from "./ReefData";

// The voice agent's data tools, answered by SQL on Tiger Cloud (reef_data.florida_*,
// storm_*, lionfish_*). Inclusive ISO date ranges map directly onto the queries.

const BAA_LABELS = ["No stress", "Bleaching watch", "Bleaching warning", "Alert level 1", "Alert level 2"];
const round = (v: number, d = 1) => Math.round(v * 10 ** d) / 10 ** d;
const q = (text: string, params?: unknown[]) => tigerPool().query(text, params).then((r) => r.rows);

let sitesCache: Promise<SiteInfo[]> | null = null;
function sites() {
  sitesCache ??= q("SELECT site_id AS id, name, region, latitude AS lat, longitude AS lon FROM reef_data.florida_sites ORDER BY tract_order").then(
    (rows) => rows as SiteInfo[],
    (e) => {
      sitesCache = null;
      throw e;
    },
  );
  return sitesCache;
}

async function site(siteId: string) {
  const all = await sites();
  if (!all.some((s) => s.id === siteId)) throw new ReefDataError(`Unknown site_id "${siteId}". Valid ids: ${all.map((x) => x.id).join(", ")}`);
}

// A real calendar day: "2023-02-30" is rejected here, not by the database.
const isDay = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && new Date(`${d}T00:00:00Z`).toISOString().startsWith(d);

function range(from: string, to: string) {
  if (!isDay(from) || !isDay(to)) throw new ReefDataError(`Dates must be YYYY-MM-DD, got "${from}" and "${to}".`);
  if (from > to) throw new ReefDataError(`"from" (${from}) must not be after "to" (${to}).`);
}

// A timestamp is in [from, to] when from 00:00 UTC <= it < the day after to, 00:00 UTC.
const IN_RANGE = (column: string) => `${column} >= ($2::date)::timestamp AT TIME ZONE 'UTC' AND ${column} < ($3::date + 1)::timestamp AT TIME ZONE 'UTC'`;

export const tigerReefData: ReefData = {
  listSites: sites,

  async thermalSummary(siteId, from, to) {
    await site(siteId);
    range(from, to);
    const where = `site_id = $1 AND ${IN_RANGE("sampled_at")}`;
    const [agg] = await q(
      `SELECT count(*)::integer AS n, count(*) FILTER (WHERE dhw >= 4)::integer AS w4, count(*) FILTER (WHERE dhw >= 8)::integer AS w8,
              max(baa) AS max_baa, avg(sst) AS mean_sst, max(ssta) AS max_ssta
       FROM reef_data.florida_thermal WHERE ${where}`,
      [siteId, from, to],
    );
    if (!agg.n) {
      return {
        siteId, from, to, weeklySamples: 0, maxDhw: 0, maxDhwDate: null, weeksDhwAtLeast4: 0, weeksDhwAtLeast8: 0,
        maxAlertLevel: 0, maxAlertLabel: BAA_LABELS[0], meanSstC: 0, maxSstAnomalyC: 0, latest: null,
      };
    }
    // The first sample at the peak, and the last sample in the range.
    const [peak] = await q(`SELECT dhw, to_char(sampled_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS date FROM reef_data.florida_thermal WHERE ${where} ORDER BY dhw DESC, sampled_at LIMIT 1`, [siteId, from, to]);
    const [last] = await q(`SELECT dhw, sst, ssta, baa, to_char(sampled_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS date FROM reef_data.florida_thermal WHERE ${where} ORDER BY sampled_at DESC LIMIT 1`, [siteId, from, to]);
    return {
      siteId,
      from,
      to,
      weeklySamples: agg.n,
      maxDhw: round(peak.dhw),
      maxDhwDate: peak.date,
      weeksDhwAtLeast4: agg.w4,
      weeksDhwAtLeast8: agg.w8,
      maxAlertLevel: agg.max_baa,
      maxAlertLabel: BAA_LABELS[agg.max_baa],
      meanSstC: round(agg.mean_sst, 2),
      maxSstAnomalyC: round(agg.max_ssta, 2),
      latest: { date: last.date, dhw: round(last.dhw), sstC: round(last.sst, 2), sstAnomalyC: round(last.ssta, 2), alertLabel: BAA_LABELS[last.baa] },
    };
  },

  async stormsNear(siteId, maxKm, from, to) {
    await site(siteId);
    range(from, to);
    const rows = await q(
      `SELECT s.name, s.season AS year, to_char(p.closest_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS "closestDate", p.distance_km AS "closestKm",
              p.wind_kt AS "windKtAtClosest", s.peak_wind_kt AS "peakWindKt"
       FROM reef_data.storm_site_passes p JOIN reef_data.storms s USING (storm_id)
       WHERE p.site_id = $1 AND ${IN_RANGE("p.closest_at")} AND p.distance_km <= $4
       ORDER BY p.distance_km, p.closest_at`,
      [siteId, from, to, maxKm],
    );
    return rows as StormPass[];
  },

  async lionfishNear(siteId, radiusKm, from, to) {
    await site(siteId);
    range(from, to);
    const hits = await q(
      `SELECT r.observed_on::text AS date, d.distance_km AS km
       FROM reef_data.lionfish_records r JOIN reef_data.lionfish_site_distances d USING (nas_key)
       WHERE d.site_id = $1 AND r.observed_on BETWEEN $2::date AND $3::date AND d.distance_km <= $4
       ORDER BY r.observed_on, r.source_row`,
      [siteId, from, to, radiusKm],
    );
    const countByYear: Record<string, number> = {};
    for (const h of hits) countByYear[h.date.slice(0, 4)] = (countByYear[h.date.slice(0, 4)] ?? 0) + 1;
    return {
      siteId,
      radiusKm,
      from,
      to,
      count: hits.length,
      firstDate: hits[0]?.date ?? null,
      latestDate: hits[hits.length - 1]?.date ?? null,
      nearestKm: hits.length ? Math.min(...hits.map((h) => h.km)) : null,
      countByYear,
    };
  },

  async activity(siteId, from, to) {
    await site(siteId);
    range(from, to);
    const [agg] = await q(
      `SELECT count(*)::integer AS months, coalesce(sum(fishing_hours), 0) AS fishing, coalesce(sum(vessel_hours), 0) AS vessel,
              coalesce(sum(sar_detections), 0)::integer AS sar, coalesce(sum(sar_unmatched), 0)::integer AS unmatched
       FROM reef_data.florida_simulated_activity
       WHERE site_id = $1 AND month BETWEEN date_trunc('month', $2::date)::date AND date_trunc('month', $3::date)::date`,
      [siteId, from, to],
    );
    return {
      siteId,
      from,
      to,
      months: agg.months,
      fishingHours: round(agg.fishing),
      vesselHours: round(agg.vessel),
      sarDetections: round(agg.sar),
      sarUnmatched: round(agg.unmatched),
      provenance: "simulated",
    };
  },
};
