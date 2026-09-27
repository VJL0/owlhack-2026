# Reef Atlas data inventory

Verified on 2026-09-26/27 by downloading and opening every source listed here.
Nothing below is taken from a summary: variables, dates and sizes come from the
files, their EML/metadata, or the API responses. Scripts that reproduce every
download are in `apps/web/scripts` (`fetch-flagships.mjs`, `prepare-splats.mjs`,
`analyze-soneva.mjs`, `build-flagships.mjs`); SHA-256 hashes of each download are
recorded next to the raw files in `data/raw/<source>/sources.json`.

Evidence labels used in the app: **field** (divers or photo surveys), **sensor**
(instrument on the reef), **satellite**, **track** (cyclone best track),
**reported** (a monitoring program's own attribution), **derived** (computed by
Reef Atlas from the others). Satellite, track and derived values are never
presented as field observations.

## Summary

| Flagship | Source | Evidence | Period used | Access | Licence |
| --- | --- | --- | --- | --- | --- |
| Moorea | MCR LTER corals (knb-lter-mcr.4.44) | field | 2005–2025, annual (April) | EDI via DataONE node | CC BY 4.0 |
| Moorea | MCR LTER fishes (knb-lter-mcr.6.65) | field | 2006–2025, annual (Jul–Aug) | EDI via DataONE node | CC BY 4.0 |
| Moorea | MCR LTER *Acanthaster* (knb-lter-mcr.1039.13) | field | 2005–2025, annual (Jul–Aug) | EDI via DataONE node | CC BY 4.0 |
| Moorea | MCR LTER benthic water temperature (knb-lter-mcr.1035.18) | sensor | 2005 – Jul 2024, 2–20 min | EDI via DataONE node | CC BY 4.0 |
| Moorea | MCR LTER lagoon temperature network (knb-lter-mcr.1045.7) | sensor | Aug 2021 – Aug 2025, daily summaries | EDI via DataONE node | CC BY 4.0 |
| Moorea | Kopecky et al. 2023 bleaching segmentation (knb-lter-mcr.5050.1) | field | Aug 2018, Aug 2019 | EDI via DataONE node | CC BY 4.0 |
| Lizard Island | AIMS LTMP (doi:10.25845/5c09bc4ff315c) | field, reported | 1985–2026 | public reef-monitoring API | CC BY 4.0 |
| Soneva Fushi | wildflow/soneva-corals | field (3D) | Jun 2025 – Mar 2026 | Hugging Face, pinned revision | CC BY 4.0 |
| all three | NOAA Coral Reef Watch 5 km v3.1 | satellite | 2002 – Sep 2026, weekly samples | NOAA CoastWatch ERDDAP | free with credit |
| all three | NOAA NCEI IBTrACS v04r01 | track | 1985–2026 | NCEI CSV | public domain |
| world view | supplied `bleaching_risk_2021_2025.csv`, `reef_stress_analysis.csv` | as supplied | 2013–2025 | repo files, Tiger Cloud | as supplied |
| Florida | unchanged, see README section 1 | | 2016–2024 | | |

## Moorea, French Polynesia (Moorea Coral Reef LTER)

**Access.** The EDI PASTA API (`pasta.lternet.edu`) now answers anonymous reads
with `403 not authorized` and the EDI portal sits behind a Cloudflare Turnstile
check. The same objects, under their PASTA identifiers, are served by EDI's
DataONE member node: `https://gmn.lternet.edu/mn/v2/object/<url-encoded PASTA URL>`.
Newest revisions were found with the DataONE search API
(`cn.dataone.org/cn/v2/query/solr`) and confirmed by probing the next revision
(404). The site polygons in every EML: LTER 1 (with LTER 0) and 2 on the north
shore, 3 and 4 on the south-east, 5 and 6 on the south-west; island bounding box
149.67–150.00° W, 17.45–17.62° S.

### Corals, `knb-lter-mcr.4.44` (updated 2026-01-07)
- Entity used: *Percent Cover - Wide Table* (1.95 MB, entity `c0c1055650f980f3bf8021b6686786b4`).
- Variables: `Date` (year), `Location` (site, habitat, transect, quadrat), percent cover of Sand, CTB (crustose coralline algae / bare), non-coralline crusts, soft coral, macroalgae, *Millepora*, and 25 scleractinian genera.
- Design: 0.5 × 0.5 m photoquadrats, 40 per habitat per site, every April 2005–2025; habitats in this table: fringing reef, outer reef 10 m, outer reef 17 m (backreef is not in the wide table). 14,542 quadrats.
- Derived here: live coral = sum of scleractinian genera; island mean of the six site means with a 95% interval across sites.
- Limitations: annual cadence (a loss seen in April happened sometime in the previous 12 months); `ND` values in Sand and CTB; taxonomy changed over time (separate history table).

