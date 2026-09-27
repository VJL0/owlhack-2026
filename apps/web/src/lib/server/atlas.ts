import 'server-only';
import { tigerPool } from './tiger';
import { documents, readDocumentText, readFlorida } from '../../../database/atlas.mjs';

// Everything the atlas shows is read from Tiger Cloud here (see database/README.md).
// The data changes only when an operator reloads it, so each read is kept for a
// few minutes per process. Failed reads are not kept.

const TTL_MS = 5 * 60_000;
const cache = new Map<string, { at: number; value: Promise<unknown> }>();

function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value as Promise<T>;
  const value = load();
  cache.set(key, { at: Date.now(), value });
  value.catch(() => {
    if (cache.get(key)?.value === value) cache.delete(key);
  });
  return value;
}

const q = (text: string, params?: unknown[]) => tigerPool().query(text, params).then((r) => r.rows);

/** The Florida scene's data: sites, weekly heat, storms, lionfish, simulated activity, sources. */
export const getFlorida = () => cached('florida', () => readFlorida(q));

export type DocumentId = keyof typeof documents;
export const isDocumentId = (id: string): id is DocumentId => Object.hasOwn(documents, id);

/** A flagship document's exact JSON text. */
export const getDocumentText = (id: DocumentId) =>
  cached(`doc:${id}`, async () => {
    const text = await readDocumentText(q, id);
    if (text === null) throw new Error('Document is not loaded');
    return text;
  });

// ------------------------------------------------------------------ global heat layer

export const HISTORY_YEARS = [1985, 2025] as const;
export const FORECAST_YEARS = [2027, 2031] as const;

const round2 = (v: number) => Math.round(v * 100) / 100;

/** Every reef in the archive, and which years the heat datasets cover. */
export const getWorld = () =>
  cached('world', async () => {
    const [reefs, years] = await Promise.all([
      q(`SELECT r.reef_id, r.latitude, r.longitude, s.last_survey_year, coalesce(s.surveys, 0) AS surveys
         FROM reef_data.reefs r
         LEFT JOIN (SELECT reef_id, max(year) AS last_survey_year, count(*)::integer AS surveys FROM reef_data.reef_stress GROUP BY reef_id) s USING (reef_id)
         ORDER BY r.reef_id`),
      q(`SELECT year, 'history' AS kind, count(*)::integer AS reefs, count(*) FILTER (WHERE peak_dhw_source = 'observed')::integer AS observed
         FROM reef_data.heat_history GROUP BY year
         UNION ALL
         SELECT year, 'forecast', count(*)::integer, 0 FROM reef_data.heat_forecast GROUP BY year
         ORDER BY year`),
    ]);
    return {
      reefs: {
        columns: ['reef_id', 'lat', 'lon', 'last_survey_year', 'surveys'],
        rows: reefs.map((r) => [r.reef_id, r.latitude, r.longitude, r.last_survey_year, r.surveys]),
      },
      years: years as { year: number; kind: 'history' | 'forecast'; reefs: number; observed: number }[],
    };
  });

export interface Skill {
  model: string;
  horizon: number;
  origins: number;
  n: number;
  maeDhw: number;
  aucDhw8: number;
  obsRateDhw8: number;
  predRateDhw8: number;
}

const skillOf = (r: Record<string, number | string>): Skill => ({
  model: r.model as string,
  horizon: r.horizon as number,
  origins: r.origins as number,
  n: r.n as number,
  maeDhw: r.mae_dhw as number,
  aucDhw8: r.auc_dhw8 as number,
  obsRateDhw8: r.obs_rate_dhw8 as number,
  predRateDhw8: r.pred_rate_dhw8 as number,
});

/**
 * Peak degree heating weeks for every reef in one year, with that year's summary.
 * History years carry whether each value is observed; forecast years carry the
 * 10th–90th percentile range, P(DHW ≥ 8), and the model's back-tested skill.
 */
export const getHeatYear = (year: number) =>
  cached(`heat:${year}`, async () => {
    const lastSurvey = 'LEFT JOIN (SELECT reef_id, max(year) AS last_survey FROM reef_data.reef_stress GROUP BY reef_id) s USING (reef_id)';
    if (year <= HISTORY_YEARS[1]) {
      const [rows, stats] = await Promise.all([
        q("SELECT reef_id, peak_dhw, peak_dhw_source = 'observed' AS observed FROM reef_data.heat_history WHERE year = $1 ORDER BY reef_id", [year]),
        q(`SELECT count(*)::integer AS reefs, count(*) FILTER (WHERE h.peak_dhw >= 8)::integer AS severe,
                  count(*) FILTER (WHERE h.peak_dhw_source = 'observed')::integer AS observed,
                  percentile_disc(0.5) WITHIN GROUP (ORDER BY s.last_survey) FILTER (WHERE h.peak_dhw >= 8) AS severe_median_last_survey
           FROM reef_data.heat_history h ${lastSurvey} WHERE h.year = $1`, [year]),
      ]);
      if (!rows.length) return null;
      return {
        year,
        kind: 'history' as const,
        columns: ['reef_id', 'dhw', 'observed'],
        rows: rows.map((r) => [r.reef_id, r.peak_dhw, r.observed ? 1 : 0]),
        stats: stats[0] as { reefs: number; severe: number; observed: number; severe_median_last_survey: number | null },
      };
    }
    const [rows, stats] = await Promise.all([
      q(`SELECT reef_id, forecast_peak_dhw, peak_dhw_p10, peak_dhw_p90, p_dhw_over_8, beyond_history_dhw
         FROM reef_data.heat_forecast WHERE year = $1 ORDER BY reef_id`, [year]),
      q(`SELECT count(*)::integer AS reefs, count(*) FILTER (WHERE f.forecast_peak_dhw >= 8)::integer AS severe,
                count(*) FILTER (WHERE f.p_dhw_over_8 >= 0.5)::integer AS likely_severe,
                count(*) FILTER (WHERE f.beyond_history_dhw)::integer AS beyond_history,
                percentile_disc(0.5) WITHIN GROUP (ORDER BY s.last_survey) FILTER (WHERE f.forecast_peak_dhw >= 8) AS severe_median_last_survey,
                min(f.model) AS model, min(f.horizon) AS horizon, count(DISTINCT f.model)::integer AS models
         FROM reef_data.heat_forecast f ${lastSurvey} WHERE f.year = $1`, [year]),
    ]);
    if (!rows.length) return null;
    const summary = stats[0] as { reefs: number; severe: number; likely_severe: number; beyond_history: number; severe_median_last_survey: number | null; model: string; horizon: number; models: number };
    if (summary.models !== 1) throw new Error('A forecast year mixes models');
    // Skill of this model at this horizon, beside the simplest baseline (the last ten years' pattern).
    const skill = await q(
      `SELECT model, horizon, n, origins, mae_dhw, auc_dhw8, obs_rate_dhw8, pred_rate_dhw8 FROM reef_data.heat_forecast_validation
       WHERE horizon = $1 AND model IN ($2, 'baseline_last10') ORDER BY model = $2 DESC`,
      [summary.horizon, summary.model],
    );
    return {
      year,
      kind: 'forecast' as const,
      columns: ['reef_id', 'dhw', 'p10', 'p90', 'p8', 'beyond_history'],
      rows: rows.map((r) => [r.reef_id, round2(r.forecast_peak_dhw), round2(r.peak_dhw_p10), round2(r.peak_dhw_p90), round2(r.p_dhw_over_8), r.beyond_history_dhw ? 1 : 0]),
      stats: summary,
      skill: skill.map(skillOf),
    };
  });
