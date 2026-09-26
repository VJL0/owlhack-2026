// Demo stand-in for the XGBoost bleaching model + TreeSHAP.
//
// It is a logistic model with three pairwise interaction terms and hand-set
// weights (not trained). Its Shapley values are computed exactly against a
// baseline (the mean feature vector across all sites and months), so the UI can
// be built against the same shape the real API will return:
//   probability, base value, per-pressure contributions, pairwise interactions.

import { SITES, snapshot, type FeatureSnapshot } from "./data";
import { clamp, T_MAX } from "./time";

export type Pressure = "heat" | "fishing" | "lionfish" | "storm";
export const PRESSURES: Pressure[] = ["heat", "fishing", "lionfish", "storm"];

export type Pair = "heat:fishing" | "heat:storm" | "fishing:lionfish";
export const PAIRS: Pair[] = ["heat:fishing", "heat:storm", "fishing:lionfish"];

const W = {
  bias: -2.4,
  heat: 4.1,
  fishing: 0.9,
  lionfish: 0.6,
  storm: 1.1,
  "heat:fishing": 0.9,
  "heat:storm": 1.4,
  "fishing:lionfish": 0.5,
} as const;

/** Normalised pressure magnitudes (0 ≈ none, 1 ≈ strong). */
export function pressureVector(s: FeatureSnapshot): Record<Pressure, number> {
  const stormProx = s.stormNearestKm365d == null ? 0 : Math.exp(-s.stormNearestKm365d / 120);
  return {
    heat: clamp(s.maxDhw84d / 12, 0, 1.6),
    fishing: clamp(s.fishingHours90d / 60, 0, 1.5),
    lionfish: clamp(s.lionfish365d / 8, 0, 1.5),
    storm: clamp((s.stormMaxWind365d / 130) * stormProx, 0, 1.2),
  };
}

let baseline: Record<Pressure, number> | null = null;
function getBaseline() {
  if (baseline) return baseline;
  const acc: Record<Pressure, number> = { heat: 0, fishing: 0, lionfish: 0, storm: 0 };
  let n = 0;
  for (const site of SITES) {
    for (let t = 15; t < T_MAX; t += 30.4) {
      const v = pressureVector(snapshot(site.id, t));
      for (const k of PRESSURES) acc[k] += v[k];
      n++;
    }
  }
  for (const k of PRESSURES) acc[k] /= n;
  baseline = acc;
  return acc;
}

function logit(x: Record<Pressure, number>) {
  return (
    W.bias +
    W.heat * x.heat +
    W.fishing * x.fishing +
    W.lionfish * x.lionfish +
    W.storm * x.storm +
    W["heat:fishing"] * x.heat * x.fishing +
    W["heat:storm"] * x.heat * x.storm +
    W["fishing:lionfish"] * x.fishing * x.lionfish
  );
}

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

export interface ModelOutput {
  probability: number;
  baseProbability: number;
  magnitude: Record<Pressure, number>;
  /** Shapley values in log-odds. */
  shap: Record<Pressure, number>;
  /** Shapley values re-expressed as percentage points of probability. */
  contributionPP: Record<Pressure, number>;
  /** Pure pairwise interaction effects in log-odds. */
  interaction: Record<Pair, number>;
}

export function predict(s: FeatureSnapshot): ModelOutput {
  const x = pressureVector(s);
  const x0 = getBaseline();
  const shap: Record<Pressure, number> = { heat: 0, fishing: 0, lionfish: 0, storm: 0 };
  for (const k of PRESSURES) shap[k] = W[k] * (x[k] - x0[k]);
  const interaction = {} as Record<Pair, number>;
  for (const pair of PAIRS) {
    const [a, b] = pair.split(":") as [Pressure, Pressure];
    const w = W[pair];
    // exact Shapley split of w·xa·xb against baseline x0
    shap[a] += 0.5 * w * (x[a] - x0[a]) * (x[b] + x0[b]);
    shap[b] += 0.5 * w * (x[b] - x0[b]) * (x[a] + x0[a]);
    interaction[pair] = w * (x[a] - x0[a]) * (x[b] - x0[b]);
  }
  const z = logit(x);
  const z0 = logit(x0);
  const p = sigmoid(z);
  const p0 = sigmoid(z0);
  // share the probability change in proportion to the log-odds attributions
  const total = z - z0;
  const contributionPP = {} as Record<Pressure, number>;
  for (const k of PRESSURES) contributionPP[k] = total === 0 ? 0 : ((p - p0) * shap[k] * 100) / total;
  return { probability: p, baseProbability: p0, magnitude: x, shap, contributionPP, interaction };
}
