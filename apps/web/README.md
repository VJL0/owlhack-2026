# Reef Sentinel — web

A cinematic 3D journey into Florida's Coral Reef, 2016–2024: from the night side of the Earth, down the reef tract, into the water, and into the pressures acting on one reef.

```bash
pnpm install
pnpm dev            # http://localhost:3000 (copies Cesium into public/cesium first)
pnpm build          # static production build
pnpm data           # rebuild src/data/*.json from /data/raw
```

Deep link straight underwater: `/#reef=looe-key` (any site id from `src/data/sites.json`).

## The experience

| Moment | What happens | Built with |
| --- | --- | --- |
| Opening | The reef draws itself as a filament of light on the night side of the Earth, city lights come up, title reveals | CesiumJS, NASA Black Marble |
| Flight | Western Atlantic → Florida → the reef tract while dawn sweeps in | Cesium camera flights, animated sun |
| Region | Nine reef sites along the tract; hurricane tracks, lionfish records and sea-temperature anomaly follow the timeline | Cesium entities, NASA GIBS MUR tiles |
| Dive | Fly down to a reef, break the surface, reveal the reef underwater | CSS compositor animation over a lazy-loaded R3F scene |
| Reef | Spur-and-groove reef with seven procedural Florida taxa, fish schools, caustics, Snell's window, vessel shadows. Heat bleaches coral, storms stir the water, Acropora dies after the 2023 heatwave | React Three Fiber, custom GLSL, instancing, postprocessing |
| Pressure Constellation (`P`) | Heat, fishing, lionfish and hurricanes around the reef: size = magnitude, pulse = model importance, outer arcs = model interactions | R3F, DOM label layer |
| Timeline | Real DHW heat ribbon, hurricane passes, lionfish records; scrub, play (space), arrow keys | SVG |

Controls: `Space` play/pause time · `←/→` a week (`Shift` a month, `PgUp/PgDn` a year) · `P` pressures · `Esc` close / return to surface. "Reduce motion" (top right) follows the OS setting and can be switched for demos.

## Data and honesty

Every number on screen carries a glyph: ● observed, ◌ model output, ⊘ simulated.

| Layer | Source | Kind |
| --- | --- | --- |
| Degree Heating Weeks, SST, anomaly, alert level (9 sites, weekly) | NOAA Coral Reef Watch 5 km via PacIOOS ERDDAP | observed |
| Hurricane tracks, closest approach per site | NOAA NHC HURDAT2 (2025 release) | observed / derived |
| Lionfish records within 25 km | USGS Nonindigenous Aquatic Species | observed |
| Sea-temperature anomaly map (from July 2019) | NASA JPL MUR via GIBS | observed |
| AIS fishing effort, vessel presence, SAR detections | Seeded simulation shaped by real seasons (lobster, stone crab, COVID cruise halt) | simulated — replace with Global Fishing Watch |
| Bleaching probability, contributions, interactions | Demo logistic model with hand-set weights; exact Shapley values against a mean baseline | model — replace with XGBoost + TreeSHAP |

Coral appearance is a visualization of DHW using NOAA's published thresholds (4 = significant bleaching likely, 8 = severe bleaching and mortality likely), not a survey observation. The post-2023 Acropora loss follows the documented 98–100% elkhorn/staghorn mortality in the Keys and Dry Tortugas.

## Where the backend plugs in

`src/lib/data.ts` and `src/lib/model.ts` define the shapes the UI consumes:

- `FeatureSnapshot` mirrors one row of `reef_feature_snapshots`
- `ModelOutput` = `{ probability, baseProbability, magnitude, shap, contributionPP, interaction }`

Swap `snapshot()` / `predict()` for calls to `GET /api/v1/reefs/{id}/pressures` and `/prediction` and the constellation, gauges and evidence panel keep working.

## Layout

```
src/
  app/                 layout, fonts, design tokens (globals.css)
  features/
    experience/        phase orchestration, keys, deep link
    globe/             Cesium loader + imperative controller, starfield
    dive/              globe ↔ reef crossing
    reef/              R3F scene: terrain, corals, fish, lionfish, traffic,
                       environment, constellation, camera rig, effects, labels
    hud/               region/reef HUDs, evidence slate, pressure index
    timeline/          time-travel control
  lib/                 data access, demo model, store, narrative, colours
  data/                generated JSON (committed; app runs offline except map tiles)
scripts/               copy-cesium.mjs, build-data.mjs
```
