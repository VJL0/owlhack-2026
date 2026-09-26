# OwlHacks 2026 / Reef Sentinel — Full Working Context Export

Export date: 2026-09-26

This file captures the visible project context from the current conversation: hackathon details, tracks, sponsor prizes, data sources, project direction, architecture decisions, ML strategy, and frontend/3D UX direction.

It does **not** include hidden system/developer instructions or private chain-of-thought reasoning.

---

## 1. OwlHacks 2026 Event Context

**Event:** OwlHacks 2026  
**Dates:** September 26–27, 2026  
**Location:** Temple University, 1925 N. 12th St., Philadelphia, PA 19122  
**Format:** In person  
**Duration:** 30 hours

Primary site:
- https://www.owlhacks.com

Devpost:
- https://owlhacks-2026.devpost.com/

MLH prize page:
- https://www.mlh.com/events/owlhacks-e2/prizes

### 2026 Tracks

#### Health and Wellness
Build technology that helps people feel better and addresses real-world health challenges, including physical fitness, mental health, and community medical care.

#### Philly Special
Wildcard track. The organizers explicitly gave a Schuylkill riverfront water-quality tracker as an example. The track is for ideas that do not fit neatly elsewhere and should showcase creativity and Philadelphia relevance.

#### Human-Computer Interaction (HCI)
Build intuitive interfaces, accessible designs, or novel ways for humans to interact with digital systems. Emphasis on accessible, seamless interaction.

#### AI & Agents
Build agents or intelligent tools that can think and act on their own and push the boundaries of what is possible.

#### Sustainability
Build solutions that support the planet, including clean energy, conservation, marine protection, and related environmental challenges.

---

## 2. Sponsor Prize Context

Primary source:
- https://www.mlh.com/events/owlhacks-e2/prizes

### ElevenLabs
**Prize:** Wireless Earbuds  
**Challenge:** Best Use of ElevenLabs

MLH emphasizes natural, dynamic, emotionally expressive audio and specifically encourages fully autonomous audio experiences.

Potential use in project:
- Real-time voice interface
- Automatic spoken reef briefings
- Narrated "reef story" mode
- Accessible audio interaction

### Gemini API
**Prize:** MLH Swag Kits  
**Challenge:** Best Use of Gemini API

Potential use:
- Agent orchestration
- Tool calling
- Grounded explanations
- Structured reef-event summaries
- Generating structured story scripts for the frontend

### Solana
**Prize:** Ledger Nano S Plus  
**Challenge:** Best Use of Solana

Potential use cases listed by MLH:
- High-frequency transactions
- DeFi
- Payments
- Supply chain
- Identity

Current conclusion:
- Do **not** force Solana into this project unless a legitimate transaction/identity use case emerges.

### Tiger Data
**Prize:** Stream Deck Mini  
**Challenge:** Best Use of Tiger Data

MLH explicitly emphasizes:
- Standard SQL
- High-frequency metrics
- Real-time data
- Time-series analytics
- Continuous Aggregates
- Compression
- AI-driven analytics dashboards
- Prediction engines
- IoT monitoring

Current conclusion:
- Tiger Data is one of the strongest sponsor fits for the project.
- Use TimescaleDB + PostGIS + H3 capabilities.
- Use hypertables, continuous aggregates, and historical columnstore where appropriate.

### Presage
**Prize:** Fitbit Inspire + Presage perks  
**Challenge:** Best Use of Presage

Focused on:
- Camera-based vital signs
- Breathing
- Emotion
- Focus
- Engagement

Current conclusion:
- Does not naturally fit the reef project.

### Vultr
**Prize:** Portable Screens  
**Challenge:** Best Use of Vultr

Potential use:
- Host production web app
- Host API
- Host background worker
- No need for GPU unless justified

### Snowflake
**Prize:** Raspberry Pi 4  
**Challenge:** Best Use of Snowflake API

Potential use:
- Snowflake APIs
- LLM/RAG applications

Current conclusion:
- Avoid duplicating Tiger Data with Snowflake unless there is a clear reason.

### GoDaddy Registry
**Prize:** Digital Gift Card  
**Challenge:** Best Domain Name from GoDaddy Registry

Potential use:
- Register a polished production domain
- Point it to Vultr
- Use Caddy for HTTPS

---

## 3. Original Direction Considered: RiverTwin / RiverTwin Sentinel

The first major project direction was a Philadelphia waterway intelligence platform.

