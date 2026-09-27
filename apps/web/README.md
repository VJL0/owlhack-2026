# Reef Atlas — web

A cinematic 3D journey into Florida's Coral Reef, 2016–2024: from the night side of the Earth, down the reef tract, into the water, and into the pressures acting on one reef.

```bash
pnpm install
pnpm dev            # http://localhost:3000 (copies Cesium into public/cesium first)
pnpm build          # Next.js production build + Speech Engine server bundle
pnpm data           # rebuild the Florida bundle from /data/raw into data/build/atlas
pnpm db:atlas       # load data/build/atlas into Tiger Cloud and verify the read-back
```

All data is read from Tiger Cloud at runtime (`TIGER_DATABASE_URL` in `.env.local`);
the repository holds no JSON or CSV copies. See [`database/README.md`](database/README.md).

Deep link straight underwater: `/#reef=looe-key` (any site id in `reef_data.florida_sites`).

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

Controls: `Space` play/pause time · `←/→` a week (`Shift` a month, `PgUp/PgDn` a year) · `P` pressures · `Esc` close / return to surface. Motion follows the OS "reduce motion" setting.

## Data and honesty

Every number on screen carries a glyph: ● observed, ◌ model output, ⊘ simulated.

| Layer | Source | Kind |
| --- | --- | --- |
| World view: peak heat stress per reef, 1985–2025, and forecast 2027–2031 with back-tested skill | supplied heat history (each value labelled observed or estimated) and ridge-model forecast | observed / estimated / model |
| Degree Heating Weeks, SST, anomaly, alert level (9 sites, weekly) | NOAA Coral Reef Watch 5 km via PacIOOS ERDDAP | observed |
| Hurricane tracks, closest approach per site | NOAA NHC HURDAT2 (2025 release) | observed / derived |
| Lionfish records within 25 km | USGS Nonindigenous Aquatic Species | observed |
| Sea-temperature anomaly map (from July 2019) | NASA JPL MUR via GIBS | observed |
| AIS fishing effort, vessel presence, SAR detections | Seeded simulation shaped by real seasons (lobster, stone crab, COVID cruise halt) | simulated — replace with Global Fishing Watch |
| Bleaching probability, contributions, interactions | Demo logistic model with hand-set weights; exact Shapley values against a mean baseline | model — replace with XGBoost + TreeSHAP |

Coral appearance is a visualization of DHW using NOAA's published thresholds (4 = significant bleaching likely, 8 = severe bleaching and mortality likely), not a survey observation. The post-2023 Acropora loss follows the documented 98–100% elkhorn/staghorn mortality in the Keys and Dry Tortugas.

## Where the backend plugs in

The Florida data already comes from Tiger (`/api/atlas/florida`, loaded once by
`FloridaGate` before the experience starts). `src/lib/data.ts` and
`src/lib/model.ts` define the shapes the UI consumes:

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
  lib/                 data access, atlasClient (reads /api/atlas), demo model, store,
                       narrative, colours
  lib/server/          server-only Tiger queries (atlas, explorer)
database/              migrations, dataset allowlist, atlas read/load code, CSV rebuilder
scripts/               copy-cesium, build-data, build-flagships, import-tiger, import-atlas
```

## Deployment

Production runs on Vultr behind Caddy at https://reefatlas.us. See [`infra/README.md`](../../infra/README.md). Smoke-test the production stack locally with `docker compose -f infra/compose.yaml -f infra/compose.local.yaml up --build`.

## Voice development

The existing Gemini agent is voiced by ElevenLabs Speech Engine. Set the
server-only keys and engine ID in `.env.local` (see `.env.example`), then run
`pnpm speech:dev` alongside `pnpm dev`. ElevenLabs needs a public WebSocket URL
for that service. See [Speech Engine setup](../../infra/README.md#speech-engine-gemini-remains-the-agent)
for engine creation, a development tunnel, and Vultr deployment.

`pnpm test:voice` checks streaming, tool preservation, interruption and typed fallback.
It reads Tiger through `.env.local`, because the agent's data tools are SQL queries.
