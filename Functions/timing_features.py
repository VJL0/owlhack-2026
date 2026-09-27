"""Heat-timing features, computed from the NOAA data already downloaded
(no new downloads).

Bleaching shows up a few weeks after peak heat and fades months later, so
WHEN the survey happened relative to the heat matters, not just how much.

  dhw_at_survey       heat stress on the survey day
  dhw_change_4wk      DHW now minus 4 weeks earlier (+ = heat still building,
                      bleaching may not be visible yet; - = event winding down)
  days_since_peak     days from the 12-month heat peak to the survey
  peak_dhw_180d       highest DHW in the 6 months before the survey
  days_dhw4_90d       days with DHW >= 4 in the 90 days before the survey
  sst_anomaly_30d     average temperature anomaly in the last 30 days

    python timing_features.py
Writes data/processed/timing_features.csv (one row per survey, same order as
reef_stress_analysis.csv).
"""
import numpy as np
import pandas as pd

import config
from fetch_noaa import _cache_path, _neighbours, get_pixel_year

OUT = config.DATA_OUT / "timing_features.csv"
COLS = ["dhw_at_survey", "dhw_change_4wk", "days_since_peak", "peak_dhw_180d",
        "days_dhw4_90d", "sst_anomaly_30d"]


def cached_series(lat, lon, years):
    """Own pixel if it has data, else the first ocean neighbour (as build_dataset did)."""
    for nlat, nlon in _neighbours(lat, lon):
        got = [get_pixel_year(nlat, nlon, y) for y in years if _cache_path(nlat, nlon, y).exists()]
        if got:
            ts = pd.concat(got).sort_values("time").reset_index(drop=True)
            if ts["CRW_DHW"].notna().any():
                return ts
    return None


def features(ts, start, end):
    w = ts[(ts["time"] > start) & (ts["time"] <= end)].dropna(subset=["CRW_DHW"])
    if w.empty:
        return {}
    now = w.iloc[-1]
    before = w[w["time"] <= end - pd.Timedelta(days=28)]
    peak = w.loc[w["CRW_DHW"].idxmax()]
    last = lambda days: w[w["time"] > end - pd.Timedelta(days=days)]
    return {
        "dhw_at_survey": now["CRW_DHW"],
        "dhw_change_4wk": now["CRW_DHW"] - (before.iloc[-1]["CRW_DHW"] if len(before) else np.nan),
        "days_since_peak": (end - peak["time"]).days if peak["CRW_DHW"] > 0 else np.nan,
        "peak_dhw_180d": last(180)["CRW_DHW"].max(),
        "days_dhw4_90d": int((last(90)["CRW_DHW"] >= 4).sum()) * config.NOAA_DAY_STRIDE,
        "sst_anomaly_30d": last(30)["CRW_SSTANOMALY"].mean(),
    }


def main():
    d = pd.read_csv(config.OUTPUT_FILE)
    r = config.NOAA_GRID_RES
    d["nlat"] = (np.floor(d["latitude"] / r) * r + r / 2).round(3)
    d["nlon"] = (np.floor(d["longitude"] / r) * r + r / 2).round(3)
    d["start"] = pd.to_datetime(d["window_start"])
    d["end"] = pd.to_datetime(d["window_end"])
    rows = {}
    groups = d.groupby(["nlat", "nlon"])
    for k, ((la, lo), g) in enumerate(groups, 1):
        years = sorted({y for s, e in zip(g["start"], g["end"]) for y in range(s.year, e.year + 1)})
        ts = cached_series(la, lo, years)
        for i, s, e in zip(g.index, g["start"], g["end"]):
            rows[i] = features(ts, s, e) if ts is not None else {}
        if k % 200 == 0 or k == groups.ngroups:
            print(f"  {k}/{groups.ngroups} pixels")
    f = pd.DataFrame.from_dict(rows, orient="index").reindex(d.index).reindex(columns=COLS)
    out = pd.concat([d[["reef_id", "year", "window_end"]], f], axis=1)
    out.to_csv(OUT, index=False)
    print(f"Wrote {OUT}")
    print(out[COLS].describe().round(2).to_string())


if __name__ == "__main__":
    main()
