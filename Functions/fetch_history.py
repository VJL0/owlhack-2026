"""Add three reef-history features to the survey dataset.

  past_heat_dhw            highest heat stress (DHW) at the reef 6 months to
                           3 years BEFORE the survey - i.e. earlier bleaching
                           events, not the current one. Reefs hit hard before
                           often bleach less next time.
  sst_warmest_month_normal the reef's normal temperature in its warmest month,
                           averaged over 1985-2012 (before any survey used here).
                           Reefs in naturally hot water tolerate more heat.
  sst_mean_normal          the reef's normal year-round temperature, 1985-2012.
  (depth_m is already in the dataset.)

    python fetch_history.py

Downloads from the same NOAA server as before (one request per reef pixel for
the missing years, one for the temperature normals). Everything is cached, so
it is safe to stop and re-run; finished pixels are skipped.

Writes data/processed/reef_stress_plus.csv (the analysis file + the new columns).
"""
import io
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

import numpy as np
import pandas as pd
import requests

import config
from fetch_noaa import CACHE, VARS, _cache_path, _neighbours, get_pixel_year

CLIM_CACHE = config.DATA_CACHE / "noaa_clim"
CLIM_DATASET = "NOAA_DHW_monthly"
CLIM_YEARS = (1985, 2012)
PAST_YEARS = 3            # look back this many years before the survey
EXCLUDE_DAYS = 180        # ...but skip the last 6 months (that is the current event)
OUT = config.DATA_OUT / "reef_stress_plus.csv"


def _get_csv(url, retries=3):
    for attempt in range(retries):
        try:
            r = requests.get(url, timeout=300)
            if r.status_code == 404:              # ERDDAP: no data (e.g. land pixel)
                return None
            r.raise_for_status()
            return pd.read_csv(io.StringIO(r.text), skiprows=[1])
        except requests.RequestException as e:
            if attempt == retries - 1:
                raise
            print(f"  retry {attempt + 1}: {e}")
            time.sleep(5 * (attempt + 1))


def _has_data(lat, lon, year):
    p = _cache_path(lat, lon, year)
    if not p.exists():
        return None
    return pd.to_numeric(pd.read_csv(p)["CRW_DHW"], errors="coerce").gt(-300).any()


def used_pixel(lat, lon, years):
    """The pixel the original build used: the reef's own, or the first ocean
    neighbour (reefs next to land are often masked). Decided from the cache."""
    for nlat, nlon in _neighbours(lat, lon):
        for y in years:
            if _has_data(nlat, nlon, y):
                return nlat, nlon
    return lat, lon


def fetch_block(lat, lon, years):
    """One request for a run of years at one pixel, split into the normal
    per-year cache files so fetch_noaa.py reuses them."""
    y0, y1 = min(years), max(years)
    s = config.NOAA_DAY_STRIDE
    sel = f"[({y0}-01-01T12:00:00Z):{s}:({y1}-12-31T12:00:00Z)][({lat})][({lon})]"
    url = f"{config.ERDDAP_BASE}/{config.ERDDAP_DATASET}.csv?" + ",".join(v + sel for v in VARS)
    df = _get_csv(url)
    if df is None:
        df = pd.DataFrame(columns=["time", "latitude", "longitude"] + VARS)
    yr = pd.to_datetime(df["time"], utc=True).dt.year if len(df) else pd.Series(dtype=int)
    for y in years:
        path = _cache_path(lat, lon, y)
        if not path.exists():
            tmp = path.with_suffix(".part")
            df[yr == y].to_csv(tmp, index=False)
            tmp.replace(path)


def clim_path(lat, lon):
    return CLIM_CACHE / f"sst_{lat:.3f}_{lon:.3f}_{CLIM_YEARS[0]}_{CLIM_YEARS[1]}.csv"


def fetch_clim(lat, lon):
    path = clim_path(lat, lon)
    if path.exists():
        return
    sel = (f"[({CLIM_YEARS[0]}-01-01T00:00:00Z):1:({CLIM_YEARS[1]}-12-31T00:00:00Z)]"
           f"[({lat})][({lon})]")
    df = _get_csv(f"{config.ERDDAP_BASE}/{CLIM_DATASET}.csv?sea_surface_temperature{sel}")
    if df is None:
        df = pd.DataFrame(columns=["time", "latitude", "longitude", "sea_surface_temperature"])
    tmp = path.with_suffix(".part")
    df.to_csv(tmp, index=False)
    tmp.replace(path)


