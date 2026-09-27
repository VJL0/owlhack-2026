import { useEffect, useState } from "react";
import type { Dossier } from "./flagships";

// Browser-side reads of the atlas data that Tiger Cloud serves through /api/atlas.
// Each URL is fetched once per page; a failed fetch is forgotten so it can be retried.

const memo = new Map<string, Promise<unknown>>();

export class HttpError extends Error {
  constructor(readonly status: number, url: string) {
    super(`${url}: HTTP ${status}`);
  }
}

export function fetchJson<T>(url: string): Promise<T> {
  let p = memo.get(url);
  if (!p) {
    p = fetch(url).then((r) => {
      if (!r.ok) throw new HttpError(r.status, url);
      return r.json();
    });
    p.catch(() => memo.delete(url));
    memo.set(url, p);
  }
  return p as Promise<T>;
}

/** Flagship documents, e.g. "flagship/moorea" or "moorea/lagoon". */
export const fetchDocument = <T>(id: string) => fetchJson<T>(`/api/atlas/documents/${id}`);

export const loadDossier = (id: Dossier["id"]) => fetchDocument<Dossier>(`flagship/${id}`);

/** A document for a component: null while loading, "error" when it could not be read. */
export function useDocument<T>(id: string): T | null | "error" {
  const [state, setState] = useState<{ id: string; value: T | "error" } | null>(null);
  useEffect(() => {
    let live = true;
    fetchDocument<T>(id).then(
      (value) => live && setState({ id, value }),
      () => live && setState({ id, value: "error" }),
    );
    return () => {
      live = false;
    };
  }, [id]);
  return state?.id === id ? state.value : null;
}

// ------------------------------------------------------------------ global heat layer

export const HISTORY_YEARS = [1985, 2025] as const;
export const FORECAST_YEARS = [2027, 2031] as const;
export const isForecastYear = (y: number) => y >= FORECAST_YEARS[0];

export interface WorldIndex {
  /** columns: reef_id, lat, lon, last_survey_year, surveys */
  reefs: { columns: string[]; rows: [number, number, number, number | null, number][] };
  years: { year: number; kind: "history" | "forecast"; reefs: number; observed: number }[];
}

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

interface HeatStats {
  reefs: number;
  severe: number;
  severe_median_last_survey: number | null;
}

export type HeatYear =
  | {
      year: number;
      kind: "history";
      /** reef_id, peak DHW, 1 when observed (0: estimated in the supplied history) */
      rows: [number, number, 0 | 1][];
      stats: HeatStats & { observed: number };
    }
  | {
      year: number;
      kind: "forecast";
      /** reef_id, forecast peak DHW, 10th and 90th percentile, P(DHW >= 8), 1 when beyond the reef's history */
      rows: [number, number, number, number, number, 0 | 1][];
      stats: HeatStats & { likely_severe: number; beyond_history: number; model: string; horizon: number };
      /** the model's back-test at this horizon first, then the last-ten-years baseline */
      skill: Skill[];
    };

export const fetchWorld = () => fetchJson<WorldIndex>("/api/atlas/world");
/** Resolves to null for a year the supplied data does not cover (2003, 2026), without asking for it. */
export async function fetchHeat(year: number) {
  const world = await fetchWorld();
  if (!world.years.some((y) => y.year === year)) return null;
  return fetchJson<HeatYear>(`/api/atlas/heat?year=${year}`).catch((e) => {
    if (e instanceof HttpError && e.status === 404) return null;
    throw e;
  });
}
