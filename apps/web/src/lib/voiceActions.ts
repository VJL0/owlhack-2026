// Page actions the voice agent can ask for. The server validates them;
// the browser runs them through the same store calls a click would make.

export type Lang = "en" | "es";

export const MAP_LAYERS = ["sst", "storms", "lionfish"] as const;
export type MapLayer = (typeof MAP_LAYERS)[number];

export type UiAction =
  | { type: "go_to_reef"; siteId: string }
  | { type: "go_to_map" }
  | { type: "set_date"; date: string } // YYYY-MM-DD
  | { type: "set_layer"; layer: MapLayer; on: boolean }
  | { type: "set_playing"; playing: boolean };
