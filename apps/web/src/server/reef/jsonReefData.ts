import { BAA_LABELS, LIONFISH, SIMULATED, SITES, STORMS, THERMAL } from "@/lib/data";
import { dateToDay, isoDate } from "@/lib/time";
import { ReefDataError, type ReefData, type StormPass } from "./ReefData";

const round = (v: number, d = 1) => Math.round(v * 10 ** d) / 10 ** d;

function site(siteId: string) {
  const s = SITES.find((x) => x.id === siteId);
  if (!s) throw new ReefDataError(`Unknown site_id "${siteId}". Valid ids: ${SITES.map((x) => x.id).join(", ")}`);
  return s;
}

/** Inclusive ISO range → [fromDay, toDayExclusive) in the app's day-number time. */
function dayRange(from: string, to: string) {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  if (!re.test(from) || !re.test(to)) throw new ReefDataError(`Dates must be YYYY-MM-DD, got "${from}" and "${to}".`);
  const a = dateToDay(Date.parse(`${from}T00:00:00Z`));
  const b = dateToDay(Date.parse(`${to}T00:00:00Z`)) + 1;
  if (b <= a) throw new ReefDataError(`"from" (${from}) must not be after "to" (${to}).`);
  return [a, b] as const;
}

export const jsonReefData: ReefData = {
  async listSites() {
    return SITES.map(({ id, name, region, lat, lon }) => ({ id, name, region, lat, lon }));
  },

  async thermalSummary(siteId, from, to) {
    site(siteId);
    const [a, b] = dayRange(from, to);
    const s = THERMAL.sites[siteId];
    const idx = THERMAL.days.flatMap((d, i) => (d >= a && d < b ? [i] : []));
    if (!idx.length) {
      return {
        siteId, from, to, weeklySamples: 0, maxDhw: 0, maxDhwDate: null, weeksDhwAtLeast4: 0, weeksDhwAtLeast8: 0,
        maxAlertLevel: 0, maxAlertLabel: BAA_LABELS[0], meanSstC: 0, maxSstAnomalyC: 0, latest: null,
      };
    }
    const peak = idx.reduce((p, i) => (s.dhw[i] > s.dhw[p] ? i : p), idx[0]);
    const maxBaa = Math.max(...idx.map((i) => s.baa[i]));
    const last = idx[idx.length - 1];
    return {
      siteId,
      from,
      to,
      weeklySamples: idx.length,
      maxDhw: round(s.dhw[peak]),
      maxDhwDate: THERMAL.dates[peak],
      weeksDhwAtLeast4: idx.filter((i) => s.dhw[i] >= 4).length,
      weeksDhwAtLeast8: idx.filter((i) => s.dhw[i] >= 8).length,
      maxAlertLevel: maxBaa,
      maxAlertLabel: BAA_LABELS[maxBaa],
      meanSstC: round(idx.reduce((m, i) => m + s.sst[i], 0) / idx.length, 2),
      maxSstAnomalyC: round(Math.max(...idx.map((i) => s.ssta[i])), 2),
      latest: {
        date: THERMAL.dates[last],
        dhw: round(s.dhw[last]),
        sstC: round(s.sst[last], 2),
        sstAnomalyC: round(s.ssta[last], 2),
        alertLabel: BAA_LABELS[s.baa[last]],
      },
    };
  },

  async stormsNear(siteId, maxKm, from, to) {
    site(siteId);
    const [a, b] = dayRange(from, to);
    const out: StormPass[] = [];
    for (const st of STORMS) {
      const c = st.closest[siteId];
      if (c && c.t >= a && c.t < b && c.km <= maxKm) {
        out.push({ name: st.name, year: st.year, closestDate: isoDate(c.t), closestKm: c.km, windKtAtClosest: c.wind, peakWindKt: st.peakWindKt });
      }
    }
    return out.sort((x, y) => x.closestKm - y.closestKm);
  },

  async lionfishNear(siteId, radiusKm, from, to) {
    site(siteId);
    const [a, b] = dayRange(from, to);
    const hits = LIONFISH.filter((r) => r.t >= a && r.t < b && r.km[siteId] <= radiusKm).sort((x, y) => x.t - y.t);
    const countByYear: Record<string, number> = {};
    for (const r of hits) countByYear[r.date.slice(0, 4)] = (countByYear[r.date.slice(0, 4)] ?? 0) + 1;
    return {
      siteId,
      radiusKm,
      from,
      to,
      count: hits.length,
      firstDate: hits[0]?.date ?? null,
      latestDate: hits[hits.length - 1]?.date ?? null,
      nearestKm: hits.length ? Math.min(...hits.map((r) => r.km[siteId])) : null,
      countByYear,
    };
  },

  async activity(siteId, from, to) {
    site(siteId);
    dayRange(from, to);
    const s = SIMULATED.sites[siteId];
    const idx = SIMULATED.months.flatMap((m, i) => (m >= from.slice(0, 7) && m <= to.slice(0, 7) ? [i] : []));
    const sum = (arr: number[]) => round(idx.reduce((v, i) => v + arr[i], 0));
    return {
      siteId,
      from,
      to,
      months: idx.length,
      fishingHours: sum(s.fishingHours),
      vesselHours: sum(s.vesselHours),
      sarDetections: sum(s.sarDetections),
      sarUnmatched: sum(s.sarUnmatched),
      provenance: "simulated",
    };
  },
};
