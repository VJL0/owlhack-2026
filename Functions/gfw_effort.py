"""Step 3: sum Global Fishing Watch effort around each reef.

Reads a folder of GFW daily CSVs, keeps only cells near your reefs (so a
year of global data fits in memory), then sums fishing hours within each
radius in config.BUFFER_KM over the 12 months before each survey.
Distances are great-circle (haversine), so they are correct at any latitude.
"""
import numpy as np
import pandas as pd
from sklearn.neighbors import BallTree

import config

EARTH_KM = 6371.0088

# GFW has shipped a few column schemes; all are mapped to these names.
RENAME = {
    "cell_ll_lat": "lat", "cell_ll_lon": "lon",
    "lat_bin": "lat", "lon_bin": "lon",
    "latitude": "lat", "longitude": "lon",
    "time range": "date", "time_range": "date",
    "apparent fishing hours": "fishing_hours", "apparent_fishing_hours": "fishing_hours",
    "gear type": "geartype", "gear_type": "geartype",
    "mmsi_present": "vessels", "vessel ids": "vessels", "vessel_ids": "vessels",
}


def _normalise(df):
    df.columns = [c.strip().lower() for c in df.columns]
    df = df.rename(columns={k: v for k, v in RENAME.items() if k in df.columns})
    needed = {"date", "lat", "lon", "fishing_hours"}
    if not needed <= set(df.columns):
        raise ValueError(f"GFW file lacks {needed - set(df.columns)}; columns: {list(df.columns)}")
    if "geartype" not in df:
        df["geartype"] = "unknown"
    if "vessels" not in df:
        df["vessels"] = np.nan
    return df[["date", "lat", "lon", "geartype", "fishing_hours", "vessels"]]


def load_gfw_near(reefs: pd.DataFrame) -> pd.DataFrame:
    files = sorted(config.GFW_DIR.rglob("*.csv"))
    if not files:
        raise FileNotFoundError(f"No GFW CSVs under {config.GFW_DIR}")

    # Generous lat/lon box around every reef; exact distances are done later.
    pad_deg = max(config.BUFFER_KM) / 111 * 1.5 + config.GFW_CELL_RES
    lat_pad = pad_deg
    lon_pad = pad_deg / np.maximum(np.cos(np.radians(reefs["latitude"].abs().clip(upper=80))), 0.2)
    boxes = np.column_stack([reefs["latitude"] - lat_pad, reefs["latitude"] + lat_pad,
                             reefs["longitude"] - lon_pad, reefs["longitude"] + lon_pad])
    t_min, t_max = reefs["window_start"].min(), reefs["window_end"].max()

    parts = []
    for i, f in enumerate(files, 1):
        df = _normalise(pd.read_csv(f))
        df["date"] = pd.to_datetime(df["date"].astype(str).str[:10], errors="coerce")
        df = df[(df["date"] > t_min) & (df["date"] <= t_max) & (df["fishing_hours"] > 0)]
        if df.empty:
            continue
        lat, lon = df["lat"].to_numpy(), df["lon"].to_numpy()
        keep = np.zeros(len(df), bool)
        for b in boxes:
            keep |= (lat >= b[0]) & (lat <= b[1]) & (lon >= b[2]) & (lon <= b[3])
        if keep.any():
            parts.append(df[keep])
        if i % 50 == 0 or i == len(files):
            print(f"[GFW] read {i}/{len(files)} files")
    if not parts:
        return pd.DataFrame(columns=["date", "lat", "lon", "geartype", "fishing_hours", "vessels"])
    out = pd.concat(parts, ignore_index=True)
    # GFW coordinates are the cell's lower-left corner: move to the centre.
    out["lat"] += config.GFW_CELL_RES / 2
    out["lon"] += config.GFW_CELL_RES / 2
    return out


def gfw_features(reefs: pd.DataFrame, effort: pd.DataFrame) -> pd.DataFrame:
    cols = []
    for km in config.BUFFER_KM:
        cols += [f"fishing_hours_{km}km", f"trawler_hours_{km}km"]
    small = min(config.BUFFER_KM)
    base = reefs[["survey_id"]].reset_index(drop=True)
    for c in cols:
        base[c] = 0.0
    base[f"fishing_days_{small}km"] = 0
    if effort.empty:
        return base

    cells = effort[["lat", "lon"]].drop_duplicates().reset_index(drop=True)
    cells["cell"] = np.arange(len(cells))
    effort = effort.merge(cells, on=["lat", "lon"])
    tree = BallTree(np.radians(cells[["lat", "lon"]].to_numpy()), metric="haversine")

    max_km = max(config.BUFFER_KM)
    idx, dist = tree.query_radius(np.radians(reefs[["latitude", "longitude"]].to_numpy()),
                                  r=max_km / EARTH_KM, return_distance=True)
    pairs = pd.DataFrame({
        "row": np.repeat(np.arange(len(reefs)), [len(i) for i in idx]),
        "cell": np.concatenate(idx) if len(idx) else [],
        "km": np.concatenate(dist) * EARTH_KM if len(dist) else [],
    })
    if pairs.empty:
        return base

    win = reefs[["window_start", "window_end"]].reset_index(drop=True)
    j = pairs.merge(effort, on="cell")
    j = j[(j["date"] > win["window_start"].to_numpy()[j["row"]]) &
          (j["date"] <= win["window_end"].to_numpy()[j["row"]])]
    j["high_impact"] = j["geartype"].str.lower().isin(config.HIGH_IMPACT_GEAR)

    for km in config.BUFFER_KM:
        near = j[j["km"] <= km]
        tot = near.groupby("row")["fishing_hours"].sum()
        hi = near[near["high_impact"]].groupby("row")["fishing_hours"].sum()
        base.loc[tot.index, f"fishing_hours_{km}km"] = tot.to_numpy()
        base.loc[hi.index, f"trawler_hours_{km}km"] = hi.to_numpy()
        if km == small:
            days = near.groupby("row")["date"].nunique()
            base.loc[days.index, f"fishing_days_{km}km"] = days.to_numpy()
    return base


if __name__ == "__main__":
    from load_gcrmn import load_gcrmn
    r = load_gcrmn()
    print(gfw_features(r, load_gfw_near(r)).describe())