### RiverTwin Concept

An AI-powered digital twin of Philadelphia waterways that:
- Ingests real USGS river data
- Stores time-series data in Tiger Data
- Forecasts dissolved oxygen
- Detects anomalies
- Uses Gemini for grounded explanations
- Uses ElevenLabs for RiverCast audio
- Deploys to Vultr
- Uses an interactive map

### RiverTwin Sentinel Upgrade

The idea was upgraded into an autonomous waterway intelligence system that:
- Observes
- Detects
- Forecasts
- Investigates
- Explains

Core loop:

OBSERVE → DETECT → FORECAST → INVESTIGATE → EXPLAIN

Primary track:
- Philly Special

Natural additional fits:
- Sustainability
- AI & Agents
- HCI

Primary data:
- USGS modern OGC Water Data API
- NWS
- Philadelphia GIS
- Philadelphia Water Department context

Primary model:
- Schuylkill dissolved oxygen +1h/+3h/+6h

Important scientific decisions:
- Do not call stale data "live"
- Show freshness and provisional status
- Do not claim raw river measurements mean water is safe/unsafe
- Use PWD RiverCast/CSOcast for official recreational guidance
- Use XGBoost + TreeSHAP for predictions/explanations
- Gemini only translates verified evidence; it does not create the science

### Why the team moved away from this

Teammates proposed a broader marine ecology concept focusing on multiple pressures harming species and coral reefs:
- Fishing / boats
- Invasive species
- Temperature
- Ocean events
- Natural disturbances

That direction has a higher technical ceiling and better multi-factor ecology story.

---

## 4. Current Team Direction: Multi-Factor Coral Reef Health

### Team-provided datasets and links

Kaggle coral reef dataset:
- https://www.kaggle.com/datasets/bowiechong/coral-reef

NOAA Digital Corals:
- https://coralreef.noaa.gov/digital-corals/data/results

NCEI:
- https://www.ncei.noaa.gov/

Global Fishing Watch:
- https://globalfishingwatch.org/

### Tentative team goal

"Boats and invasive species"

"Create smaller dataset in SQL and use that to compare."

"Connection of Health of coral reefs to overfishing, temperature, ocean events (invasive species)"

### Refined interpretation

The project is better framed as:

**Multi-factor ecological pressure analysis**

Rather than only:
- boats + invasive species

Use four pressure categories:

#### Climate / Ocean
- Sea surface temperature
- SST anomaly
- Degree Heating Weeks
- Bleaching alerts

#### Human
- AIS-observed fishing effort
- Vessel presence
- SAR vessel detections

#### Biological
- Invasive lionfish
- Reef fish changes

#### Natural Disturbance
- Hurricanes / tropical cyclones

This makes the project scientifically clearer.

---

## 5. Current Recommended Project

# Reef Sentinel

### Core concept

**Reef Sentinel fuses coral-health observations with heat stress, fishing/vessel activity, invasive species, and major natural disturbances to identify reefs experiencing compound pressure and explain which factors are most associated with observed damage.**

Important wording:
- Use "associated with"
- Do not imply causation unless the data support causal inference

### Why this is stronger

It combines:
- Marine ecology
- Multi-source data engineering
- Geospatial joins
- Time-series analytics
- Remote sensing
- Machine learning
- Explainability
- Agentic investigation
- Creative HCI
- 3D storytelling

### Best pilot region

**Florida Reef Tract**

Reason:
- Strong overlap of authoritative, georeferenced, time-aligned data
- NOAA reef surveys
- NOAA Coral Reef Watch
- Global Fishing Watch
- USGS / NOAA lionfish data
- NOAA hurricane data

Do not start global for the hackathon.

Pitch future expansion:
- Puerto Rico
- US Virgin Islands
- Hawaii
- Global coral systems

---

## 6. Recommended Data Sources

### A. Coral health — NOAA NCRMP

Use NOAA National Coral Reef Monitoring Program coral demographic survey data.

Useful variables:
- Survey date
- Latitude / longitude
- Species
- Bleaching condition
- Disease
- Recent mortality %
- Depth
- Habitat
- Region

The Florida coral-demographic ERDDAP dataset is a strong primary source.

Example:
- NOAA/NCEI ERDDAP coral demographic data for Florida

Why better than Kaggle:
- First-party scientific source
- Actual coordinates
- Actual dates
- Standardized survey protocol
- Explicit health outcomes

