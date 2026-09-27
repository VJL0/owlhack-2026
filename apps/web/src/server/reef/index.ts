import type { ReefData } from "./ReefData";
import { tigerReefData } from "./tigerReefData";

/** The voice agent's data tools, answered from Tiger Cloud. */
export function getReefData(): ReefData {
  return tigerReefData;
}

export * from "./ReefData";
