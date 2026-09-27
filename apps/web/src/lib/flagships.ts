// Flagship reefs: places where repeated, public field evidence lets the atlas
// reconstruct what happened between surveys. The dossier JSON is built by
// scripts/build-flagships.mjs from /data/raw; nothing here is simulated.

/** Where a number comes from. Shown on every lane, value and event. */
export type Evidence =
  | "field" // divers or photo surveys on the reef
  | "sensor" // an instrument on the reef (thermistor)
  | "satellite" // remote sensing (NOAA Coral Reef Watch)
  | "track" // cyclone best track (IBTrACS)
  | "reported" // a monitoring program's own attribution of a change
  | "derived"; // computed here from the sources above

export const EVIDENCE_LABEL: Record<Evidence, string> = {
  field: "Field survey",
  sensor: "Reef sensor",
  satellite: "Satellite",
  track: "Storm track",
  reported: "Reported cause",
  derived: "Derived here",
};

export type FlagshipId = "moorea" | "lizard-island" | "soneva-fushi" | "florida";

export interface Source {
  id: string;
  name: string;
  provider: string;
  url: string;
  license: string;
}

/** One lane of the evidence timeline. t is a decimal year (2019.25 = early April 2019). */
export interface Lane {
  id: string;
  label: string;
  unit: string;
  evidence: Evidence;
  source: string;
  /** survey: discrete observations (dots, dashed between); continuous: a filled line; count: bars */
  kind: "survey" | "continuous" | "count";
  color: string;
  points: [t: number, v: number, lo?: number, hi?: number][];
  /** extra series drawn faintly in the same lane (e.g. other depths) */
  others?: { label: string; points: [number, number][] }[];
  max: number;
  /** lane floor when it is not zero (temperatures) */
  min?: number;
  /** horizontal reference lines, e.g. DHW 4 and 8 */
  refs?: { v: number; label: string }[];
  note?: string;
}

export interface TimelineEvent {
  t: number;
  t1?: number;
  kind: "cyclone" | "cots" | "bleaching" | "heat" | "unknown" | "multiple" | "storm" | "survey";
  label: string;
  detail: string;
  evidence: Evidence;
  source: string;
}

/** An interval nobody observed, or where an instrument was silent. */
export interface Gap {
  t0: number;
  t1: number;
  label: string;
  lane?: string;
}

export type Presence = "present" | "absent" | "not measured";

export interface DriverCheck {
  driver: string;
  presence: Presence;
  value: string;
  evidence: Evidence;
  source: string;
}

/** A measured change between two consecutive surveys, and what else the record shows in between. */
export interface Change {
  id: string;
  t0: number;
  t1: number;
  metric: string;
  before: number;
  after: number;
  unit: string;
  title: string;
  summary: string;
  drivers: DriverCheck[];
}

export interface MapPoint {
  id: string;
  name: string;
  lat: number;
  lon: number;
  kind: "site" | "sensor" | "plot";
  note?: string;
}

export interface SplatSurvey {
  survey: string;
  date: string;
  file: string;
  lod: number;
  splats: number;
  bytes: number;
  source: string;
}

export interface Dossier {
  id: Exclude<FlagshipId, "florida">;
  name: string;
  place: string;
  lat: number;
  lon: number;
  role: string;
  question: string;
  summary: string;
  span: [number, number];
  stats: { value: string; label: string }[];
  lanes: Lane[];
  events: TimelineEvent[];
  gaps: Gap[];
  surveys: { t: number; label: string }[];
  changes: Change[];
  missing: { title: string; detail: string }[];
  next: { title: string; detail: string; evidence: Evidence }[];
  points: MapPoint[];
  sources: Source[];
  /** flagship-specific panels */
  extras: Record<string, unknown>;
}

export interface FlagshipSummary {
  id: FlagshipId;
  name: string;
  place: string;
  lat: number;
  lon: number;
  role: string;
  question: string;
  blurb: string;
  record: string;
}

export const decimalYear = (iso: string) => {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  const y = d.getUTCFullYear();
  const a = Date.UTC(y, 0, 1);
  return y + (d.getTime() - a) / (Date.UTC(y + 1, 0, 1) - a);
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatYear(t: number, withMonth = true) {
  const y = Math.floor(t);
  if (!withMonth) return String(y);
  const m = Math.min(11, Math.floor((t - y) * 12));
  return `${MONTHS[m]} ${y}`;
}

export async function loadDossier(id: Dossier["id"]): Promise<Dossier> {
  switch (id) {
    case "moorea":
      return (await import("@/data/flagships/moorea.json")).default as unknown as Dossier;
    case "lizard-island":
      return (await import("@/data/flagships/lizard-island.json")).default as unknown as Dossier;
    case "soneva-fushi":
      return (await import("@/data/flagships/soneva-fushi.json")).default as unknown as Dossier;
  }
}
