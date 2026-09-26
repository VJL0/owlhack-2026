export { T_MAX, T_MIN, formatDate, ymdToDay } from "@/lib/time";

export function dhwLabel(dhw: number) {
  return `Heat stress ${dhw.toFixed(1)} degree heating weeks`;
}
