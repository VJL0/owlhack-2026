import { Color, MathUtils, Vector3, Vector4 } from "three";
import { lionfishNear, nearestActiveStorm, simulatedAt, thermalAt } from "@/lib/data";
import { clamp, smoothstep, ymdToDay } from "@/lib/time";

/** Uniforms shared by every reef material (same objects, so one write updates all). */
export const U = {
  uTime: { value: 0 },
  uCamPos: { value: new Vector3() },
  uFogDensity: { value: 0.05 },
  uWaterDeep: { value: new Color("#021423") },
  uWaterShallow: { value: new Color("#0c5a6e") },
  uSunDir: { value: new Vector3(0.3, 1, 0.2).normalize() },
  uSunColor: { value: new Color("#c8f6ff") },
  uHeat: { value: 0 },
  uStorm: { value: 0 },
  uBleach: { value: 0 },
  uFluor: { value: 0 },
  uDead: { value: 0 },
  uDim: { value: 0 },
  uSurfaceY: { value: 0 },
  /** Vessels overhead: (x, z, half length, half beam); z = 0 means unused. */
  uBoats: { value: Array.from({ length: 10 }, () => new Vector4()) },
};

/** Latest data-driven target, refreshed when the site or date changes. */
export const envNow: { target: EnvTarget | null } = { target: null };

// After the 2023 heatwave, 98–100% of elkhorn and staghorn colonies around the
// Keys and Dry Tortugas died (Frontiers in Marine Science, 2024).
const ACROPORA_LOSS_START = ymdToDay(2023, 9, 5);
const ACROPORA_LOSS_END = ymdToDay(2023, 10, 25);

export interface EnvTarget {
  dhw: number;
  heat: number;
  bleach: number;
  fluor: number;
  dead: number;
  storm: number;
  stormName: string | null;
  lionfish: number;
  vessels: number;
  fishingVessels: number;
  sar: number;
  sarUnmatched: number;
}

/** What the reef should look like at (site, t). Visual encoding of the data. */
export function envTarget(siteId: string, t: number): EnvTarget {
  const th = thermalAt(siteId, t);
  const storm = nearestActiveStorm(siteId, t, 400);
  const sim = simulatedAt(siteId, t);
  const dhw = th.dhw;
  return {
    dhw,
    heat: clamp(dhw / 16),
    // CRW: DHW ≥ 4 significant bleaching likely, ≥ 8 severe
    bleach: smoothstep(3, 11, dhw),
    // "colourful bleaching": fluorescent pigments under moderate stress
    fluor: smoothstep(1.5, 4.5, dhw) * (1 - smoothstep(7, 12, dhw)),
    dead: smoothstep(ACROPORA_LOSS_START, ACROPORA_LOSS_END, t),
    storm: storm ? clamp(storm.wind / 115) * Math.exp(-storm.km / 90) : 0,
    stormName: storm ? storm.storm.name : null,
    lionfish: lionfishNear(siteId, t).length,
    vessels: Math.round(clamp(sim.vesselHours30d / 45, 0, 6)),
    fishingVessels: Math.round(clamp(sim.fishingHours30d / 7, 0, 4)),
    sar: sim.sar90d,
    sarUnmatched: sim.sarUnmatched90d,
  };
}

const DEEP = new Color("#021423");
const SHALLOW = new Color("#0c5a6e");
const SHALLOW_HOT = new Color("#1f6b66");
const TURBID = new Color("#3c5b52");
const TURBID_DEEP = new Color("#0e1d1c");
const SUN = new Color("#c8f6ff");
const SUN_HOT = new Color("#ffd9a8");
const tmp = new Color();

/** Smoothly move the shared uniforms toward the target state. */
export function stepEnv(target: EnvTarget, dim: number, dt: number) {
  const k = 3.2;
  U.uHeat.value = MathUtils.damp(U.uHeat.value, target.heat, k, dt);
  U.uBleach.value = MathUtils.damp(U.uBleach.value, target.bleach, k, dt);
  U.uFluor.value = MathUtils.damp(U.uFluor.value, target.fluor, k, dt);
  U.uDead.value = MathUtils.damp(U.uDead.value, target.dead, k, dt);
  U.uStorm.value = MathUtils.damp(U.uStorm.value, target.storm, 2.2, dt);
  U.uDim.value = MathUtils.damp(U.uDim.value, dim, 2.5, dt);

  const heat = U.uHeat.value;
  const storm = U.uStorm.value;
  U.uSunColor.value.copy(SUN).lerp(SUN_HOT, heat * 0.85).multiplyScalar(1 - storm * 0.55);
  tmp.copy(SHALLOW).lerp(SHALLOW_HOT, heat * 0.6).lerp(TURBID, storm);
  U.uWaterShallow.value.copy(tmp);
  U.uWaterDeep.value.copy(DEEP).lerp(TURBID_DEEP, storm);
  U.uFogDensity.value = 0.042 + storm * 0.075 + heat * 0.006;
}