Kaggle can still be used for imagery if it adds a valuable computer-vision component.

### B. Reef fish / invasive species — NOAA NCRMP

Useful variables:
- Scientific name
- Common name
- Count
- Fish length
- Latitude / longitude
- Date
- Protected area

Use standardized fish surveys to identify lionfish records (`Pterois`).

### C. Heat stress — NOAA Coral Reef Watch

Use:
- SST
- SST anomaly
- HotSpot
- Degree Heating Weeks
- Bleaching Alert Area
- SST trend

Recommended flagship climate variable:
- Degree Heating Weeks (DHW)

Potential feature windows:
- Current DHW
- Max DHW previous 84 days
- Mean SST anomaly previous 30 days
- Days under bleaching alert previous 84 days

### D. Fishing effort — Global Fishing Watch

Use:
- AIS-observed fishing effort
- Fishing hours
- Vessel effort around reef sites

Important caveat:
- AIS does not capture all fishing, especially small vessels
- Therefore label it "AIS-observed fishing effort"
- Do not label it "overfishing" directly

### E. Vessel activity — Global Fishing Watch

Use:
- AIS vessel presence
- SAR vessel detections
- Unmatched SAR detections

Important wording:
- "Satellite detections unmatched to AIS"
- Do not say "illegal vessels"

### F. Invasive species — NOAA NCRMP + USGS NAS

Primary:
- NOAA standardized reef-fish surveys

Supplement:
- USGS Nonindigenous Aquatic Species records

Target invasive:
- Lionfish (`Pterois`)

### G. Hurricanes / natural disturbance — NOAA NHC HURDAT2

Use:
- Storm location
- Wind speed
- Central pressure
- Storm track
- Distance from reef
- Maximum winds near reef
- Number of storm exposures in previous year

---

## 7. ML Dataset Design

Do not train directly on raw source tables.

Create a materialized / feature table where each row represents:

**One coral survey observation/site/date**

Example structure:

```text
reef_observation

latitude
longitude
survey_date

# Outcomes
bleaching_present
disease_present
recent_mortality_pct

# Thermal pressure
dhw_at_survey
max_dhw_previous_84d
mean_sst_anomaly_30d
days_bleaching_alert_84d

# Human activity
fishing_hours_10km_30d
fishing_hours_10km_90d
vessel_hours_10km_30d
sar_detections_10km_90d
unmatched_sar_detections_10km_90d

# Biological pressure
lionfish_seen_nearby
lionfish_count_nearby

# Natural disturbance
nearest_storm_distance_365d
max_storm_wind_365d
storm_exposure_count_365d

# Context
depth
habitat
protected_area
region
```

### Primary targets

Avoid inventing an arbitrary "reef health score" unless scientifically justified.

Better targets:

1. Probability of bleaching
2. Probability of disease
3. Recent mortality %

Flagship target recommendation:
- **Bleaching present / absent**

Add disease or mortality only if the first model is working.

---

## 8. ML Model Strategy

Recommended:
- XGBoost

Reasons:
- Strong for structured/tabular data
- Fast enough for a hackathon
- Explainable
- Good support for SHAP/interaction analysis

Important:
- Do not overcomplicate with deep neural networks unless there is a specific image task.

### Explainability

Use:
- TreeSHAP
- SHAP interaction values

Possible visualized contributions:

```text
Heat stress             +31%
Fishing activity        +16%
Recent hurricane         +9%
Lionfish presence        +4%
Protected area           -3%
```

Label:
- "Model contribution"
- "Model association"

Do not label:
- "Cause"

### Compound pressure / interactions

Potential strong interaction examples:
- Heat × fishing
- Heat × storm
- Fishing × lionfish

The major research question becomes:

**How do multiple pressures coincide when reefs show damage?**

That is stronger than:
- Which single factor is bad?

---

## 9. Data Architecture

### Core database concept

Use Tiger Data / TimescaleDB as the central spatiotemporal database.

Recommended extensions:
- TimescaleDB
- PostGIS
- H3

Why:
- Time-series
- Spatial joins
- Hex/grid aggregation
- Standard SQL
- Continuous Aggregates
- Compression / columnstore
- Sponsor fit

### Source tables

Keep data provenance clear:

```text
coral_observations
fish_observations
thermal_observations
fishing_effort
vessel_presence
sar_detections
lionfish_occurrences
storm_tracks
```

Then build:

```text
reef_feature_snapshots
```

