// The data the voice agent can ask for. Two implementations fill it:
// jsonReefData (the bundled sample JSON, now) and a Tiger/TimescaleDB one (later).
// Dates are ISO "YYYY-MM-DD" strings and ranges are inclusive, so SQL maps 1:1.

export interface SiteInfo {
  id: string;
  name: string;
  region: string;
  lat: number;
  lon: number;
}

export interface ThermalSummary {
  siteId: string;
  from: string;
  to: string;
  weeklySamples: number;
  maxDhw: number;
  maxDhwDate: string | null;
  weeksDhwAtLeast4: number;
  weeksDhwAtLeast8: number;
  maxAlertLevel: number;
  maxAlertLabel: string;
  meanSstC: number;
  maxSstAnomalyC: number;
  latest: { date: string; dhw: number; sstC: number; sstAnomalyC: number; alertLabel: string } | null;
}

export interface StormPass {
  name: string;
  year: number;
  closestDate: string;
  closestKm: number;
  windKtAtClosest: number;
  peakWindKt: number;
}

export interface LionfishSummary {
  siteId: string;
  radiusKm: number;
  from: string;
  to: string;
  count: number;
  firstDate: string | null;
  latestDate: string | null;
  nearestKm: number | null;
  countByYear: Record<string, number>;
}

export interface ActivitySummary {
  siteId: string;
  from: string;
  to: string;
  months: number;
  fishingHours: number;
  vesselHours: number;
  sarDetections: number;
  sarUnmatched: number;
  provenance: "simulated";
}

export interface ReefData {
  listSites(): Promise<SiteInfo[]>;
  thermalSummary(siteId: string, from: string, to: string): Promise<ThermalSummary>;
  stormsNear(siteId: string, maxKm: number, from: string, to: string): Promise<StormPass[]>;
  lionfishNear(siteId: string, radiusKm: number, from: string, to: string): Promise<LionfishSummary>;
  activity(siteId: string, from: string, to: string): Promise<ActivitySummary>;
}

/** Thrown for bad tool input; the agent sends the message back to Gemini so it can correct itself. */
export class ReefDataError extends Error {}
