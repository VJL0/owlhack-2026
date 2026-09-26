// One-line narration for the current moment, written from the data with the
// project's required wording (associations, sources, no causal claims).

import { lionfishNear, nearestActiveStorm, thermalAt } from "./data";
import { formatMonthLong, ymdToDay } from "./time";

const STATUS: Record<string, string> = {
  HU: "Hurricane",
  TS: "Tropical Storm",
  TD: "Tropical Depression",
  SS: "Subtropical Storm",
  SD: "Subtropical Depression",
  EX: "Post-tropical cyclone",
  LO: "Remnant low",
  DB: "Disturbance",
  WV: "Tropical wave",
};

const LOSS_FROM = ymdToDay(2023, 10, 1);
const LOSS_UNTIL = ymdToDay(2024, 9, 30);

export function stormLabel(status: string, name: string) {
  return `${STATUS[status] ?? "Storm"} ${name}`;
}

export function momentText(siteId: string, t: number): { key: string; text: string; note: string } {
  const month = formatMonthLong(t);
  const th = thermalAt(siteId, t);
  const storm = nearestActiveStorm(siteId, t, 250);
  if (storm) {
    return {
      key: `storm-${storm.storm.id}`,
      text: `${month}. ${stormLabel(storm.status, storm.storm.name)} is ${Math.round(storm.km)} km away, with ${Math.round(storm.wind)}-knot sustained winds.`,
      note: "NOAA NHC HURDAT2 best track",
    };
  }
  if (th.dhw >= 8) {
    return {
      key: "dhw8",
      text: `${month}. Heat stress has reached ${th.dhw.toFixed(1)} degree heating weeks. From 8, NOAA expects severe bleaching and significant mortality.`,
      note: "NOAA Coral Reef Watch 5 km, satellite sea-surface temperature",
    };
  }
  if (th.dhw >= 4) {
    return {
      key: "dhw4",
      text: `${month}. ${th.dhw.toFixed(1)} degree heating weeks. From 4, NOAA expects significant bleaching.`,
      note: "NOAA Coral Reef Watch 5 km",
    };
  }
  if (t >= LOSS_FROM && t <= LOSS_UNTIL) {
    return {
      key: "loss",
      text: `${month}. After the 2023 heatwave, 98 to 100 percent of elkhorn and staghorn colonies around the Keys and Dry Tortugas died.`,
      note: "Frontiers in Marine Science (2024). Coral shown is illustrative.",
    };
  }
  if (th.dhw > 0.5) {
    return {
      key: "dhw0",
      text: `${month}. Heat is accumulating: ${th.dhw.toFixed(1)} degree heating weeks.`,
      note: "NOAA Coral Reef Watch 5 km",
    };
  }
  const lf = lionfishNear(siteId, t).length;
  if (lf > 0) {
    return {
      key: "lionfish",
      text: `${month}. ${lf} lionfish record${lf === 1 ? "" : "s"} within 25 km over the past year.`,
      note: "USGS Nonindigenous Aquatic Species database",
    };
  }
  return {
    key: "calm",
    text: `${month}. Water ${th.sst.toFixed(1)} °C with no accumulated heat stress.`,
    note: "NOAA Coral Reef Watch 5 km",
  };
}
