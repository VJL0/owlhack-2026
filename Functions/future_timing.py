"""Timing features for the prediction years (2021-2026), from cached NOAA data.

There are no surveys after 2020, so for each reef and year we ask: what would
divers see at the HEIGHT of that year's heat event? The "survey date" is set
to 2 weeks after the year's peak heat (when bleaching is most visible), and
the same timing features as timing_features.py are computed for that date.

    python future_timing.py
Needs the bleaching_risk_*.csv files from predict.py (for the reef list).
Writes data/processed/future_timing_features.csv
"""
import sys

import numpy as np
import pandas as pd

import config
from timing_features import COLS, cached_series, features

LAG_DAYS = 14
OUT = config.DATA_OUT / "future_timing_features.csv"


def main():
    # reef list: the v1 bleaching_risk files (moved to data/processed/old once superseded)
    files = (sorted(config.DATA_OUT.glob("bleaching_risk_20*.csv"))
             or sorted((config.DATA_OUT / "old").glob("bleaching_risk_20*.csv")))
    parts = [pd.read_csv(f) for f in files]
    reefs = (pd.concat(parts).drop_duplicates(["reef_id", "year"], keep="last")
             [["reef_id", "latitude", "longitude", "year", "peak_dhw"]].reset_index(drop=True))
    r = config.NOAA_GRID_RES
    reefs["nlat"] = (np.floor(reefs["latitude"] / r) * r + r / 2).round(3)
    reefs["nlon"] = (np.floor(reefs["longitude"] / r) * r + r / 2).round(3)
    rows = []
    groups = reefs.groupby(["nlat", "nlon"])
    # optional: python future_timing.py --chunk 0 5  (does 1/5 of the pixels, then --merge)
    chunk = None
    if "--chunk" in sys.argv:
        i = sys.argv.index("--chunk")
        chunk = (int(sys.argv[i + 1]), int(sys.argv[i + 2]))
    for k, ((la, lo), g) in enumerate(groups, 1):
        if chunk and (k - 1) % chunk[1] != chunk[0]:
            continue
        years = sorted({y for yr in g["year"] for y in (yr - 1, yr)})
        ts = cached_series(la, lo, years)
        for _, row in g.iterrows():
            out = {"reef_id": row["reef_id"], "year": row["year"]}
            if ts is not None:
                yr = ts[ts["time"].dt.year == row["year"]].dropna(subset=["CRW_DHW"])
                if len(yr):
                    peak = yr.loc[yr["CRW_DHW"].idxmax()]
                    # no heat at all: use mid-year; otherwise 2 weeks after the peak
                    day = (peak["time"] if peak["CRW_DHW"] > 0
                           else pd.Timestamp(f"{int(row['year'])}-07-01"))
                    survey = min(day + pd.Timedelta(days=LAG_DAYS), yr["time"].max())
                    f = features(ts, survey - pd.Timedelta(days=365), survey)
                    w = ts[(ts["time"] > survey - pd.Timedelta(days=30)) & (ts["time"] <= survey)]
                    out.update(f, max_dhw_30d=w["CRW_DHW"].max(), assumed_survey_date=survey.date())
            rows.append(out)
        if k % 200 == 0 or k == groups.ngroups:
            print(f"  {k}/{groups.ngroups} pixels")
    res = pd.DataFrame(rows)
    if chunk:
        res.to_csv(OUT.with_suffix(f".part{chunk[0]}"), index=False)
        print(f"chunk {chunk[0]} of {chunk[1]} done")
        return
    res.to_csv(OUT, index=False)
    print(f"Wrote {OUT}: {len(res)} reef-years, "
          f"{res['max_dhw_30d'].notna().mean():.0%} with heat data")


def merge():
    parts = sorted(OUT.parent.glob(OUT.name.replace(".csv", ".part*")))
    res = pd.concat([pd.read_csv(p) for p in parts], ignore_index=True)
    res.to_csv(OUT, index=False)
    print(f"Merged {len(parts)} chunks -> {OUT}: {len(res)} reef-years, "
          f"{res['max_dhw_30d'].notna().mean():.0%} with heat data")


if __name__ == "__main__":
    merge() if "--merge" in sys.argv else main()
