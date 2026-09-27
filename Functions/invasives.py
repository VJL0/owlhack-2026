"""Step 4: invasive / outbreak species near each reef, from GBIF sightings.

  * Lionfish (Pterois volitans, P. miles): invasive in the Atlantic/Caribbean.
    Native in the Indo-Pacific, so features are only filled for ATLANTIC reefs.
    Feature: is lionfish established nearby, and for how long.
  * Crown-of-thorns starfish (Acanthaster): coral-eating outbreaks in the
    Indo-Pacific. Features only filled for PACIFIC and INDIAN Ocean reefs.
    Feature: recent sightings nearby (outbreak activity).

GBIF records are sightings (mostly without counts) and cluster where people
dive, so "no records" can mean "nobody looked". Treat these as presence
signals, not abundance.

Downloads are cached in data/cache/gbif/, so this only hits the internet once.
"""
import time

import numpy as np
import pandas as pd
import requests
from sklearn.neighbors import BallTree

import config

EARTH_KM = 6371.0088
CACHE = config.DATA_CACHE / "gbif"
API = "https://api.gbif.org/v1/occurrence/search"

SPECIES = {
    "lionfish": {"names": ["Pterois volitans", "Pterois miles"], "oceans": {"Atlantic"}},
    "cots": {"names": ["Acanthaster"], "oceans": {"Pacific", "Indian", "Red Sea", "Arabian Gulf"}},
}
RADII_KM = [25, 50]
COTS_LOOKBACK_YEARS = 3      # outbreak activity = sightings in the survey year and 2 before


def _get(params):
    for attempt in range(5):
        try:
            r = requests.get(API, params=params, timeout=(10, 30))
            r.raise_for_status()
            return r.json()
        except requests.RequestException as e:
            if attempt == 4:
                raise
            print(f"    retry {attempt + 1} ({type(e).__name__})")
            time.sleep(3 * (attempt + 1))


def _fetch_year(name: str, year: int) -> pd.DataFrame:
    """One species-year. Asking year by year keeps every request near the start
    of a short list; GBIF gets very slow when paging deep into long ones."""
    rows, offset, page = [], 0, 300
    while True:
        js = _get({"scientificName": name, "hasCoordinate": "true", "hasGeospatialIssue": "false",
                   "occurrenceStatus": "PRESENT", "year": year, "limit": page, "offset": offset})
        for o in js.get("results", []):
            rows.append({"lat": o.get("decimalLatitude"), "lon": o.get("decimalLongitude"),
                         "year": o.get("year"), "count": o.get("individualCount"),
                         "basis": o.get("basisOfRecord"), "dataset": o.get("datasetName")})
        offset += page
        if js.get("endOfRecords") or offset >= 100_000:
            return pd.DataFrame(rows, columns=["lat", "lon", "year", "count", "basis", "dataset"])


def _fetch_name(name: str) -> pd.DataFrame:
    parts_dir = CACHE / "parts"
    parts_dir.mkdir(parents=True, exist_ok=True)
    parts, total = [], 0
    for year in range(1985, 2027):
        part = parts_dir / f"{name.replace(' ', '_')}_{year}.csv"
        if part.exists():                      # finished on an earlier run
            df = pd.read_csv(part)
        else:
            df = _fetch_year(name, year)
            df.to_csv(part, index=False)
        parts.append(df)
        total += len(df)
        if len(df):
            print(f"  {name} {year}: {len(df)} records (running total {total})")
    return pd.concat(parts, ignore_index=True)


def load_species(key: str) -> pd.DataFrame:
    CACHE.mkdir(parents=True, exist_ok=True)
    path = CACHE / f"{key}.csv"
    if path.exists():
        df = pd.read_csv(path)
    else:
        print(f"[GBIF] downloading {key} sightings, year by year (one time; progress is saved)...")
        df = pd.concat([_fetch_name(n) for n in SPECIES[key]["names"]], ignore_index=True)
        df.to_csv(path, index=False)
    df = df.dropna(subset=["lat", "lon", "year"])
    df["year"] = df["year"].astype(int)
    return df


def invasive_features(reefs: pd.DataFrame) -> pd.DataFrame:
    out = reefs[["survey_id"]].reset_index(drop=True).copy()
    if "ocean" not in reefs:
        print("[GBIF] no 'ocean' column in the survey data; skipping invasive species")
        return out
    reefs = reefs.reset_index(drop=True)
    q = np.radians(reefs[["latitude", "longitude"]].to_numpy())

    for key, spec in SPECIES.items():
        rec = load_species(key)
        applies = reefs["ocean"].isin(spec["oceans"]).to_numpy()
        tree = BallTree(np.radians(rec[["lat", "lon"]].to_numpy()), metric="haversine")
        rec_year = rec["year"].to_numpy()
        for km in RADII_KM:
            idx = tree.query_radius(q, r=km / EARTH_KM)
            if key == "lionfish":
                est = np.full(len(reefs), np.nan)       # established by survey year? (0/1)
                yrs = np.full(len(reefs), np.nan)       # years since first local record
                for i, ids in enumerate(idx):
                    if not applies[i]:
                        continue
                    y = reefs.at[i, "year"]
                    seen = rec_year[ids][rec_year[ids] <= y]
                    est[i] = float(len(seen) > 0)
                    yrs[i] = (y - seen.min()) if len(seen) else 0.0
                out[f"lionfish_present_{km}km"] = est
                out[f"lionfish_years_established_{km}km"] = yrs
            else:
                n = np.full(len(reefs), np.nan)         # sightings in the last few years
                for i, ids in enumerate(idx):
                    if not applies[i]:
                        continue
                    y = reefs.at[i, "year"]
                    ry = rec_year[ids]
                    n[i] = float(((ry <= y) & (ry > y - COTS_LOOKBACK_YEARS)).sum())
                out[f"cots_sightings_{km}km"] = n
        print(f"[GBIF] {key}: {len(rec)} sightings; applied to {applies.sum()} surveys in "
              f"{'/'.join(sorted(spec['oceans']))} waters")
    return out


if __name__ == "__main__":
    # Download (or just check) the sightings without re-running NOAA and fishing:
    #   python invasives.py
    for k in SPECIES:
        print(k, len(load_species(k)), "sightings ready")
