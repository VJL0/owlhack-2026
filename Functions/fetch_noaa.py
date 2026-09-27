"""Step 2: pull NOAA Coral Reef Watch heat stress for each reef from ERDDAP.

Only the pixels under your reefs are downloaded (one small request per
grid cell per year), and every response is cached in data/cache/noaa/, so
re-running is instant and an interrupted run picks up where it stopped.
"""
import io
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

import numpy as np
import pandas as pd
import requests

import config

CACHE = config.DATA_CACHE / "noaa"
VARS = ["CRW_DHW", "CRW_SSTANOMALY", "CRW_BAA"]


def _cache_path(lat, lon, year):
    return CACHE / f"crw_{lat:.3f}_{lon:.3f}_{year}_s{config.NOAA_DAY_STRIDE}.csv"


def _request(lat, lon, year, retries=3):
    """One ERDDAP request: every day of `year` at a single 5 km pixel."""
    start = f"{year}-01-01T12:00:00Z"
    end = f"{year}-12-31T12:00:00Z"
    if year == pd.Timestamp.now("UTC").year:
        end = "last"  # the current year isn't finished yet
    s = config.NOAA_DAY_STRIDE
    sel = f"[({start}):{s}:({end})][({lat})][({lon})]"
    query = ",".join(v + sel for v in VARS)
    url = f"{config.ERDDAP_BASE}/{config.ERDDAP_DATASET}.csv?{query}"
    for attempt in range(retries):
        try:
            r = requests.get(url, timeout=300)
            if r.status_code == 404:          # ERDDAP's way of saying "no data"
                return pd.DataFrame(columns=["time"] + VARS)
            r.raise_for_status()
            return pd.read_csv(io.StringIO(r.text), skiprows=[1])  # row 2 = units
        except requests.RequestException as e:
            if attempt == retries - 1:
                raise
            print(f"  retry {attempt + 1} for {lat},{lon},{year}: {e}")
            time.sleep(5 * (attempt + 1))


def get_pixel_year(lat, lon, year) -> pd.DataFrame:
    CACHE.mkdir(parents=True, exist_ok=True)
    path = _cache_path(lat, lon, year)
    if path.exists():
        df = pd.read_csv(path)
    else:
        df = _request(lat, lon, year)
        tmp = path.with_suffix(".part")
        df.to_csv(tmp, index=False)
        tmp.replace(path)  # only complete downloads ever land in the cache
    df["time"] = pd.to_datetime(df["time"], utc=True).dt.tz_localize(None)
    for v in VARS:
        df[v] = pd.to_numeric(df[v], errors="coerce").where(lambda x: x > -300)
    return df[["time"] + VARS]


def _neighbours(lat, lon):
    """Reefs hug coastlines, so the reef's own pixel may be masked as land.
    Fall back to the 8 surrounding ocean pixels."""
    r = config.NOAA_GRID_RES
    yield lat, lon
    for dy in (-r, 0, r):
        for dx in (-r, 0, r):
            if dy or dx:
                yield round(lat + dy, 3), round(lon + dx, 3)


def summarise_window(ts: pd.DataFrame, start, end) -> dict:
    w = ts[(ts["time"] > start) & (ts["time"] <= end)]
    if w.empty or w["CRW_DHW"].isna().all():
        return {}
    # Bleaching is only visible for weeks to a few months after the heat peak,
    # so heat stress just before the survey matters more than the 12-month max.
    recent = {}
    for days in (30, 90):
        r = ts[(ts["time"] > end - pd.Timedelta(days=days)) & (ts["time"] <= end)]
        recent[f"max_dhw_{days}d"] = r["CRW_DHW"].max() if not r.empty else np.nan
    return {
        **recent,
        "max_dhw": w["CRW_DHW"].max(),
        "mean_sst_anomaly": w["CRW_SSTANOMALY"].mean(),
        "max_sst_anomaly": w["CRW_SSTANOMALY"].max(),
        # Alert Level 1+ = BAA >= 3. Multiply by stride so it stays "days".
        "days_bleaching_alert": int((w["CRW_BAA"] >= 3).sum()) * config.NOAA_DAY_STRIDE,
    }


def _years(grp):
    return sorted({y for s, e in zip(grp["window_start"], grp["window_end"])
                   for y in range(s.year, e.year + 1)})


def _prefetch(cells):
    """Download every (reef pixel, year) not yet cached, a few at a time."""
    todo = [(lat, lon, y) for (lat, lon), grp in cells for y in _years(grp)
            if not _cache_path(lat, lon, y).exists()]
    if not todo:
        return
    CACHE.mkdir(parents=True, exist_ok=True)
    print(f"[NOAA] downloading {len(todo)} pixel-years ({config.NOAA_WORKERS} at a time); "
          f"safe to stop and re-run, finished ones are cached")
    failed = 0
    with ThreadPoolExecutor(config.NOAA_WORKERS) as pool:
        futs = {pool.submit(get_pixel_year, *t): t for t in todo}
        for i, f in enumerate(as_completed(futs), 1):
            try:
                f.result()
            except Exception as e:
                failed += 1
                print(f"  failed {futs[f]}: {e}")
            if i % 50 == 0 or i == len(todo):
                print(f"[NOAA] {i}/{len(todo)} done, {failed} failed")


def noaa_features(surveys: pd.DataFrame) -> pd.DataFrame:
    rows = []
    cells = surveys.groupby(["noaa_lat", "noaa_lon"])
    _prefetch(cells)
    for i, ((lat, lon), grp) in enumerate(cells, 1):
        years = _years(grp)
        ts, used = None, None
        try:
            for nlat, nlon in _neighbours(lat, lon):
                cand = pd.concat([get_pixel_year(nlat, nlon, y) for y in years])
                if cand["CRW_DHW"].notna().any():
                    ts, used = cand, (nlat, nlon)
                    break
        except Exception as e:
            print(f"  skipping cell {lat},{lon}: {e}")
        if i % 200 == 0 or i == cells.ngroups:
            print(f"[NOAA] summarised {i}/{cells.ngroups} cells")
        for _, s in grp.iterrows():
            feats = summarise_window(ts, s["window_start"], s["window_end"]) if ts is not None else {}
            feats["survey_id"] = s["survey_id"]
            feats["noaa_pixel_offset"] = used != (lat, lon) if used else None
            rows.append(feats)
    return pd.DataFrame(rows)


if __name__ == "__main__":
    from load_gcrmn import load_gcrmn
    print(noaa_features(load_gcrmn()).head())
