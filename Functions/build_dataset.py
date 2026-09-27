"""Run the whole pipeline: GCRMN + NOAA CRW + GFW -> reef_stress_analysis.csv

    python build_dataset.py            # everything
    python build_dataset.py --no-gfw   # skip fishing (e.g. before GFW data arrives)
    python build_dataset.py --limit 20 # first 20 reef-surveys, for a quick test
    python build_dataset.py --sample   # fake data (run make_sample_data.py first)
    python build_dataset.py --no-invasive  # skip lionfish / crown-of-thorns
"""
import argparse

import config
from fetch_noaa import noaa_features
from gfw_effort import gfw_features, load_gfw_near
from invasives import invasive_features
from load_gcrmn import load_gcrmn


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-gfw", action="store_true")
    ap.add_argument("--no-noaa", action="store_true")
    ap.add_argument("--no-invasive", action="store_true", help="skip lionfish / crown-of-thorns")
    ap.add_argument("--limit", type=int)
    ap.add_argument("--sample", action="store_true", help="use fake data in data/sample/")
    a = ap.parse_args()

    reefs = load_gcrmn()
    if a.limit:
        reefs = reefs.head(a.limit)
    print(f"{len(reefs)} reef-surveys at {reefs['reef_id'].nunique()} sites")
    out = reefs.copy()

    if not a.no_noaa:
        out = out.merge(noaa_features(reefs), on="survey_id", how="left")
    if not a.no_gfw:
        out = out.merge(gfw_features(reefs, load_gfw_near(reefs)),
                        on="survey_id", how="left")

    if not a.no_invasive:
        out = out.merge(invasive_features(reefs), on="survey_id", how="left")

    out = out.drop(columns=["noaa_lat", "noaa_lon", "survey_id"])
    assert len(out) == len(reefs), "row count changed during joins"
    config.DATA_OUT.mkdir(parents=True, exist_ok=True)
    out.to_csv(config.OUTPUT_FILE, index=False)
    print(f"\nWrote {len(out)} rows x {out.shape[1]} cols -> {config.OUTPUT_FILE}")
    print("\nMissing values per column (lionfish_* is blank outside the Atlantic and")
    print("cots_* outside the Pacific/Indian Ocean, by design):")
    print(out.isna().sum()[lambda s: s > 0].to_string() or "  none")


if __name__ == "__main__":
    main()
