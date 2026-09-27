"""Download monthly sea surface temperature, 1985 to now, for every reef pixel.

Input for forecast_heat.py. Source: NOAA Coral Reef Watch monthly SST
(ERDDAP dataset NOAA_DHW_monthly). Reef pixels are grouped into 1 x 1 degree
boxes and each box is ONE request (about 30 s), instead of one per pixel.
Only the reef pixels and their 8 neighbours (fallback when a reef pixel is
masked as land) are kept.

    python fetch_monthly.py

Cached per box in data/cache/noaa_monthly/, so it is safe to stop and re-run;
finished boxes are skipped. Rerun until it reports 0 failed.
"""
import io
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

import numpy as np
import pandas as pd
import requests

import config
from fetch_noaa import _neighbours

DATASET = "NOAA_DHW_monthly"
CACHE = config.DATA_CACHE / "noaa_monthly"
START = "1985-01-16T00:00:00Z"
REEF_FILE = config.DATA_OUT / "bleaching_risk_v2_2021_2026.csv"


def reef_pixels():
    """One row per reef: reef_id, latitude, longitude, ocean, nlat, nlon (NOAA pixel)."""
    reefs = pd.read_csv(REEF_FILE).drop_duplicates("reef_id")[["reef_id", "latitude", "longitude", "ocean"]]
    r = config.NOAA_GRID_RES
    reefs["nlat"] = (np.floor(reefs["latitude"] / r) * r + r / 2).round(3)
    reefs["nlon"] = (np.floor(reefs["longitude"] / r) * r + r / 2).round(3)
    return reefs.reset_index(drop=True)


def box_path(blat, blon):
    return CACHE / f"sst_box_{blat}_{blon}.csv.gz"


def _get(url, retries=4):
    for attempt in range(retries):
        try:
            r = requests.get(url, timeout=600)
            if r.status_code == 404:
                return None
            r.raise_for_status()
            return pd.read_csv(io.StringIO(r.text), skiprows=[1])
        except requests.RequestException as e:
            if attempt == retries - 1:
                raise
            time.sleep(10 * (attempt + 1))


def fetch_box(blat, blon, wanted):
    """wanted: set of (lat, lon) pixels to keep from this box."""
    path = box_path(blat, blon)
    if path.exists():
        return
    lats = [p[0] for p in wanted]
    lons = [min(max(p[1], -179.975), 179.975) for p in wanted]  # neighbours may cross 180
    sel = (f"[({START}):1:(last)][({min(lats) - 0.001}):1:({max(lats) + 0.001})]"
           f"[({min(lons) - 0.001}):1:({max(lons) + 0.001})]")
    df = _get(f"{config.ERDDAP_BASE}/{DATASET}.csv?sea_surface_temperature{sel}")
    if df is None:
        df = pd.DataFrame(columns=["time", "latitude", "longitude", "sea_surface_temperature"])
    df["latitude"] = df["latitude"].astype(float).round(3)
    df["longitude"] = df["longitude"].astype(float).round(3)
    keep = pd.Series(list(zip(df["latitude"], df["longitude"]))).isin(wanted).to_numpy()
    df = df[keep]
    df = df[pd.to_numeric(df["sea_surface_temperature"], errors="coerce").notna()]
    tmp = path.with_name(path.name + ".part")
    df.rename(columns={"sea_surface_temperature": "sst"}).to_csv(tmp, index=False, compression="gzip")
    tmp.replace(path)


def boxes():
    """{(box_lat, box_lon): set of pixels incl. neighbours}"""
    out = {}
    for la, lo in reef_pixels()[["nlat", "nlon"]].drop_duplicates().itertuples(index=False):
        key = (int(np.floor(la)), int(np.floor(lo)))
        out.setdefault(key, set()).update(_neighbours(la, lo))
    return out


def load_monthly():
    """All cached boxes -> DataFrame time, latitude, longitude, sst."""
    parts = [pd.read_csv(p) for p in sorted(CACHE.glob("sst_box_*.csv.gz"))]
    df = pd.concat(parts, ignore_index=True).drop_duplicates(["time", "latitude", "longitude"])
    df["time"] = pd.to_datetime(df["time"], utc=True)
    return df


def main():
    CACHE.mkdir(parents=True, exist_ok=True)
    todo = {k: v for k, v in boxes().items() if not box_path(*k).exists()}
    print(f"[monthly SST] {len(todo)} boxes to download ({config.NOAA_WORKERS} at a time)")
    failed = 0
    with ThreadPoolExecutor(config.NOAA_WORKERS) as pool:
        futs = {pool.submit(fetch_box, *k, v): k for k, v in todo.items()}
        for i, f in enumerate(as_completed(futs), 1):
            try:
                f.result()
            except Exception as e:
                failed += 1
                print(f"  failed box {futs[f]}: {e}")
            if i % 10 == 0 or i == len(todo):
                print(f"[monthly SST] {i}/{len(todo)} done, {failed} failed", flush=True)
    print(f"Done, {failed} failed" + (" - rerun to retry them" if failed else ""))


if __name__ == "__main__":
    main()
