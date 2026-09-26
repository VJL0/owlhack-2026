// Time in the experience is a float: days since 2016-01-01 UTC.

export const EPOCH_MS = Date.UTC(2016, 0, 1);
export const DAY_MS = 86_400_000;
export const T_MIN = 0;
export const T_MAX = (Date.UTC(2024, 11, 31) - EPOCH_MS) / DAY_MS;

/** Default moment: the height of the 2023 Florida marine heatwave. */
export const T_DEFAULT = (Date.UTC(2023, 7, 20) - EPOCH_MS) / DAY_MS;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export const dayToDate = (t: number) => new Date(EPOCH_MS + t * DAY_MS);
export const dateToDay = (d: Date | number) => ((typeof d === "number" ? d : d.getTime()) - EPOCH_MS) / DAY_MS;
export const ymdToDay = (y: number, m: number, d = 1) => (Date.UTC(y, m - 1, d) - EPOCH_MS) / DAY_MS;

export function formatMonth(t: number) {
  const d = dayToDate(t);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export function formatMonthLong(t: number) {
  const d = dayToDate(t);
  return `${MONTHS_LONG[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export function formatDate(t: number) {
  const d = dayToDate(t);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export function isoDate(t: number) {
  return dayToDate(t).toISOString().slice(0, 10);
}

/** Index into the monthly arrays (2016-01 = 0). */
export function monthIndex(t: number) {
  const d = dayToDate(t);
  return Math.max(0, Math.min(107, (d.getUTCFullYear() - 2016) * 12 + d.getUTCMonth()));
}

export const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smoothstep = (a: number, b: number, v: number) => {
  const x = clamp((v - a) / (b - a));
  return x * x * (3 - 2 * x);
};