### Fishes, `knb-lter-mcr.6.65` (updated 2025, data to 2025-08-12)
- Entity used: *Annual Fish Surveys* (22.8 MB). Columns include `Year, Date, Site, Habitat, Transect, Swath, Taxonomy, Count, Total_Length, Biomass (g), Coarse_Trophic`.
- Design: 6 sites × 3 habitats × 4 permanent 50 m transects, late July/early August, 2006–2025 (2005 used a different method and is excluded). Mobile fishes on a 5 m swath (250 m²), small site-attached fishes on a 1 m swath (50 m²).
- Derived here: biomass density per transect = Σ biomass(5 m)/250 + Σ biomass(1 m)/50, summed for `Coarse_Trophic = "Primary Consumer"` (herbivores); `Biomass = -1` (not available) dropped.
- Limitation: biomass is estimated from visual lengths; the research brief's "fishing pressure" is not measured here.

### Crown-of-thorns starfish, `knb-lter-mcr.1039.13` (updated 2026-03-10)
- Entity: *COTS_abundance* (39 KB): `Year, Site, Habitat, Transect, COTS`.
- Same 72 permanent transects as the fish survey (forereef ~12 m), 2005–2025.
- Forereef totals on 24 transects: 108 in 2008, 70 in 2009, 0–2 from 2011 to 2022, 17 in 2023, 56 in 2024, 2 in 2025.

### Benthic water temperature, `knb-lter-mcr.1035.18` (updated 2025-05-30)
- Entities used: LTER 00 and LTER 02 backreef/forereef thermistor files (318 MB and 497 MB): `site, time_local, time_utc, reef_type_code, sensor_type, sensor_depth_m, temperature_c`.
- LTER 0 forereef: 10, 20, 30, 40 m, 2005 – 2024-07-05; LTER 2: backreef 2 m and forereef 10/20/30/40 m.
- Derived here: daily mean and max per depth (days with fewer than 24 readings dropped), weekly means in the app.
- Verified gap: **LTER 2 at 10 m recorded nothing from July 2018 to early August 2019**, the whole 2019 bleaching season. LTER 0 at 10 m is complete then and is the app's main series.
- Limitation: the published series ends on 2024-07-05, before the 2024–2025 decline.

### Island-wide lagoon temperature, `knb-lter-mcr.1045.7` (updated 2025-11-19)
- Entities: *Temperature Summary by Day* (3.3 MB: `site, date_local, min/max/median/mean_temp_c`) and *Lagoon Bottom Mount Thermistor Locations* (KMZ, 49 placemarks).
- 49 sensors (B01–B35 backbone at ~1 km spacing plus cross-shore sets E, N, W), 2-minute sampling, daily summaries 2021-08-07 to 2025-08-14 (the EML temporal coverage says 2024-08-21; the data run a year longer).
- Derived here: weekly mean of each sensor's daily maximum, drawn on the globe for the week under the timeline cursor.

### 2019 bleaching segmentation, `knb-lter-mcr.5050.1` (Kopecky et al. 2023, *Remote Sensing* 15:4077)
- Entity: *Resilience Plots* (0.86 MB): `Image name, TagLab Id, Date, Class name (Pocillopora / Pocillopora_dead), Genet Id, Centroid x/y (px), Planar area (cm²), Surface area (cm²), Perimeter`.
- Five permanent 25 m² plots on the north-shore forereef, photographed August 2018 and August 2019 (the `Date` column holds `YYYY-01-01`).
- **Correction to the research brief:** the package does not contain the orthomosaics or imagery, only the segmentation table and R code. The app draws the colonies from centroids and areas (circle size uses the 0.666 mm/px scale in the image names, so it is approximate). Genet IDs do not link colonies across years.
- Live *Pocillopora* per plot fell 46–59% between the two dates (derived).

### Not used yet
- `knb-lter-mcr.5049.1` (3D photogrammetry of *Pocillopora*, Curtis 2023): colony measurement tables, no meshes.
- Meteorology, currents, algae, invertebrates, recruitment packages: listed in the MCR catalogue, not inspected.

## Lizard Island, northern Great Barrier Reef (AIMS LTMP)

