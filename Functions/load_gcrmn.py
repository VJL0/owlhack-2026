"""Step 1: load GCRMN surveys and normalise them to one row per reef-survey."""
import numpy as np
import pandas as pd

import config


def load_gcrmn(path=config.GCRMN_FILE) -> pd.DataFrame:
    if not path.exists():
        raise FileNotFoundError(f"Survey file not found: {path}")
    df = pd.read_csv(path, na_values=config.MISSING_MARKERS, low_memory=False)
    present = {k: v for k, v in config.GCRMN_COLUMNS.items() if k in df.columns}
    absent = [k for k in config.GCRMN_COLUMNS if k not in df.columns]
    if absent:
        print(f"Note: columns not found in {path.name}: {absent}")
    missing_required = {"latitude", "longitude", "year"} - set(present.values())
    if missing_required:
        raise ValueError(
            f"Survey file is missing {missing_required}. Edit SURVEY_COLUMNS in "
            f"config.py to match these columns:\n{list(df.columns)}"
        )
    df = df[list(present)].rename(columns=present)
    for c in df.columns:
        if c not in ("reef_id", "survey_date", "ocean"):
            df[c] = pd.to_numeric(df[c], errors="coerce")

    if "reef_id" not in df:
        df["reef_id"] = (
            df["latitude"].round(4).astype(str) + "_" + df["longitude"].round(4).astype(str)
        )

    df = df.dropna(subset=["latitude", "longitude", "year"])
    df = df[df["latitude"].between(-90, 90) & df["longitude"].between(-180, 180)]
    df["year"] = df["year"].astype(int)
    df = df[df["year"].between(config.MIN_YEAR, config.MAX_YEAR)]
    if df.empty:
        raise ValueError(f"No surveys between {config.MIN_YEAR} and {config.MAX_YEAR}")

    # Window used for the "12 months before the survey" features.
    if "survey_date" in df:
        df["survey_date"] = pd.to_datetime(df["survey_date"], errors="coerce")
    elif "month" in df:
        parts = pd.DataFrame({"year": df["year"], "month": df["month"],
                              "day": df["day"] if "day" in df else 15})
        parts["day"] = parts["day"].fillna(15)
        df["survey_date"] = pd.to_datetime(parts, errors="coerce")
        df = df.drop(columns=[c for c in ("month", "day") if c in df])
    else:
        df["survey_date"] = pd.NaT
    fallback = pd.to_datetime(df["year"].astype(str) + "-12-31")
    df["window_end"] = df["survey_date"].fillna(fallback)
    df["window_start"] = df["window_end"] - pd.Timedelta(days=365)

    # Surveys often have several transects per site/date: average them.
    keys = ["reef_id", "latitude", "longitude", "year", "window_start", "window_end"]
    if "ocean" in df:
        df["ocean"] = df["ocean"].fillna("Unknown")
        keys.append("ocean")
    numeric = [c for c in df.columns if c not in keys and c != "survey_date"
               and pd.api.types.is_numeric_dtype(df[c])]
    out = df.groupby(keys, as_index=False)[numeric].mean()
    out.insert(0, "survey_id", range(len(out)))  # unique key for joining features back

    # NOAA grid cell the reef falls in (cell centres sit on x.x25 / x.x75).
    r = config.NOAA_GRID_RES
    out["noaa_lat"] = (np.floor(out["latitude"] / r) * r + r / 2).round(3)
    out["noaa_lon"] = (np.floor(out["longitude"] / r) * r + r / 2).round(3)
    return out


if __name__ == "__main__":
    d = load_gcrmn()
    print(d.head())
    print(f"{len(d)} reef-surveys, {d['reef_id'].nunique()} sites, "
          f"years {d['year'].min()}-{d['year'].max()}")
