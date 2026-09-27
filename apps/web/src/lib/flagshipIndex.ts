import type { FlagshipSummary } from "./flagships";

/**
 * The four places the atlas opens onto. Each one answers a different part of
 * the same problem: reefs change between the few times anyone looks at them.
 */
export const FLAGSHIPS: FlagshipSummary[] = [
  {
    id: "moorea",
    name: "Moorea",
    place: "French Polynesia",
    lat: -17.535,
    lon: -149.835,
    role: "Understand the past",
    question: "What happened between surveys?",
    blurb: "Twenty-one years of coral, fish and starfish surveys at the same permanent sites, with thermistors on the reef.",
    record: "2005–2025 · field surveys and reef sensors",
  },
  {
    id: "lizard-island",
    name: "Lizard Island",
    place: "Great Barrier Reef, Australia",
    lat: -14.67,
    lon: 145.46,
    role: "Detect what's happening",
    question: "Which pressures overlapped?",
    blurb: "Forty years of AIMS surveys through starfish outbreaks, cyclones and heat, with the program's own record of what caused each loss.",
    record: "1985–2026 · field surveys and reported causes",
  },
  {
    id: "soneva-fushi",
    name: "Soneva Fushi",
    place: "Baa Atoll, Maldives",
    lat: 5.112,
    lon: 73.075,
    role: "See the change",
    question: "What does change look like in 3D?",
    blurb: "Twenty-three real 3D surveys of six plots on one reef, aligned so every colony stays in place from date to date.",
    record: "2025–2026 · underwater photogrammetry",
  },
  {
    id: "florida",
    name: "Florida's Coral Reef",
    place: "Florida Keys, USA",
    lat: 24.75,
    lon: -81.1,
    role: "Pressures in motion",
    question: "What is acting on the reef right now?",
    blurb: "Nine reef sites with satellite heat stress, hurricane tracks and lionfish records, and an underwater scene driven by them.",
    record: "2016–2024 · satellite, storm tracks and sightings",
  },
];

export const flagshipById = (id: string) => FLAGSHIPS.find((f) => f.id === id);