This is the ML-ready joined table.

### Conceptual source → feature flow

```text
NOAA NCRMP ─────────┐
NOAA CRW ───────────┤
Global Fishing Watch ┤
USGS Lionfish ──────┤
NOAA HURDAT2 ───────┤
                     ↓
          ingest + normalize
                     ↓
             Tiger Data
                     ↓
        spatial + temporal joins
                     ↓
         reef_feature_snapshots
                     ↓
             XGBoost
                     ↓
      SHAP / interactions
```

---

## 10. Agent Architecture

If entering AI & Agents, the agent must actually do something autonomous.

Recommended:
- One bounded Reef Investigation Agent
- Do not create fake multi-agent complexity

### Example workflow

```text
User or system selects reef
        ↓
Agent gathers:
- coral health observation
- previous thermal history
- fishing activity
- vessel presence
- SAR detections
- invasive species observations
- hurricane history
- model prediction
- SHAP contributors
        ↓
Evidence verifier
        ↓
Gemini structured explanation
        ↓
Persist investigation
        ↓
Display in UI / speak via ElevenLabs
```

### Tool examples

```text
get_reef_observation(reef_id)
get_thermal_history(reef_id, range)
get_fishing_activity(reef_id, range)
get_vessel_presence(reef_id, range)
get_sar_detections(reef_id, range)
get_invasive_species(reef_id, range)
get_storm_exposure(reef_id, range)
get_model_prediction(reef_id)
get_model_drivers(reef_id)
```

Important constraints:
- No arbitrary SQL
- No shell access
- No freeform web search inside core scientific workflow
- Gemini interprets evidence but does not invent data

---

## 11. Sponsor Architecture for Reef Sentinel

### Tiger Data
Core:
- TimescaleDB
- PostGIS
- H3
- Continuous Aggregates
- Compression / columnstore
- Spatiotemporal feature pipeline

### Gemini
Use for:
- Agent orchestration
- Tool calling
- Structured explanations
- Narrative generation
- Story script generation

Do not use for:
- Raw scientific prediction

### ElevenLabs
Use for:
- Real-time voice interface
- Reef Story narration
- Accessible spoken explanations
- Automatic reef briefings

### Vultr
Use for:
- Production deployment
- API
- Worker
- Web app

### GoDaddy Registry
Use for:
- Production domain

Skip unless genuinely needed:
- Solana
- Presage
- Snowflake

---

## 12. Backend Architecture

Recommended:
- One Python backend codebase
- Separate API + worker processes
- Do not create unnecessary microservices

Potential structure:

```text
backend/
├── app/
│   ├── api/
│   ├── db/
│   ├── ingestion/
│   ├── ml/
│   ├── agent/
│   ├── jobs/
│   └── services/
├── models/
├── tests/
└── pyproject.toml
```

### Recommended backend stack

- FastAPI
- SQLAlchemy
- Psycopg async
- XGBoost
- Gemini API / Google ADK
- HTTPX
- Pydantic
- Tiger Data / TimescaleDB

### API style

Prefer REST.

Potential endpoints:

```text
GET /api/v1/regions
GET /api/v1/reefs
GET /api/v1/reefs/{id}
GET /api/v1/reefs/{id}/health
GET /api/v1/reefs/{id}/pressures
GET /api/v1/reefs/{id}/timeline
GET /api/v1/reefs/{id}/prediction
GET /api/v1/reefs/{id}/investigation
POST /api/v1/agent/query
GET /api/v1/events/stream
GET /health/live
GET /health/ready
```

Use SSE for one-way realtime UI events.
Use WebSockets only where bidirectional voice interaction actually requires it.

---

## 13. Deployment Architecture

Recommended:
- Vultr Cloud Compute
- Docker Compose
- Caddy reverse proxy
- Next.js
- FastAPI
- Worker
- Tiger Cloud externally managed

Conceptually:

```text
Internet
   ↓
GoDaddy Registry domain
   ↓
Caddy / HTTPS
   ├── Next.js
   └── FastAPI
          ↓
        Worker

External:
- Tiger Cloud
- NOAA
- Global Fishing Watch
- USGS
- Gemini
- ElevenLabs
```

Avoid:
- Kubernetes
- Kafka
- RabbitMQ
- Redis unless actually required
- Celery unless job volume justifies it

---

## 14. Frontend Direction

The frontend should be a **creative, cinematic, 3D web experience**, not a dashboard.

### Design principle