**Access.** `https://api.aims.gov.au/data-v2.0/10.25845/5c09bc4ff315c/` is the
public API behind AIMS's reef-monitoring site (apps.aims.gov.au/reef-monitoring);
it answers without a key or special headers. Endpoints used, all for AIMS reef
name `Lizard Isles` (sector CL, Cape York NRM region, reef centre
14.690° S 145.466° E):

| Endpoint | Content | Records |
| --- | --- | --- |
| `data?domain_category=reef&data_type=manta` | reef-perimeter hard coral cover, mean/median/lower/upper, 9 m series | 34 surveys, 1985.73 – 2025.97 |
| `data?...&data_type=photo-transect` | benthic groups at 3 fixed 9 m sites (hard coral, soft coral, algae, macroalgae), composition and group level | 24 group-level years, 1993–2024 |
| `data?...&data_type=juvenile` | juvenile coral abundance (per m²) at the fixed sites | 96 records |
| `cots-by-domain` | crown-of-thorns starfish per manta tow | 34 surveys; peaks 1.92/tow (1998), 0.74 (2013) |
| `disturbance?reef=Lizard Isles&aggregation=reef&zone=_` | AIMS's attribution of each change: storm, COTS, bleaching, multiple, unknown, with notes | 19 entries |
| `site?aims_reef_name=Lizard Isles` | fixed-site coordinates, 2004 zoning, last survey 2026-03-31 | 3 fixed sites |

- Temporal: manta tow near-annual 1985–2011, **every second year 2011–2021**, annual since. Survey dates are decimal years.
- Verified: reef-wide coral 21.3% (late 2023) → 11.5% (2024 survey); AIMS logs "DHW 6.27, aerial bleaching 4" for 2024 and marks a 2024 photo-transect drop as possibly erroneous.
- Limitations: manta tow is a coarse reef-wide estimate (hence the 95% band); attributions are the program's judgement (labelled *reported*).
- **Not accessible:** AIMS temperature loggers and weather stations (`api.aims.gov.au/data-v2.0/10.25845/5b4eb0f9bb848/...`) return `{"message":"Forbidden"}` without an AIMS API key (free on request). Not used.
- **Not scriptable:** *Tracking morphological development in stony corals (colony meshes)*, University of St Andrews, doi:10.17630/b0086b3f-fec9-4765-9a0f-fe9021aa79e3, CC BY 4.0 (DataCite), 284 MB zip of ASCII PLY colony meshes, 2018–2022. File downloads are behind a Cloudflare managed challenge; they need a manual browser download. Not integrated.
- Not inspected: the AIMS COTS eDNA dataset and eReefs.

## Soneva Fushi, Baa Atoll, Maldives (wildflow/soneva-corals)

**Access.** `https://huggingface.co/datasets/wildflow/soneva-corals`, pinned to
revision `200aaf30cda920bd9b0e5d5da8838d4165c9e289` (last modified 2026-05-26),
licence CC BY 4.0 (dataset card), attribution: Soneva Conservation and
Sustainability Maldives and Wildflow.

- 23 surveys, 6 plots, 2025-06-02 → 2026-03-04, 22,422 GoPro images (verified by listing the repository: 22,702 files).
- Per survey: `raw/` JPEGs, `colmap/` (cameras, images, points3D, image_mapping.csv), `ortho/ortho.pmtiles` (~22 MB) + `world_to_pixel.json` (0.5 mm per pixel), `point_cloud.ply` (~300 MB, XYZ), and `splats/ply/lod0–lod4.ply`.
- Splat sizes for one survey: lod0 2.07 GB, lod1 518 MB, lod2 126 MB (~530–620k splats), lod3 29 MB, lod4 6.5 MB. Each is a standard 3DGS binary PLY: position, scale ×3, `f_dc` ×3, opacity, rotation ×4, 45 `f_rest` coefficients.
- Frame: every survey of a plot shares one metric, z-up frame (checked: bounds overlap to within centimetres; z matches the scale-bar depths, e.g. Host Beach −1.4 to −3.5 m, OOTS R3 −8 to −12 m).

| Plot (metadata `site`) | Surveys | Dates | SW corner |
| --- | ---: | --- | --- |
| HB, Host Beach reef flat | 4 | 2025-07-10, 07-28, 10-29, 2026-03-04 | 5.11596 N, 73.07521 E |
| OOTBM, crest | 3 | 2025-06-24, 07-03, 10-07 | 5.11508 N, 73.07076 E |
| OOTBR | 4 | 2025-07-09, 07-28, 10-29, 2026-03-04 | **invalid**: latitude repeated as longitude |
| OOTSL1, slope near a wall | 4 | 2025-06-02, 06-20, 10-07, 2026-02-18 | 5.10980 N, 73.07697 E |
| OOTSR2, flat above the cave | 4 | 2025-07-02, 07-04, 10-08, 2026-03-03 | 5.11074 N, 73.07483 E |
| OOTSR3, gully | 4 | 2025-07-03, 07-04, 10-08, 2026-03-03 | 5.11066 N, 73.07502 E |

