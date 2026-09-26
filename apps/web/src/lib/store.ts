"use client";

import { create } from "zustand";
import { T_DEFAULT, T_MAX, T_MIN, clamp } from "./time";
import type { Pair, Pressure } from "./model";

export type Phase =
  | "boot" // loading the globe
  | "intro" // title card over the Earth
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
}));