Do not make the main UI:
- Sidebar
- Table
- Generic cards
- Charts everywhere

Instead use a visual hierarchy:

```text
WORLD
  ↓
REGION
  ↓
REEF
  ↓
PRESSURE
  ↓
EVIDENCE
```

### Two 3D environments

#### Planet / Geospatial mode
Recommended:
- CesiumJS

Use for:
- Globe
- Florida
- Reef locations
- Vessel layers
- Hurricane tracks
- Heat overlays
- Geographic camera flight

#### Reef / Underwater mode
Recommended:
- React Three Fiber + Three.js

Use for:
- Stylized 3D underwater scene
- Coral visualization
- Fish
- Lionfish
- Caustics
- Particle effects
- Pressure nodes
- Interactive reef explanation

Do not render both full scenes at once.
Transition between them.

---

## 15. Frontend Stack

Recommended web stack:

```text
Next.js
React
TypeScript

CesiumJS
Three.js
@react-three/fiber
@react-three/drei

Tailwind CSS
shadcn/ui / Base UI
Motion
```

Important decision:
- Stay on stable React Three Fiber
- Do not gamble on alpha WebGPU-only architecture during a 30-hour hackathon

Do not use Unity Web unless the team already has a strong reason and expertise; it adds deployment/build complexity.

---

## 16. Main 3D Experience

### Opening

Black screen → Earth emerges.

Title:

# REEF SENTINEL

Subtitle:

**Every reef tells a story.  
We find the pressures behind it.**

CTA:
- Enter the Ocean

### Globe

Reef regions glow on Earth.

User chooses:
- Florida Reef Tract

Camera flies:
- Earth
- Western Atlantic
- Florida
- Florida Keys
- Selected reef

Then dives underwater.

### Reef view

Stylized scientific realism:
- Dark navy water
- Cyan volumetric light
- Animated caustics
- Slow particles
- Fish schools
- Coral with emissive edges
- Glass HUD overlays

Reference vibe:
- Apple Vision Pro
- Marine research interface
- Sci-fi sonar

Avoid:
- Cartoon UI
- Generic Bootstrap aesthetic

---

## 17. Visual Encoding of Stressors

### Heat

Visual ideas:
- Warmer underwater lighting
- Heat shimmer
- Coral gradually loses saturation
- DHW shown in HUD

### Fishing

Visual ideas:
- Surface vessel tracks
- Faint line paths
- Density increases with observed effort

Scientific wording:
- AIS-observed fishing effort

### Vessel pressure

Show:
- AIS vessel
- SAR detection
- Unmatched SAR detection

Do not call unmatched detections "illegal boats."

### Hurricanes

Show:
- Animated storm track
- Particle/cloud spiral
- Track thickness based on wind strength
- Timeline replay

### Invasive lionfish

Show stylized lionfish where nearby standardized observations occurred.

Wording:
- "Lionfish observations recorded in nearby surveys"

Do not imply exact individual fish locations.

---

## 18. Signature Visualization: Pressure Constellation

The reef is central.

Stressors are floating 3D nodes around it.

Possible nodes:
- Heat
- Fishing
- Lionfish
- Storms

Visual rules:
- Node size = pressure magnitude
- Glow/pulse = model importance
- Arc intensity = model interaction strength

Example:

```text
             HEAT
             ●●●
            ╱   ╲
           ╱     ╲
    ●─────◎ REEF ◎─────●
 FISHING               LIONFISH
           ╲
            ╲
             ●
           STORM
```

Click interaction arc:
- Show SHAP interaction
- Explain compound pressure
- Clearly state association ≠ causation

This can become the signature UI element.

---

## 19. Time Travel

Bottom timeline:

```text
2016 ─── 2018 ─── 2020 ─── 2022 ─── 2024
                               ▲
```

As user moves time:
- Heat changes
- Boats move
- Storms pass
- Lionfish observations appear
- Coral observations update
- Model pressure changes

### Cinematic story mode

Button:
- "Tell me this reef's story"

System automatically plays important historical moments.

Potential narration:
- Heat buildup
- Fishing activity change
- Storm exposure
- Lionfish observations
- Bleaching/mortality observation

ElevenLabs narrates the timeline.

---

## 20. Reef Story Architecture

Gemini generates a structured story, not arbitrary frontend code.

Example structure:

