import type { ReefData } from "./ReefData";
import { jsonReefData } from "./jsonReefData";

/** REEF_DATA=json (default) reads the bundled sample data. "tiger" is added when the database is ready. */
export function getReefData(): ReefData {
  const kind = process.env.REEF_DATA ?? "json";
  if (kind === "json") return jsonReefData;
  throw new Error(`REEF_DATA="${kind}" has no implementation yet. Use "json".`);
}

export * from "./ReefData";
