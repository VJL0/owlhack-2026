"""Settings for the reef stress pipeline. Edit these, not the scripts."""
import os
import sys
from pathlib import Path

ROOT = Path(__file__).parent
# `--sample` on any script (or REEF_SAMPLE=1) uses fake data in data/sample/,
# so the real folders and the real NOAA cache are never mixed with it.
SAMPLE = "--sample" in sys.argv or os.environ.get("REEF_SAMPLE") == "1"
DATA = ROOT / "data" / ("sample" if SAMPLE else "")
DATA_RAW = DATA / "raw"
DATA_CACHE = DATA / "cache"
DATA_OUT = DATA / "processed"

# ---- Reef survey data -------------------------------------------------------
# Which survey file you're using. "bleaching_db" = van Woesik et al. Global
# Coral Bleaching Database (BCO-DMO dataset 773466). "gcrmn" = a GCRMN export.
SURVEY_SOURCE = "gcrmn" if SAMPLE else "bleaching_db"

SURVEY_FILES = {
    "bleaching_db": DATA_RAW / "global_bleaching_environmental.csv",
    "gcrmn": DATA_RAW / "gcrmn_reef_surveys.csv",
}
GCRMN_FILE = SURVEY_FILES[SURVEY_SOURCE]

# Map the file's column names -> the names the pipeline uses. If the loader
# says a column is missing, it prints the real header: fix the left side here.
# "day" and "month" are optional; with them the 12-month window ends on the
# survey date, without them it ends on 31 December of the survey year.
SURVEY_COLUMNS = {
    "bleaching_db": {
        "Site_ID": "reef_id",
        "Latitude_Degrees": "latitude",
        "Longitude_Degrees": "longitude",
        "Date_Year": "year",
        "Date_Month": "month",
        "Date_Day": "day",
        "Percent_Cover": "hard_coral_cover_pct",
        "Percent_Bleaching": "percent_bleaching",
        "Depth_m": "depth_m",
        "Ocean_Name": "ocean",       # Atlantic / Pacific / Indian: decides which invasive applies
    },
    "gcrmn": {
        "site_id": "reef_id",
        "latitude": "latitude",
        "longitude": "longitude",
        "year": "year",
        "survey_date": "survey_date",
        "hard_coral_cover": "hard_coral_cover_pct",
        "macroalgae_cover": "macroalgae_cover_pct",
        "bleaching": "bleaching_severity",
    },
}
GCRMN_COLUMNS = SURVEY_COLUMNS[SURVEY_SOURCE]
MISSING_MARKERS = ["nd", "NA", "N/A", "", "-"]

# Only keep surveys in these years. GFW fishing data starts in 2012 and the
# window looks back 12 months, so 2013 is the first year with full fishing data.
# Set MIN_YEAR = 1985 if you only want heat stress (run with --no-gfw).
MIN_YEAR = 2013
MAX_YEAR = 2030

# ---- NOAA Coral Reef Watch (via ERDDAP) --------------------------------------
# Daily 5 km product; has CRW_DHW, CRW_SSTANOMALY, CRW_HOTSPOT, CRW_BAA.
ERDDAP_BASE = "https://coastwatch.pfeg.noaa.gov/erddap/griddap"
ERDDAP_DATASET = "NOAA_DHW"
NOAA_GRID_RES = 0.05          # degrees; reefs sharing a cell share one request
NOAA_DAY_STRIDE = 7           # sample weekly: DHW is a 12-week running total, so weekly barely changes the max
NOAA_WORKERS = 3              # parallel downloads; keep it small, it is a shared server

# ---- Global Fishing Watch ---------------------------------------------------
# Folder of daily CSVs from the GFW bulk download ("fleet-daily" at 0.1 deg or
# 0.01 deg). Subfolders are searched too.
GFW_DIR = DATA_RAW / "gfw"
GFW_CELL_RES = 0.1            # 0.1 or 0.01, whichever product you downloaded
BUFFER_KM = [10, 25, 50]      # fishing effort summed within each radius
# Gear types counted as high-impact for the trawler_hours_* columns.
HIGH_IMPACT_GEAR = {"trawlers", "dredge_fishing", "set_gillnets", "purse_seines"}

# ---- Output -----------------------------------------------------------------
OUTPUT_FILE = DATA_OUT / "reef_stress_analysis.csv"