```json
{
  "chapters": [
    {
      "title": "Heat builds",
      "narration": "...",
      "time": "2022-08",
      "camera": "reef-wide",
      "layers": ["thermal"],
      "focus": "heat"
    },
    {
      "title": "Human pressure",
      "narration": "...",
      "time": "2022-08",
      "camera": "surface",
      "layers": ["fishing", "vessels"],
      "focus": "fishing"
    }
  ]
}
```

Frontend only allows predefined safe actions.

Example:
- `camera = reef-wide`
- `layers = thermal`
- `focus = heat`

Never let an LLM directly execute arbitrary browser code.

---

## 21. Voice Interaction

The underwater scene should support:

**Ask this reef a question...**

Example:
- "Why does this reef look stressed?"
- "What changed since 2022?"
- "Which factors matter most?"
- "Was this hurricane important?"
- "What do we know about nearby lionfish?"

Flow:

```text
User speaks
   ↓
ElevenLabs speech layer
   ↓
FastAPI
   ↓
Gemini / Reef Agent
   ↓
Bounded data tools
   ↓
Grounded answer
   ↓
Text + ElevenLabs voice response
```

This improves:
- HCI track fit
- Accessibility
- Gemini sponsor fit
- ElevenLabs sponsor fit

---

## 22. Accessibility / HCI Requirements

Because HCI is a track and because the UI is highly visual:

Provide:
- Captions/transcripts
- Keyboard controls
- ARIA labels
- Reduced-motion mode
- Skip intro animation
- Non-3D fallback for weaker devices if possible
- Text equivalent of any audio explanation
- Do not rely only on color

Respect:

```css
@media (prefers-reduced-motion: reduce)
```

Disable or reduce:
- Long camera flights
- Heavy particles
- Automatic spins
- Excessive parallax

---

## 23. 3D Performance Rules

Use:
- glTF / GLB
- Draco or Meshopt compression
- KTX2 textures
- InstancedMesh for repeated fish/coral
- LOD models
- Lazy load underwater scene
- Cap DPR

Example:

```text
dpr = min(devicePixelRatio, 1.5)
```

Do not render thousands of React nodes for fish/coral.

Target:
- Smooth desktop experience
- Graceful lower-quality mode

---

## 24. Visual Style

Recommended:
- Almost-black navy
- Deep ocean blue
- Cyan bioluminescence
- Soft aqua
- Warm coral highlights
- White text
- Sparse glass surfaces

Typography:
- Large cinematic display type for storytelling
- Small monospaced scientific labels

Examples:

```text
NOAA CRW
26.413°N
81.234°W
DHW 7.4 °C-WEEKS
```

Goal:
- Beautiful
- Serious
- Scientific
- Cinematic

---

## 25. Most Impressive Demo Flow

1. Open on Earth
2. Select Florida Reef Tract
3. Camera dives into a reef
4. Timeline rewinds
5. Heat stress rises
6. Fishing vessel paths appear
7. Hurricane crosses
8. Lionfish observations appear
9. Coral becomes visibly stressed
10. Pressure Constellation forms
11. Model interaction arc lights up
12. User asks by voice: "What changed?"
13. Agent gathers evidence from all sources
14. Gemini explains evidence and uncertainty
15. ElevenLabs speaks it
16. UI shows exactly which sources support each claim

Core narrative:

> "We built a way to step inside a reef's history and see the pressures acting on it together."

---

## 26. Suggested Project Naming

Current strongest:
- Reef Sentinel

Other possible names:
- ReefLens
- ReefScope
- ReefPulse
- CoralSignal
- ReefWatch AI
- ReefAtlas
- ReefTwin
- CoralTwin
- BlueSentinel
- ReefTrace

Current recommendation:
# Reef Sentinel

---

## 27. Track Strategy

If only one main track is allowed:

### Primary recommendation
**Sustainability**

Why:
- Coral protection
- Ecosystem health
- Conservation
- Climate stress
- Human pressure
- Invasive species

### Strong secondary fit
**AI & Agents**

Only if:
- The investigation agent genuinely operates tools
- The AI autonomously gathers evidence
- The agent is more than a chatbot

### Strong secondary fit
**HCI**

Because:
- 3D exploration
- Time travel
- Voice
- Accessible storytelling
- Novel scientific interaction

### Philly Special
Less natural for Reef Sentinel than RiverTwin unless the project gains a local Philadelphia marine/estuarine component.

### Health and Wellness
Do not force it.

---

## 28. Scientific Integrity Rules

Hard boundaries:

1. Official observations are authoritative.
2. Deterministic calculations come next.
3. ML predictions are model outputs, not facts.
4. SHAP explains model behavior, not causal truth.
5. Gemini interprets only supplied evidence.
6. ElevenLabs only renders the explanation.

Never claim:
- "This boat caused the reef damage."
- "This storm caused bleaching."
- "Lionfish caused mortality."
- "Unmatched SAR vessels are illegal."
- "AIS fishing effort equals total fishing."
- "The model proves causation."

Use:
- "associated with"
- "observed alongside"
- "model contribution"
- "model interaction"
- "recorded within X km"
- "AIS-observed fishing effort"
- "satellite detection unmatched to AIS"

---

## 29. Scope Control for the 30-Hour Hackathon

The project is ambitious, so the actual MVP should be narrower.

Recommended MVP:

1. Florida only
2. One or a few reef survey areas
3. NOAA coral bleaching target
4. NOAA CRW heat stress
5. Global Fishing Watch fishing/vessel effort
6. Lionfish observations
7. Hurricane exposure
8. Tiger Data spatiotemporal join
9. XGBoost model
10. SHAP explanation
11. 3D globe
12. One 3D reef scene
13. Timeline
14. Reef Investigation Agent
15. One voice interaction
16. Production deployment

Avoid:
- Global coverage first
- Multiple ML targets before bleaching works
- Too many separate agents
- Complex auth
- Mobile-native app
- Blockchain
- RAG just for the sake of it
- Premature microservices

---

## 30. Suggested Team Split

For 5 people:

### Person 1 — Data / Tiger
- NOAA ingestion
- GFW ingestion
- PostGIS/H3
- Feature joins

### Person 2 — ML
- Feature engineering
- XGBoost
- Evaluation
- SHAP / interactions

### Person 3 — Backend / Agent
- FastAPI
- Gemini
- Tool orchestration
- Investigation trace

### Person 4 — 3D Frontend
- Cesium
- R3F
- Reef scene
- Pressure Constellation
- Timeline

### Person 5 — Voice / Deployment / UX
- ElevenLabs
- Vultr
- Caddy
- Domain
- Demo polish
- Accessibility
- Presentation

---

## 31. Suggested Repository Layout

```text
reef-sentinel/
│
├── apps/
│   ├── web/
│   │   ├── app/
│   │   ├── components/
│   │   ├── features/
│   │   │   ├── globe/
│   │   │   ├── reef/
│   │   │   ├── timeline/
│   │   │   ├── story/
│   │   │   ├── investigation/
│   │   │   └── voice/
│   │   └── lib/
│   │
│   └── api/
│       └── app/
│           ├── api/
│           ├── agent/
│           ├── db/
│           ├── ingestion/
│           ├── jobs/
│           ├── ml/
│           └── services/
│
├── data/
│   └── demo/
│
├── infra/
│   ├── Caddyfile
│   ├── compose.yaml
│   └── scripts/
│
├── notebooks/
│   └── exploration.ipynb
│
├── docs/
│   └── architecture.md
│
└── README.md
```

---

## 32. Current Final Recommendation

The strongest current project direction is:

# Reef Sentinel

**An interactive 3D reef intelligence platform that fuses coral-health observations with thermal stress, fishing/vessel activity, invasive species, and natural disturbances to reveal compound pressure on coral reefs, explain model associations, and let users explore a reef's history through time, AI, and voice.**

Primary scientific region:
- Florida Reef Tract

Primary ML target:
- Coral bleaching presence / probability

Primary data backbone:
- NOAA NCRMP
- NOAA Coral Reef Watch
- Global Fishing Watch
- NOAA/USGS lionfish records
- NOAA HURDAT2

Primary data infrastructure:
- Tiger Data / TimescaleDB
- PostGIS
- H3

Primary ML:
- XGBoost
- SHAP
- SHAP interaction values

Primary AI:
- Gemini-powered bounded investigation agent

Primary voice:
- ElevenLabs

Primary frontend:
- Next.js
- React
- CesiumJS
- Three.js
- React Three Fiber
- Tailwind
- shadcn/Base UI

Primary deployment:
- Vultr
- Docker Compose
- Caddy
- GoDaddy Registry domain

Primary track:
- Sustainability

Strong secondary tracks:
- AI & Agents
- HCI

Core demo line:

> **"We built a way to step inside a reef's history and see the pressures acting on it together."**

