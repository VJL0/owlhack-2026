// Coverage of NASA GIBS "GHRSST_L4_MUR_Sea_Surface_Temperature_Anomalies"
// (from the WMTS capabilities, retrieved 2026-09-26). Earlier dates return 404.
const MUR_ANOMALY_RANGES: [string, string][] = [
  ["2019-07-23", "2021-02-19"],
  ["2021-02-22", "2022-11-08"],
  ["2022-11-10", "2023-02-01"],
  ["2023-02-04", "2023-04-21"],
  ["2023-04-23", "2024-07-01"],
  ["2024-07-03", "2025-08-15"],
];

export const MUR_ANOMALY_START = MUR_ANOMALY_RANGES[0][0];

const DAY = 86_400_000;
const ms = (d: string) => Date.parse(`${d}T00:00:00Z`);
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

/** The MUR anomaly date to request for `date`, or null if there is no layer near it. */
export function murAnomalyDate(date: string): string | null {
  const t = ms(date);
  let best: { d: string; gap: number } | null = null;
  for (const [a, b] of MUR_ANOMALY_RANGES) {
    const ta = ms(a);
    const tb = ms(b);
    if (t >= ta && t <= tb) return date;
    const near = t < ta ? { d: a, gap: ta - t } : { d: b, gap: t - tb };
    if (!best || near.gap < best.gap) best = near;
  }
  return best && best.gap <= 3 * DAY ? iso(ms(best.d)) : null;
}
