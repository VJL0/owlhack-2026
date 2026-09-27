import type { FunctionDeclaration } from "@google/genai";
import { SITES } from "@/lib/data";
import { MAP_LAYERS, type MapLayer, type UiAction } from "@/lib/voiceActions";

// Tools that move the page instead of reading data. The server only checks them;
// the browser runs them after the answer arrives (see lib/navigation.ts).

export const pageToolDeclarations: FunctionDeclaration[] = [
  {
    name: "go_to_reef",
    description: "Dive into one reef's underwater view. Use for 'take me to X', 'go to X', 'show me X'.",
    parametersJsonSchema: {
      type: "object",
      properties: { site_id: { type: "string", enum: SITES.map((s) => s.id) } },
      required: ["site_id"],
    },
  },
  {
    name: "go_to_map",
    description: "Leave the reef and rise back to the map of all reefs. Use for 'go back', 'take me up', 'show the map'.",
    parametersJsonSchema: { type: "object", properties: {} },
  },
  {
    name: "set_date",
    description: "Move the timeline to a date between 2016-01-01 and 2024-12-31. For a month, use its 15th day.",
    parametersJsonSchema: {
      type: "object",
      properties: { date: { type: "string", description: "YYYY-MM-DD" } },
      required: ["date"],
    },
  },
  {
    name: "set_layer",
    description:
      "Show or hide a map layer: sst = sea temperature anomaly, storms = hurricane tracks, lionfish = lionfish records. Layers only show on the map, not underwater.",
    parametersJsonSchema: {
      type: "object",
      properties: { layer: { type: "string", enum: [...MAP_LAYERS] }, on: { type: "boolean" } },
      required: ["layer", "on"],
    },
  },
  {
    name: "go_to_flagship",
    description:
      "Open a flagship reef: moorea, lizard-island or soneva-fushi (evidence dossier), or florida (the nine-reef map). Use for 'take me to Moorea', 'show me Lizard Island'.",
    parametersJsonSchema: {
      type: "object",
      properties: { flagship_id: { type: "string", enum: ["moorea", "lizard-island", "soneva-fushi", "florida"] } },
      required: ["flagship_id"],
    },
  },
  {
    name: "go_to_world",
    description: "Pull back to the whole globe with all flagship reefs. Use for 'show the world', 'all reefs', 'start over'.",
    parametersJsonSchema: { type: "object", properties: {} },
  },
  {
    name: "set_flagship_date",
    description: "Move the evidence timeline cursor of the open flagship dossier to a date (YYYY-MM-DD). Use when the viewer asks to look at a year there.",
    parametersJsonSchema: { type: "object", properties: { date: { type: "string", description: "YYYY-MM-DD" } }, required: ["date"] },
  },
  {
    name: "set_playing",
    description: "Play or pause the timeline animation through time.",
    parametersJsonSchema: { type: "object", properties: { playing: { type: "boolean" } }, required: ["playing"] },
  },
];

const NAMES = new Set(pageToolDeclarations.map((d) => d.name));
export const isPageTool = (name: string) => NAMES.has(name);

/** Check arguments and turn a call into a UiAction, or explain what is wrong. */
export function toAction(name: string, a: Record<string, unknown>): UiAction | { error: string } {
  switch (name) {
    case "go_to_reef": {
      const id = a.site_id;
      if (typeof id !== "string" || !SITES.some((s) => s.id === id)) return { error: `Unknown site_id "${String(id)}".` };
      return { type: "go_to_reef", siteId: id };
    }
    case "go_to_map":
      return { type: "go_to_map" };
    case "set_date": {
      const d = a.date;
      if (typeof d !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(d) || d < "2016-01-01" || d > "2024-12-31")
        return { error: "date must be YYYY-MM-DD between 2016-01-01 and 2024-12-31." };
      return { type: "set_date", date: d };
    }
    case "set_layer": {
      if (!MAP_LAYERS.includes(a.layer as MapLayer) || typeof a.on !== "boolean") return { error: `layer must be one of ${MAP_LAYERS.join(", ")}; on must be true or false.` };
      return { type: "set_layer", layer: a.layer as MapLayer, on: a.on };
    }
    case "set_playing":
      if (typeof a.playing !== "boolean") return { error: "playing must be true or false." };
      return { type: "set_playing", playing: a.playing };
    case "go_to_flagship": {
      const id = a.flagship_id;
      if (id !== "moorea" && id !== "lizard-island" && id !== "soneva-fushi" && id !== "florida") return { error: `Unknown flagship_id "${String(id)}".` };
      return { type: "go_to_flagship", flagshipId: id };
    }
    case "go_to_world":
      return { type: "go_to_world" };
    case "set_flagship_date": {
      const d = a.date;
      if (typeof d !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(d) || d < "1985-01-01" || d > "2026-12-31") return { error: "date must be YYYY-MM-DD between 1985-01-01 and 2026-12-31." };
      return { type: "set_flagship_date", date: d };
    }
  }
  return { error: `Unknown page tool "${name}".` };
}
