import type { FunctionDeclaration } from "@google/genai";
import { getReefData, ReefDataError } from "@/server/reef";
import { flagshipEvidence, flagshipToolDeclaration } from "./flagshipTool";

// The only way the agent reaches data. Gemini picks a tool and arguments;
// our code runs it. No free-form SQL, so a bad model guess cannot hurt the database.

const siteId = { type: "string", description: "Site id, e.g. \"looe-key\". Must be one of the ids in the system prompt." };
const from = { type: "string", description: "Start date, inclusive, YYYY-MM-DD. Data covers 2016-01-01 to 2024-12-31." };
const to = { type: "string", description: "End date, inclusive, YYYY-MM-DD." };

const METRICS = ["max_dhw", "weeks_dhw_at_least_4", "lionfish_sightings", "storm_passes", "fishing_hours"] as const;
type Metric = (typeof METRICS)[number];

export const toolDeclarations: FunctionDeclaration[] = [
  {
    name: "get_thermal_summary",
    description:
      "Ocean heat stress at one reef over a date range (NOAA Coral Reef Watch, observed, weekly). Returns peak Degree Heating Weeks (DHW) and its date, weeks at DHW>=4 (significant bleaching likely) and >=8 (severe bleaching and mortality likely), highest bleaching alert level, mean sea surface temperature, max SST anomaly, and the latest values.",
    parametersJsonSchema: { type: "object", properties: { site_id: siteId, from, to }, required: ["site_id", "from", "to"] },
  },
  {
    name: "get_storms_near",
    description:
      "Hurricanes and tropical storms whose closest approach to a reef fell in the date range and within max_km (NOAA HURDAT2, observed). Sorted nearest first.",
    parametersJsonSchema: {
      type: "object",
      properties: { site_id: siteId, from, to, max_km: { type: "number", description: "Search radius in km. Default 150." } },
      required: ["site_id", "from", "to"],
    },
  },
  {
    name: "get_lionfish_near",
    description:
      "Invasive lionfish sighting reports within radius_km of a reef in the date range (USGS NAS, observed). Returns count, first/latest date, nearest distance, count per year.",
    parametersJsonSchema: {
      type: "object",
      properties: { site_id: siteId, from, to, radius_km: { type: "number", description: "Search radius in km. Default 25." } },
      required: ["site_id", "from", "to"],
    },
  },
  {
    name: "get_activity",
    description:
      "Human activity near a reef summed over the date range: fishing hours, vessel hours, satellite radar (SAR) vessel detections, and SAR detections with no matching AIS broadcast (possible dark vessels). THIS DATA IS SIMULATED; always say so.",
    parametersJsonSchema: { type: "object", properties: { site_id: siteId, from, to }, required: ["site_id", "from", "to"] },
  },
  {
    name: "compare_sites",
    description: "Rank all reef sites by one metric over a date range, highest first. Use for 'which reef is worst/best' questions.",
    parametersJsonSchema: {
      type: "object",
      properties: { metric: { type: "string", enum: [...METRICS] }, from, to },
      required: ["metric", "from", "to"],
    },
  },
  flagshipToolDeclaration,
];

type Args = Record<string, unknown>;

const str = (a: Args, k: string) => {
  const v = a[k];
  if (typeof v !== "string") throw new ReefDataError(`Argument "${k}" must be a string.`);
  return v;
};
const num = (a: Args, k: string, dflt: number) => {
  const v = a[k];
  if (v === undefined) return dflt;
  if (typeof v !== "number" || !(v > 0)) throw new ReefDataError(`Argument "${k}" must be a positive number.`);
  return v;
};

async function metricValue(metric: Metric, id: string, f: string, t: string) {
  const db = getReefData();
  switch (metric) {
    case "max_dhw":
      return (await db.thermalSummary(id, f, t)).maxDhw;
    case "weeks_dhw_at_least_4":
      return (await db.thermalSummary(id, f, t)).weeksDhwAtLeast4;
    case "lionfish_sightings":
      return (await db.lionfishNear(id, 25, f, t)).count;
    case "storm_passes":
      return (await db.stormsNear(id, 150, f, t)).length;
    case "fishing_hours":
      return (await db.activity(id, f, t)).fishingHours;
  }
}

/** Run one tool call. Errors come back as { error } so Gemini can read them and retry. */
export async function runTool(name: string, args: Args): Promise<unknown> {
  const db = getReefData();
  try {
    switch (name) {
      case "get_thermal_summary":
        return await db.thermalSummary(str(args, "site_id"), str(args, "from"), str(args, "to"));
      case "get_storms_near":
        return { storms: await db.stormsNear(str(args, "site_id"), num(args, "max_km", 150), str(args, "from"), str(args, "to")) };
      case "get_lionfish_near":
        return await db.lionfishNear(str(args, "site_id"), num(args, "radius_km", 25), str(args, "from"), str(args, "to"));
      case "get_activity":
        return await db.activity(str(args, "site_id"), str(args, "from"), str(args, "to"));
      case "compare_sites": {
        const metric = str(args, "metric") as Metric;
        if (!METRICS.includes(metric)) throw new ReefDataError(`metric must be one of ${METRICS.join(", ")}.`);
        const f = str(args, "from");
        const t = str(args, "to");
        const sites = await db.listSites();
        const rows = await Promise.all(sites.map(async (s) => ({ site: s.name, siteId: s.id, value: await metricValue(metric, s.id, f, t) })));
        return { metric, from: f, to: t, ranking: rows.sort((x, y) => y.value - x.value) };
      }
      case "get_flagship_evidence":
        return flagshipEvidence(args);
      default:
        return { error: `Unknown tool "${name}".` };
    }
  } catch (e) {
    if (e instanceof ReefDataError) return { error: e.message };
    throw e;
  }
}
