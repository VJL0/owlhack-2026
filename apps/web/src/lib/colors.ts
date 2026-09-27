// Heat ramp for Degree Heating Weeks (°C-weeks). Breakpoints follow NOAA Coral
// Reef Watch's interpretation: 4 = significant bleaching likely, 8 = severe
// bleaching and significant mortality likely.
export const HEAT_STOPS: [number, string][] = [
  [0, "#4fd8cf"],
  [2, "#a6e8c2"],
  [4, "#ffd166"],
  [8, "#ff8a4c"],
  [12, "#ff4f6d"],
  [16, "#d93a9f"],
  [20, "#f4dcff"],
];

const hexToRgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];

export function heatRgb(dhw: number): [number, number, number] {
  const v = Math.max(0, dhw);
  for (let i = 0; i < HEAT_STOPS.length - 1; i++) {
    const [a, ca] = HEAT_STOPS[i];
    const [b, cb] = HEAT_STOPS[i + 1];
    if (v <= b) {
      const f = (v - a) / (b - a);
      const A = hexToRgb(ca);
      const B = hexToRgb(cb);
      return [A[0] + (B[0] - A[0]) * f, A[1] + (B[1] - A[1]) * f, A[2] + (B[2] - A[2]) * f];
    }
  }
  return hexToRgb(HEAT_STOPS[HEAT_STOPS.length - 1][1]);
}

export function heatColor(dhw: number) {
  const [r, g, b] = heatRgb(dhw);
  return `rgb(${r | 0}, ${g | 0}, ${b | 0})`;
}

// Lagoon water temperature (°C): weekly mean of each sensor's daily maximum.
export const LAGOON_STOPS: [number, string][] = [
  [26, "#4f96ff"],
  [28, "#4fd8cf"],
  [29.5, "#ffd166"],
  [30.5, "#ff8a4c"],
  [31.5, "#ff4f6d"],
];

export function lagoonTempRgb(v: number): [number, number, number] {
  if (v <= LAGOON_STOPS[0][0]) return hexToRgb(LAGOON_STOPS[0][1]);
  for (let i = 0; i < LAGOON_STOPS.length - 1; i++) {
    const [a, ca] = LAGOON_STOPS[i];
    const [b, cb] = LAGOON_STOPS[i + 1];
    if (v <= b) {
      const f = (v - a) / (b - a);
      const A = hexToRgb(ca);
      const B = hexToRgb(cb);
      return [A[0] + (B[0] - A[0]) * f, A[1] + (B[1] - A[1]) * f, A[2] + (B[2] - A[2]) * f];
    }
  }
  return hexToRgb(LAGOON_STOPS[LAGOON_STOPS.length - 1][1]);
}
