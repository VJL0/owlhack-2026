import type { Provenance } from "./data";
import type { Pair, Pressure } from "./model";

export interface PressureDef {
  id: Pressure;
  name: string;
  /** What the magnitude measures, in plain words. */
  measure: string;
  color: string;
  provenance: Provenance;
  source: string;
  /** Required scientific wording for this pressure. */
  caveat: string;
}

export const PRESSURE_DEFS: Record<Pressure, PressureDef> = {
  heat: {
    id: "heat",
    name: "Heat stress",
    measure: "Maximum Degree Heating Weeks over the previous 84 days",
    color: "#ff8a4c",
    provenance: "observed",
    source: "NOAA Coral Reef Watch 5 km",
    caveat: "Satellite sea-surface temperature, not in-situ reef temperature.",
  },
  fishing: {
    id: "fishing",
    name: "Fishing activity",
    measure: "AIS-observed fishing hours within 10 km, previous 90 days",
    color: "#8fd3ff",
    provenance: "simulated",
    source: "Simulated (Global Fishing Watch not yet connected)",
    caveat: "AIS misses many small vessels, so this is AIS-observed effort, not total fishing.",
  },
  lionfish: {
    id: "lionfish",
    name: "Invasive lionfish",
    measure: "Lionfish records within 25 km, previous 12 months",
    color: "#ff5f8f",
    provenance: "observed",
    source: "USGS Nonindigenous Aquatic Species",
    caveat: "Records mark where lionfish were reported nearby, not where individual fish are.",
  },
  storm: {
    id: "storm",
    name: "Hurricane exposure",
    measure: "Strongest storm within 150 km, previous 12 months, weighted by distance",
    color: "#b8a8ff",
    provenance: "observed",
    source: "NOAA NHC HURDAT2 best track",
    caveat: "Best-track winds describe the storm, not conditions measured on the reef.",
  },
};

export const PAIR_DEFS: Record<Pair, { name: string; question: string }> = {
  "heat:fishing": {
    name: "Heat and fishing",
    question: "Does the model score heat stress as worse where AIS-observed fishing effort is also high?",
  },
  "heat:storm": {
    name: "Heat and hurricanes",
    question: "Does the model score heat stress as worse where a strong storm passed nearby in the same year?",
  },
  "fishing:lionfish": {
    name: "Fishing and lionfish",
    question: "Does the model treat fishing activity and nearby lionfish records as reinforcing each other?",
  },
};

/** Plain-language reading of an interaction value at this moment. */
export function pairReading(value: number) {
  if (Math.abs(value) < 0.05) return "Not much right now: these two pressures barely coincide here, so the combined term adds almost nothing.";
  if (value > 0)
    return `Yes, right now: both are above their usual levels, and the model adds ${value.toFixed(2)} log-odds on top of their separate effects.`;
  return `Not right now: at least one of the two is below its usual level, so the combined term lowers the score by ${Math.abs(value).toFixed(2)} log-odds.`;
}

export const PROVENANCE_LABEL: Record<Provenance, string> = {
  observed: "Observed",
  derived: "Derived",
  model: "Model output",
  simulated: "Simulated",
};
