# Reef stress dataset (GCRMN + NOAA Coral Reef Watch + Global Fishing Watch)

One row per reef survey, with heat stress and nearby fishing effort from the 12 months before it.

## Setup (VS Code terminal)
    python -m venv .venv
    .venv\Scripts\activate          # Windows   (Mac/Linux: source .venv/bin/activate)
    pip install -r requirements.txt

## Try it right now on fake data
    python make_sample_data.py
    python build_dataset.py --sample
    python analyze.py --sample

## Real data
1. **Surveys** -> default is the Global Coral Bleaching Database (van Woesik et al.). Download
   https://datadocs.bco-dmo.org/dataset/773466/file/B11vA82u7y2Owp/global_bleaching_environmental.csv
   into `data/raw/` (keep the filename). Check it loads: `python load_gcrmn.py`.
   For a GCRMN export instead, set `SURVEY_SOURCE = "gcrmn"` in config.py.
2. **NOAA** -> nothing to download. `build_dataset.py` pulls only your reef pixels from ERDDAP (`NOAA_DHW`) and caches them in `data/cache/noaa/`.
   Tip: set `NOAA_DAY_STRIDE = 7` in config.py for a fast first pass.
3. **Global Fishing Watch** -> free account at globalfishingwatch.org, download the daily fishing-effort CSVs (0.1 deg) for the years you need, unzip into `data/raw/gfw/`. Set `GFW_CELL_RES` to match.
4. `python build_dataset.py` (add `--limit 20` for a quick test, `--no-gfw` if GFW isn't downloaded yet)
5. `python analyze.py`

Output: `data/processed/reef_stress_analysis.csv`

## Notes
- Fishing distances are great-circle (haversine), not Web Mercator, so 10 km means 10 km at every latitude.
- If a reef's own 5 km pixel is land-masked, the nearest ocean neighbour is used (`noaa_pixel_offset = True`).
- Ocean pH is not included: there is no global per-reef daily pH product comparable to DHW. Add it later from NOAA OCADS if you need it.
- Model CV is grouped by reef site to avoid leakage between repeat surveys.