def load_clim(lat, lon):
    p = clim_path(lat, lon)
    if not p.exists():
        return None
    df = pd.read_csv(p)
    sst = pd.to_numeric(df["sea_surface_temperature"], errors="coerce")
    sst = sst.where((sst > -3) & (sst < 50))
    if sst.notna().sum() < 12:
        return None
    month = pd.to_datetime(df["time"], utc=True).dt.month
    by_month = sst.groupby(month).mean()
    return {"sst_warmest_month_normal": by_month.max(), "sst_mean_normal": by_month.mean()}


def _run(jobs, label):
    if not jobs:
        return
    print(f"[NOAA] {label}: {len(jobs)} requests ({config.NOAA_WORKERS} at a time); "
          f"safe to stop and re-run")
    failed = 0
    with ThreadPoolExecutor(config.NOAA_WORKERS) as pool:
        futs = {pool.submit(fn, *args): args for fn, *args in jobs}
        for i, f in enumerate(as_completed(futs), 1):
            try:
                f.result()
            except Exception as e:
                failed += 1
                print(f"  failed {futs[f]}: {e}")
            if i % 50 == 0 or i == len(jobs):
                print(f"[NOAA] {label}: {i}/{len(jobs)} done, {failed} failed")


def main():
    d = pd.read_csv(config.OUTPUT_FILE)
    r = config.NOAA_GRID_RES
    d["nlat"] = (np.floor(d["latitude"] / r) * r + r / 2).round(3)
    d["nlon"] = (np.floor(d["longitude"] / r) * r + r / 2).round(3)
    d["end"] = pd.to_datetime(d["window_end"])
    CACHE.mkdir(parents=True, exist_ok=True)
    CLIM_CACHE.mkdir(parents=True, exist_ok=True)

    # which pixel each reef cell uses, and which years it needs
    cells = {}
    for (la, lo), g in d.groupby(["nlat", "nlon"]):
        own_years = sorted({t.year for t in g["end"]})
        need = sorted({y for t in g["end"] for y in range(t.year - PAST_YEARS, t.year + 1)})
        cells[(la, lo)] = (used_pixel(la, lo, own_years), need)
    print(f"{len(d)} surveys at {len(cells)} NOAA pixels")

    # 1. past heat: download missing years, one request per pixel
    jobs = []
    for (pla, plo), need in {v[0]: v[1] for v in cells.values()}.items():
        missing = [y for y in need if not _cache_path(pla, plo, y).exists()]
        if missing:
            jobs.append((fetch_block, pla, plo, missing))
    _run(jobs, "past heat")

    # 2. temperature normals: one request per pixel (neighbours tried if land-masked)
    pix = sorted({v[0] for v in cells.values()})
    _run([(fetch_clim, la, lo) for la, lo in pix if not clim_path(la, lo).exists()], "normals")
    clim = {}
    retry = []
    for la, lo in pix:
        c = load_clim(la, lo)
        if c is None:
            retry.append((la, lo))
        clim[(la, lo)] = c
    extra = [(fetch_clim, a, b) for la, lo in retry for a, b in list(_neighbours(la, lo))[1:]
             if not clim_path(a, b).exists()]
    _run(extra, "normals (neighbour pixels)")
    for la, lo in retry:
        for a, b in list(_neighbours(la, lo))[1:]:
            c = load_clim(a, b)
            if c:
                clim[(la, lo)] = c
                break

    # 3. build the features
    past = np.full(len(d), np.nan)
    warm = np.full(len(d), np.nan)
    mean = np.full(len(d), np.nan)
    for (la, lo), g in d.groupby(["nlat", "nlon"]):
        (pla, plo), need = cells[(la, lo)]
        got = [get_pixel_year(pla, plo, y) for y in need if _cache_path(pla, plo, y).exists()]
        ts = pd.concat(got) if got else None
        c = clim.get((pla, plo))
        for i, end in zip(g.index, g["end"]):
            if ts is not None:
                w = ts[(ts["time"] > end - pd.DateOffset(years=PAST_YEARS)) &
                       (ts["time"] <= end - pd.Timedelta(days=EXCLUDE_DAYS))]["CRW_DHW"]
                if w.notna().any():
                    past[i] = w.max()
            if c:
                warm[i] = c["sst_warmest_month_normal"]
                mean[i] = c["sst_mean_normal"]
    out = d.drop(columns=["nlat", "nlon", "end"])
    out["past_heat_dhw"] = past
    out["sst_warmest_month_normal"] = np.round(warm, 2)
    out["sst_mean_normal"] = np.round(mean, 2)
    out.to_csv(OUT, index=False)
    print(f"\nWrote {OUT}")
    for c in ("past_heat_dhw", "sst_warmest_month_normal", "sst_mean_normal", "depth_m"):
        print(f"  {c:26s} filled for {out[c].notna().mean():.0%} of surveys")
    print("Next: python compare_features.py")


if __name__ == "__main__":
    main()
