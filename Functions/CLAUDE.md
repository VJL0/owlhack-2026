# Reef stress hackathon project

Goal: combine coral reef surveys with NOAA heat stress, Global Fishing Watch fishing effort
and invasive species (lionfish, crown-of-thorns) to (1) find which threats damage reefs and
(2) predict coral bleaching risk for 2021-2026. The owner has a separate front-end map that
imports the CSVs in `data/processed/`, so keep output column names stable.

Environment: Windows, VS Code, Python venv in `.venv` (`.venv\Scripts\activate`).
xgboost is installed. NOAA data comes from ERDDAP (coastwatch.pfeg.noaa.gov, dataset `NOAA_DHW`);
the server often returns 503s - scripts retry and cache, just rerun them.

## Data
- Surveys: van Woesik Global Coral Bleaching Database (BCO-DMO 773466),
  `data/raw/global_bleaching_environmental.csv`. GCRMN data is NOT public; do not use it.
  No survey outcomes exist after Aug 2020, so 2021+ can be predicted but not scored.
- NOAA Coral Reef Watch DHW, weekly samples (`NOAA_DAY_STRIDE = 7`), cached per pixel-year in
  `data/cache/noaa/crw_{lat}_{lon}_{year}_s7.csv`.
- GFW monthly 0.1 deg fishing effort 2012-2020 in `data/raw/gfw/` (no files for 2021+ yet).
- GBIF sightings for lionfish / crown-of-thorns, cached in `data/cache/gbif/`.

## Pipeline (run in this order)
1. `python build_dataset.py` -> `reef_stress_analysis.csv` (5,294 surveys x 30 cols, 2013-2020).
   Joins are by a unique `survey_id` with a row-count assert (an earlier many-to-many merge bug inflated rows).
2. `python predict.py --years 2021 2022 2023 2024 2025` and `--years 2026` -> `bleaching_risk_*.csv`
   (v1 model; also provides the reef list for step 5).
3. `python timing_features.py` -> `timing_features.csv` (cache only, no downloads).
4. `python future_timing.py` -> `future_timing_features.csv` (cache only; `--chunk i n` + `--merge` optional).
5. `python predict_v2.py [--validate]` -> `bleaching_risk_v2_2021_2026.csv`  <- CURRENT MODEL
6. `python threats.py` -> `reef_threats_2021_2026.csv`, `threat_effects.csv` (reads bleaching_risk_v2).
7. `scenario.py` -> `bleaching_scenario_2026_2030.csv`: SUPERSEDED by step 9 (v1 model, "repeat last 5 years").
8. `python fetch_monthly.py` (monthly SST 1985-now, 213 1-deg boxes, ~1 h, cached in `data/cache/noaa_monthly/`)
   then `python forecast_heat.py` -> `heat_history_1985_2025.csv`, `heat_forecast_validation.csv`,
   `heat_forecast_2027_2031.csv` (temperature model: forecast of yearly peak DHW per reef, see below).
9. `python bleaching_forecast.py [--check]` -> `bleaching_forecast_2027_2031.csv`: heat forecast
   (step 8) fed through predict_v2. Event shape (timing features) borrowed from the 25 most similar
   real 2021-2026 events in the same ocean; check: rank agreement 0.96 vs real features, +3 pts mean.
Other: `forward_test.py`, `xgb_temperature.py`, `analyze.py` (old random forest), `compare_features.py`.
`python make_charts.py` -> `charts/1..7_*.png` + `results_summary.csv` (risk curve, survey timing, old vs new model,
heat 2021-2026, threat effects, invasive exposure, risk outlook 2021-2031). Needs matplotlib.

## Current model: predict_v2.py
Target: significant bleaching (>= 10% of coral bleached). Ridge regression on logit(% bleached)
(uses full severity), then a 1-variable logistic maps the score to P(>= 10%).
Features: log1p(30-day DHW) + heat timing (DHW on survey day, 4-week DHW change, days since
12-month peak, 180-day peak DHW, days with DHW >= 4 in last 90 d, 30-day SST anomaly) +
ocean one-hot + ocean x heat (each ocean its own threshold) + |latitude|.
Future years are predicted for an assumed survey 2 weeks after that year's heat peak.

