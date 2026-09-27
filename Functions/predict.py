"""Bleaching risk for reefs in years with no surveys (2021+).

What the data showed: heat stress in the 30 days BEFORE a survey (max DHW)
predicts whether that survey found significant bleaching, and it holds up on
years the model never saw (held-out-year AUC ~0.76). Longer windows and
random forests did worse. So this script uses a simple, transparent model:

    P(>= THRESHOLD % of coral bleached)  =  logistic( log(1 + DHW) )

fitted on the 2013-2020 surveys. For each surveyed reef and each prediction
year it takes that year's PEAK heat stress (the highest DHW of the year) and
reports the probability of significant bleaching at that peak.

    python predict.py                       # 2021-2025
    python predict.py --years 2023 2024     # the 2023-24 global bleaching event
    python predict.py --threshold 20        # "significant" = 20% bleached instead of 10%

These are MODEL ESTIMATES, not observations. Say so on the slide.
"""
import argparse
import sys

import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score

import config
from fetch_noaa import noaa_features

FEATURE = "max_dhw_30d"        # heat stress in the 30 days before a survey


def fit(x, y):
    return LogisticRegression().fit(np.log1p(np.asarray(x, float).reshape(-1, 1)), y)


def prob(model, x):
    return model.predict_proba(np.log1p(np.asarray(x, float).reshape(-1, 1)))[:, 1]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--years", type=int, nargs="+", default=[2021, 2022, 2023, 2024, 2025])
    ap.add_argument("--target", default="percent_bleaching")
    ap.add_argument("--threshold", type=float, default=10, help="percent bleached that counts as significant")
    ap.add_argument("--limit-sites", type=int)
    ap.add_argument("--sample", action="store_true")
    ap.add_argument("--no-gfw", action="store_true", help="accepted for compatibility; fishing is not used")
    a = ap.parse_args()

    # ---- 1. Fit on surveys -----------------------------------------------------
    train = pd.read_csv(config.OUTPUT_FILE)
    if FEATURE not in train:
        sys.exit(f"'{FEATURE}' missing. Rerun: python build_dataset.py --no-gfw")
    if a.target not in train:
        sys.exit(f"'{a.target}' missing from {config.OUTPUT_FILE.name}")
    train = train.dropna(subset=[a.target, FEATURE])
    bleached = train[a.target] >= a.threshold
    print(f"Fitting on {len(train)} surveys ({train['year'].min()}-{train['year'].max()}); "
          f"'significant' = {a.target} >= {a.threshold:g}  ({bleached.mean():.0%} of surveys)")

    # Honest skill check: hold out each year, fit on the rest, score the held-out year.
    aucs = []
    for y in sorted(train["year"].unique()):
        tr, te = train["year"] != y, train["year"] == y
        if bleached[te].nunique() < 2 or bleached[tr].nunique() < 2:
            continue
        m = fit(train.loc[tr, FEATURE], bleached[tr])
        aucs.append((y, roc_auc_score(bleached[te], prob(m, train.loc[te, FEATURE]))))
    print("Held-out-year AUC (0.5 = coin flip, 1 = perfect): " +
          ", ".join(f"{y}: {s:.2f}" for y, s in aucs) + f"  | mean {np.mean([s for _, s in aucs]):.2f}")

    model = fit(train[FEATURE], bleached)
    print("\nRisk curve:  DHW -> P(significant bleaching)")
    for v in (0, 2, 4, 8, 12, 16):
        print(f"  {v:>2} degC-weeks: {prob(model, [v])[0]:.0%}")

    # ---- 2. One row per reef per prediction year --------------------------------
    sites = train[["reef_id", "latitude", "longitude"]].drop_duplicates("reef_id")
    if a.limit_sites:
        sites = sites.head(a.limit_sites)
    grid = sites.merge(pd.DataFrame({"year": a.years}), how="cross")
    grid["survey_id"] = range(len(grid))
    grid["window_start"] = pd.to_datetime(grid["year"].astype(str) + "-01-01")
    grid["window_end"] = pd.to_datetime(grid["year"].astype(str) + "-12-31 23:59")
    r = config.NOAA_GRID_RES
    grid["noaa_lat"] = (np.floor(grid["latitude"] / r) * r + r / 2).round(3)
    grid["noaa_lon"] = (np.floor(grid["longitude"] / r) * r + r / 2).round(3)
    print(f"\nEstimating {len(grid)} reef-years ({len(sites)} reefs x {len(a.years)} years)")

    grid = grid.merge(noaa_features(grid), on="survey_id", how="left")
    grid = grid.rename(columns={"max_dhw": "peak_dhw"})

    # ---- 3. Probability at each reef's peak heat of the year ---------------------
    ok = grid["peak_dhw"].notna()
    grid.loc[ok, "p_significant_bleaching"] = prob(model, grid.loc[ok, "peak_dhw"])
    grid["risk_band"] = pd.cut(grid["peak_dhw"], [-np.inf, 0.01, 4, 8, np.inf],
                               labels=["none", "watch (0-4)", "significant (4-8)", "severe (8+)"])
    grid["beyond_training_dhw"] = grid["peak_dhw"] > train[FEATURE].max()

    out = config.DATA_OUT / f"bleaching_risk_{min(a.years)}_{max(a.years)}.csv"
    cols = ["reef_id", "latitude", "longitude", "year", "peak_dhw", "max_sst_anomaly",
            "p_significant_bleaching", "risk_band", "beyond_training_dhw"]
    grid[[c for c in cols if c in grid]].to_csv(out, index=False)

    # ---- 4. Summary --------------------------------------------------------------
    print(f"\nWrote {int(ok.sum())} reef-years -> {out}")
    if (~ok).any():
        print(f"{int((~ok).sum())} reef-years had no NOAA data and were skipped")
    s = grid[ok].groupby("year").agg(
        reefs=("reef_id", "size"),
        mean_peak_dhw=("peak_dhw", "mean"),
        pct_over_4=("peak_dhw", lambda v: (v >= 4).mean() * 100),
        pct_over_8=("peak_dhw", lambda v: (v >= 8).mean() * 100),
        expected_pct_bleached=("p_significant_bleaching", lambda v: v.mean() * 100),
    )
    print("\nBy year (pct_over_4 / pct_over_8 = share of reefs past NOAA's bleaching / severe thresholds;")
    print(" expected_pct_bleached = estimated share of reefs with significant bleaching at peak heat):")
    print(s.round(1).to_string())
    n = int(grid["beyond_training_dhw"].sum())
    if n:
        print(f"\n{n} reef-years exceed the highest heat stress in the training surveys "
              f"({train[FEATURE].max():.1f}); the curve extends past its data there.")


if __name__ == "__main__":
    main()
