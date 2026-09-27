import "server-only";
import type { FunctionDeclaration } from "@google/genai";
import moorea from "@/data/flagships/moorea.json";
import lizard from "@/data/flagships/lizard-island.json";
import soneva from "@/data/flagships/soneva-fushi.json";
import { EVIDENCE_LABEL, formatYear, type Dossier } from "@/lib/flagships";

const DOSSIERS: Record<string, Dossier> = {
  moorea: moorea as unknown as Dossier,
  "lizard-island": lizard as unknown as Dossier,
  "soneva-fushi": soneva as unknown as Dossier,
};

export const flagshipToolDeclaration: FunctionDeclaration = {
  name: "get_flagship_evidence",
  description:
    "Evidence for one flagship reef (moorea, lizard-island, soneva-fushi) between two years: field survey values with their dates, satellite and on-reef heat peaks, cyclones, causes reported by the monitoring program, measured declines between consecutive surveys with what else was present in that interval, gaps with no data, and what is missing. Every item says its evidence type.",
  parametersJsonSchema: {
    type: "object",
    properties: {
      flagship_id: { type: "string", enum: Object.keys(DOSSIERS) },
      from_year: { type: "number", description: "Start year, inclusive, e.g. 2018. Default: start of the record." },
      to_year: { type: "number", description: "End year, inclusive, e.g. 2020. Default: end of the record." },
    },
    required: ["flagship_id"],
  },
};

/** A compact, spoken-answer-sized view of a dossier, limited to a window of years. */
export function flagshipEvidence(args: Record<string, unknown>) {
  const d = DOSSIERS[String(args.flagship_id)];
  if (!d) return { error: `flagship_id must be one of ${Object.keys(DOSSIERS).join(", ")}.` };
  const from = typeof args.from_year === "number" ? args.from_year : d.span[0];
  const to = (typeof args.to_year === "number" ? args.to_year : d.span[1]) + 0.999;
  const inWin = (t: number) => t >= from && t <= to;
  return {
    name: d.name,
    place: d.place,
    record: d.summary,
    window: `${Math.floor(from)} to ${Math.floor(to)}`,
    lanes: d.lanes.map((l) => {
      const pts = l.points.filter((p) => inWin(p[0]));
      const base = { lane: l.label, unit: l.unit, evidence: EVIDENCE_LABEL[l.evidence] };
      if (l.kind === "continuous") {
        if (!pts.length) return { ...base, values: "no data in window" };
        const peak = pts.reduce((m, p) => (p[1] > m[1] ? p : m));
        return { ...base, peak: peak[1], peakDate: formatYear(peak[0]), latest: pts[pts.length - 1][1], latestDate: formatYear(pts[pts.length - 1][0]) };
      }
      return { ...base, observations: pts.map((p) => ({ date: formatYear(p[0]), value: p[1] })) };
    }),
    changes: d.changes
      .filter((c) => c.t1 >= from && c.t0 <= to)
      .map((c) => ({ change: c.title, summary: c.summary, alsoInInterval: c.drivers.map((x) => `${x.driver}: ${x.presence} (${x.value}; ${EVIDENCE_LABEL[x.evidence]})`) })),
    events: d.events
      .filter((e) => inWin(e.t) && e.kind !== "survey")
      .map((e) => ({ date: formatYear(e.t), event: e.label, detail: e.detail, evidence: EVIDENCE_LABEL[e.evidence] })),
    gaps: d.gaps.filter((g) => g.t1 >= from && g.t0 <= to).map((g) => g.label),
    missing: d.missing.map((m) => m.title),
    lookAgain: d.next.map((n) => `${n.title}. ${n.detail}`),
  };
}