**Choosing the plot (measured, not guessed).** `analyze-soneva.mjs` compares
each survey with its plot's first survey: top-surface height on a 5 cm grid from
the lod3 splats, after removing the median vertical offset. Surveys taken 1–19
days apart set the noise floor (the reef cannot have changed much): 1.7–6.0% of
cells move more than 10 cm. Eight months later, 7.7–9.5% do. OOTS L1 shows the
clearest excess (3.2% at 18 days, 9.3% at 261 days), has the most relief (4.7 m)
and the largest area (54 m²), and rendered cleanly in Spark; Host Beach (6.0% →
9.5%) is the second plot shipped. A per-voxel colour comparison was tried first
and rejected: lighting differences between dives dominate it even for surveys two
days apart.

**Web assets.** `prepare-splats.mjs` crops each lod2 PLY to its plot, drops
splats with opacity below 0.02 or wider than 0.6 m, keeps degree-0 colour only,
and writes SPZ v2 (6–7 MB per survey, ~440–500k splats). Rendered with Spark 2.2
(`@sparkjsdev/spark`) inside React Three Fiber.

Limitations: under one year of data, no live/dead labels, no in-water
temperature, colours vary with light and visibility.

## NOAA Coral Reef Watch (all flagships)

- Products: CRW daily global 5 km v3.1 degree heating weeks (`noaacrwdhwDaily`), CoralTemp SST (`noaacrwsstDaily`), SST anomaly (`noaacrwsstanomalyDaily`) on NOAA CoastWatch ERDDAP (`https://coastwatch.noaa.gov/erddap/griddap/`); coverage 1985-03-25 → 2026-09-19 at retrieval.
- Pixels: Moorea −17.475, −149.825 (north shore, between LTER 1 and 2); Lizard Island −14.675, 145.475; Soneva Fushi 5.125, 73.075. All ocean pixels (checked on a 2024-03-01 grid).
- Sampling: every 7 days from 2002-01-06 (1,288 weekly values per series), fetched in two-year chunks.
- **Why 2002:** the dataset's own licence text says CRW SST for 1985–2002 comes from the Met Office OSTIA reanalysis, "used for pure academic research only", with a reproduction licence required. The app uses only the GHRSST-based period from 2002, which CRW releases without restriction (credit required).
- Access note: PacIOOS ERDDAP (used for the original Florida files) stopped responding during this work; NOAA's own CoastWatch ERDDAP served the same products.
- Limitation: a 5 km satellite pixel is not the reef; Moorea's thermistors show how the two differ.

## NOAA NCEI IBTrACS v04r01 (all flagships)

- `ibtracs.{SP,SI,NI}.list.v04r01.csv` from `https://www.ncei.noaa.gov/data/international-best-track-archive-for-climate-stewardship-ibtracs/v04r01/access/csv/` (updated 2026-09-24; 35, 78 and 28 MB).
- Kept: every storm since 1985 with a main-track fix within 400 km of a flagship (96 SP, 18 SI, 10 NI storms). Closest approach computed on tracks densified to 1/6 of the fix interval; winds are USA 1-minute where present, else WMO.
- Includes Oli (Feb 2010, Moorea), Ita (Apr 2014), Nathan (Mar 2015) and Jasper (Dec 2023) near Lizard Island.

## World view: the supplied archive

- `bleaching_risk_2021_2025.csv` (13,245 rows, 2,649 reefs, peak DHW and a model probability per year) and `reef_stress_analysis.csv` (5,294 survey rows 2013–2020, 2,720 reefs), SHA-256 pinned in `apps/web/database/datasets.mjs` and served from Tiger Cloud.
- The globe colours each reef by that year's `peak_dhw`; the panel reports how many passed 8 °C-weeks and the median year of their last survey in the archive (surveys in this file end in 2020, which the panel says).
- Provenance of the original surveys is not documented in the files.

## Global Fishing Watch

- `https://gateway.api.globalfishingwatch.org/v3/...` returns 401 without a token. No token is configured, so **no fishing layer is shown for the flagships**, and nothing is simulated for them. AIS-based apparent fishing effort would also miss most small-boat reef fishing; Moorea's herbivore biomass is the closest field evidence. Florida keeps its labelled simulated AIS series.
