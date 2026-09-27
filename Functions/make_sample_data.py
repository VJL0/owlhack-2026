"""Generate fake GCRMN / NOAA / GFW data so the pipeline runs end to end
before the real downloads finish. Everything goes to data/sample/.

    python make_sample_data.py
    python build_dataset.py --sample
    python analyze.py --sample

The fake coral cover is built to drop with heat stress and nearby trawling,
so analyze.py should recover that. Real data will be noisier.
"""
import sys

sys.argv.append("--sample")  # make config point at data/sample/

import numpy as np
import pandas as pd

import config
from fetch_noaa import _cache_path

rng = np.random.default_rng(42)
YEARS = range(2016, 2024)
N_SITES = 40

# Reef sites scattered across a few real reef regions.
regions = [(-18.5, 147.5), (-8.5, 115.3), (12.5, -61.5), (19.8, -155.9), (-17.6, 177.4)]
sites = []
for k in range(N_SITES):
    lat0, lon0 = regions[k % len(regions)]
    sites.append((f"SITE_{k:03d}", lat0 + rng.normal(0, 0.4), lon0 + rng.normal(0, 0.4)))

# ---- NOAA: daily DHW / SSTA / BAA written straight into the cache ----------
r = config.NOAA_GRID_RES
cell_heat = {}
for sid, lat, lon in sites:
    clat = round(np.floor(lat / r) * r + r / 2, 3)
    clon = round(np.floor(lon / r) * r + r / 2, 3)
    for y in range(min(YEARS) - 1, max(YEARS) + 1):  # windows reach back a year
        path = _cache_path(clat, clon, y)
        path.parent.mkdir(parents=True, exist_ok=True)
        days = pd.date_range(f"{y}-01-01 12:00", f"{y}-12-31 12:00", freq="D")
        peak = rng.gamma(1.5, 2.5) * (2.2 if y in (2016, 2020) else 1)   # bleaching years
        season = np.clip(np.sin(np.linspace(-0.5, 2 * np.pi - 0.5, len(days))), 0, None)
        dhw = np.round(peak * season ** 2, 2)
        ssta = np.round(rng.normal(0.2, 0.4, len(days)) + dhw / 8, 2)
        baa = np.select([dhw >= 8, dhw >= 4, dhw > 0], [4, 3, 1], 0)
        pd.DataFrame({"time": days.strftime("%Y-%m-%dT%H:%M:%SZ"), "CRW_DHW": dhw,
                      "CRW_SSTANOMALY": ssta, "CRW_BAA": baa}).to_csv(path, index=False)
        cell_heat[(sid, y)] = dhw.max()

# ---- GFW: daily 0.1 deg CSVs (fleet-daily layout) -------------------------
gfw_dir = config.GFW_DIR
gfw_dir.mkdir(parents=True, exist_ok=True)
hot_spots = [(lat + rng.normal(0, 0.15), lon + rng.normal(0, 0.15), rng.gamma(1.2, 3))
             for _, lat, lon in sites[::2]]  # half the sites get a fishing ground nearby
gears = ["trawlers", "set_longlines", "purse_seines", "fixed_gear", "squid_jigger"]
res = config.GFW_CELL_RES
for day in pd.date_range(f"{min(YEARS) - 1}-01-01", f"{max(YEARS)}-12-31", freq="7D"):
    rows = []
    for hlat, hlon, intensity in hot_spots:
        for _ in range(rng.poisson(6)):
            lat = hlat + rng.normal(0, 0.12)
            lon = hlon + rng.normal(0, 0.12)
            rows.append({
                "date": day.date(), "cell_ll_lat": np.floor(lat / res) * res,
                "cell_ll_lon": np.floor(lon / res) * res, "flag": "XXX",
                "geartype": rng.choice(gears, p=[.35, .2, .15, .2, .1]),
                "hours": 0, "fishing_hours": round(rng.gamma(2, intensity), 2),
                "mmsi_present": rng.integers(1, 4),
            })
    df = pd.DataFrame(rows)
    df["hours"] = df["fishing_hours"] * 1.3
    df.to_csv(gfw_dir / f"{day.date()}.csv", index=False)

# ---- GCRMN surveys ---------------------------------------------------------
surveys = []
for sid, lat, lon in sites:
    fished = min(np.hypot(lat - h[0], lon - h[1]) for h in hot_spots) < 0.2
    cover = rng.uniform(35, 60)
    for y in YEARS:
        if rng.random() < 0.3:
            continue  # not every site is surveyed every year
        cover += 3 - 1.8 * max(cell_heat[(sid, y)] - 3, 0) - (2.5 if fished else 0) + rng.normal(0, 2)
        cover = float(np.clip(cover, 2, 80))
        date = pd.Timestamp(f"{y}-{rng.integers(3, 11):02d}-15")
        for t in range(3):  # three transects per survey
            surveys.append({
                "site_id": sid, "latitude": round(lat, 5), "longitude": round(lon, 5),
                "year": y, "survey_date": date.date(),
                "hard_coral_cover": round(cover + rng.normal(0, 3), 1),
                "macroalgae_cover": round(max(0, 40 - cover * 0.6 + rng.normal(0, 4)), 1),
                "bleaching": int(np.clip(cell_heat[(sid, y)] // 3, 0, 3)),
            })
pd.DataFrame(surveys).to_csv(config.GCRMN_FILE, index=False)
print(f"Sample data written under {config.DATA}")