Validation (AUC, never-seen data)       v1 (30d DHW logistic)   v2
  leave-one-year-out                          0.762              0.821
  train 2013-18 -> test 2019-20               0.695              0.757
  train 2013-16 -> test 2017-20               0.684              0.762
  held-out reefs (GroupKFold by reef)         0.809              0.893
  level: predicted / actual bleaching rate    2.3-3.1x           1.4-1.9x
Key finding: surveys within 30 d of the heat peak found significant bleaching 82% of the time,
60-150 d after only 8-14% - timing explains much of v1's overprediction.
2024: 85% of reefs high/very high risk (NOAA/ICRI reported ~84% of reef area under bleaching heat).

## Heat forecast: forecast_heat.py
A. XGBoost: yearly peak DHW from monthly SST (hotspots over the 1985-2012 warmest-month normal),
   leave-one-year-out R^2 0.934, MAE 0.78 DHW -> history 1985-2025 (observed weekly where cached, else estimate).
   (2003 is missing: NOAA_DHW_monthly has no January 2003, and only full years are used.)
B. Ridge on log1p(peak DHW), issued Sep of year O for O+1..O+5: log recent peaks, warming trend,
   warmest-month normal, |lat|, ocean, ONI Jun-Aug (x ocean, horizons 1-2). P(DHW>=4/8) = logistic
   calibration on earlier out-of-sample forecasts. Capped at the max observed peak (32.5), flagged.
Walk-forward (origins 2006-2024, avg h1-5)   MAE   AUC dhw4  Brier dhw4  AUC dhw8  Brier dhw8
  last 5 years (scenario.py assumption)      2.27  0.671     0.185       0.592     0.094
  ridge (used)                               2.27  0.756     0.178       0.737     0.113
  xgb                                        2.30  0.724     0.191       0.709     0.118
All models underpredict the rate of hot years (reefs keep getting hotter than their past).
Ridge loses on Brier for DHW>=8; its 10-90% range is rough (pooled additive errors).
Issued with ONI JJA 2026 = +1.8 (strong El Nino) -> 2027 median forecast 10 DHW, P(DHW>=4) 0.93.

## Tried and rejected (do not re-add without new evidence)
- Random forest on % bleached: R^2 < 0 on held-out years.
- XGBoost on 6 temperature features (LOYO 0.710, 0.33 in 2018); monotone / DHW-only XGBoost ~ tie with v1.
- Depth: worse in all three tests.
- 5 deg / 10 deg regional thresholds, boosted trees, v2+trees blend: better on held-out reefs,
  WORSE on future years (they memorise place-year patterns). Future-year tests decide.
- Recalibrating the level to recent years: unstable (overshoots), not used.
- Lionfish effect on coral cover p = 0.080 and fishing p = 0.175: not applied.
  Crown-of-thorns within 50 km: -1.74 pp coral cover (p = 0.011), applied in threats.py.

## Pending
- `fetch_history.py` (downloads past heat 6 mo-3 yr before survey + 1985-2012 warmest-month
  SST normal) -> `reef_stress_plus.csv`. Rerun until 0 failures. Then test past_heat_dhw and
  sst_warmest_month_normal ON TOP OF v2 (compare_features.py currently compares against v1;
  update it to use the v2 design from predict_v2.py). Keep a feature only if it improves
  leave-one-year-out AND both forward tests.
- The 2017-2020 test years have been reused many times, so scores are slightly optimistic.
  After past heat, freeze the model; do not keep tuning on these years.
- Optional: daily NOAA data (stride 1) to sharpen timing features; GFW files for 2021-2025;
  post-2020 survey data (e.g. 2023-24 event) as a true test set.
- Charts done (make_charts.py). Map legend: risk_band in v2 is
  probability-based: low / moderate / high / very high, not DHW bands).

## Conventions
- Always validate on unseen years (leave-one-year-out + forward splits), never random splits.
- Report exposure vs. modelled effect honestly; blank fishing = no data, not zero.
- Superseded outputs live in `data/processed/old/` (v1 bleaching_risk files are still read by
  future_timing.py for the reef list; scenario, old random-forest files are unused).
