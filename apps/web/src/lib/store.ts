"use client";

import { create } from "zustand";
import { T_DEFAULT, T_MAX, T_MIN, clamp } from "./time";
import type { Pair, Pressure } from "./model";
import type { Lang } from "./voiceActions";
import type { FlagshipId } from "./flagships";

export type Phase =
  | "boot" // loading the globe
  | "intro" // title card over the Earth
  | "world" // the whole Earth: flagship reefs and global heat stress
  | "flagship" // one flagship reef's evidence dossier (Moorea, Lizard Island, Soneva Fushi)
  | "splat" // inside a real photogrammetric 3D survey (Soneva Fushi)
  | "flying" // Earth → Florida flight
  | "region" // Florida's Coral Reef overview
  | "diving" // flying down to a reef site
  | "reef" // underwater
  | "ascending"; // back to the region view

export type Selection = { kind: "pressure"; id: Pressure } | { kind: "pair"; id: Pair } | null;

interface State {
  phase: Phase;
  siteId: string;
  t: number;
  playing: boolean;
  pressuresOpen: boolean;
  selection: Selection;
  hover: Selection;
  caption: { key: string; text: string } | null;
  reducedMotion: boolean;
  /** Dive overlay stage while crossing between globe and reef. */
  crossing: "none" | "plunge" | "surface";
  /** The reef scene has compiled and drawn its first frames. */
  reefReady: boolean;
  layers: { sst: boolean; storms: boolean; lionfish: boolean; ais: boolean };
  /** Spoken guide: narrates each scene on arrival. Off unless the viewer turns it on. */
  guide: boolean;
  /** Language for the guide and voice answers. */
  lang: Lang;
  /** The flagship reef being viewed (world, flagship and splat phases). */
  flagshipId: Exclude<FlagshipId, "florida"> | null;
  /** Flagship hovered in the world view (the globe turns toward it). */
  flagshipHover: FlagshipId | null;
  /** Cursor on the flagship evidence timeline, as a decimal year. */
  flagshipT: number | null;
  /** Year of the global heat-stress layer (2021–2025). */
  worldYear: number;
  /** Soneva plot shown in 3D, and which of its surveys. */
  splatPlot: string;
  splatIndex: number;

  setPhase: (p: Phase) => void;
  setSite: (id: string) => void;
  setT: (t: number) => void;
  nudgeT: (dt: number) => void;
  setPlaying: (v: boolean) => void;
  setPressuresOpen: (v: boolean) => void;
  select: (s: Selection) => void;
  setHover: (s: Selection) => void;
  setCaption: (c: { key: string; text: string } | null) => void;
  setReducedMotion: (v: boolean) => void;
  setCrossing: (c: State["crossing"]) => void;
  setReefReady: (v: boolean) => void;
  toggleLayer: (k: keyof State["layers"]) => void;
  setGuide: (v: boolean) => void;
  setLang: (l: Lang) => void;
  openFlagship: (id: Exclude<FlagshipId, "florida">) => void;
  setFlagshipHover: (id: FlagshipId | null) => void;
  setFlagshipT: (t: number | null) => void;
  setWorldYear: (y: number) => void;
  setSplat: (plot: string, index?: number) => void;
}

export const useStore = create<State>((set) => ({
  phase: "boot",
  siteId: "looe-key",
  t: T_DEFAULT,
  playing: false,
  pressuresOpen: false,
  selection: null,
  hover: null,
  caption: null,
  reducedMotion: false,
  crossing: "none",
  reefReady: false,
  layers: { sst: true, storms: true, lionfish: true, ais: false },
  guide: false,
  lang: "en",
  flagshipId: null,
  flagshipHover: null,
  flagshipT: null,
  worldYear: 2024,
  splatPlot: "ootsl1",
  splatIndex: 0,

  setPhase: (phase) => set({ phase }),
  setSite: (siteId) => set({ siteId }),
  setT: (t) => set({ t: clamp(t, T_MIN, T_MAX) }),
  nudgeT: (dt) => set((s) => ({ t: clamp(s.t + dt, T_MIN, T_MAX) })),
  setPlaying: (playing) => set({ playing }),
  setPressuresOpen: (pressuresOpen) => set(pressuresOpen ? { pressuresOpen } : { pressuresOpen, selection: null, hover: null }),
  select: (selection) => set({ selection }),
  setHover: (hover) => set({ hover }),
  setCaption: (caption) => set({ caption }),
  setReducedMotion: (reducedMotion) => set({ reducedMotion }),
  setCrossing: (crossing) => set({ crossing }),
  setReefReady: (reefReady) => set({ reefReady }),
  toggleLayer: (k) => set((s) => ({ layers: { ...s.layers, [k]: !s.layers[k] } })),
  setGuide: (guide) => set({ guide }),
  setLang: (lang) => set({ lang }),
  openFlagship: (flagshipId) => set({ flagshipId, flagshipT: null, phase: "flagship" }),
  setFlagshipHover: (flagshipHover) => set({ flagshipHover }),
  setFlagshipT: (flagshipT) => set({ flagshipT }),
  setSplat: (splatPlot, splatIndex = 0) => set({ splatPlot, splatIndex }),
  setWorldYear: (worldYear) => set({ worldYear: Math.min(2025, Math.max(2021, Math.round(worldYear))) }),
}));
