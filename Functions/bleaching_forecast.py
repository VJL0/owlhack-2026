"""Bleaching risk forecast for 2027-2031: heat forecast -> bleaching model.

Chains the two validated models:
  forecast_heat.py  -> each reef's forecast peak heat stress (DHW) for 2027-2031
  predict_v2.py     -> chance of significant bleaching (>= 10% of coral) given that heat

predict_v2 also needs the SHAPE of the heat event (how fast DHW built, SST anomaly...),
which a yearly forecast does not give. So each forecast year borrows the typical shape of
real 2021-2026 events at reefs in the same ocean with a similar peak (median of the 25
closest events, as a ratio of their peak). Survey assumed 2 weeks after the peak, as in
predict_v2. `--check` shows how much this shortcut changes the 2021-2026 predictions.

    python bleaching_forecast.py [--check]

Replaces scenario.py (which assumed the next five years repeat the last five).
Writes data/processed/bleaching_forecast_2027_2031.csv
"""
import argparse

import numpy as np
import pandas as pd
from scipy.stats import spearmanr

import config
import predict_v2 as P

K = 25
RATIO = ["dhw_at_survey", "peak_dhw_180d"]            # scale with the peak
ABSOLUTE = ["dhw_change_4wk", "days_dhw4_90d", "sst_anomaly_30d"]


def event_library():
    f = pd.read_csv(config.DATA_OUT / "future_timing_features.csv")
    risk = pd.read_csv(sorted(config.DATA_OUT.glob("bleaching_risk_v2_*.csv"))[-1])
    f = f.merge(risk[["reef_id", "year", "ocean", "latitude"]], on=["reef_id", "year"])
    f = f.dropna(subset=["max_dhw_30d"] + RATIO + ABSOLUTE).copy()
    f["dhw_change_4wk"] = f["dhw_change_4wk"].fillna(0)
    peak = f["max_dhw_30d"].clip(lower=0.01)
    for c in RATIO:
        f[c + "_ratio"] = f[c] / peak
    return f


def shape_features(target, lib, exclude_self=False):
    """target: ocean, peak (max_dhw_30d). Returns the timing features predict_v2 needs."""
    out = pd.DataFrame(index=target.index)
    cols = [c + "_ratio" for c in RATIO] + ABSOLUTE
    vals = np.full((len(target), len(cols)), np.nan)
    for oc, g in target.groupby("ocean"):
        L = lib[lib["ocean"] == oc]
        if len(L) < K:
            L = lib
        lp = np.log1p(L["max_dhw_30d"].to_numpy())
        lv = L[cols].to_numpy()
        keys = list(zip(L["reef_id"], L["year"])) if exclude_self else None
        for j, (i, row) in enumerate(g.iterrows()):
            d = np.abs(lp - np.log1p(row["max_dhw_30d"]))
            if exclude_self:
                d = d.copy()
                d[[k == (row["reef_id"], row["year"]) for k in keys]] = np.inf
            nn = np.argpartition(d, K)[:K]
            vals[target.index.get_loc(i)] = np.median(lv[nn], axis=0)
    for n, c in enumerate(cols):
        out[c] = vals[:, n]
    peak = target["max_dhw_30d"]
    for c in RATIO:
        out[c] = out.pop(c + "_ratio") * peak
    out["days_since_peak"] = np.where(peak > 0, 14, np.nan)
    return out


def check(model, lib):
    """Real 2021-2026 features vs the borrowed-shape shortcut, same reefs and peaks."""
    s = lib.sample(min(3000, len(lib)), random_state=0).copy()
    real = model.predict_proba(P.design(s))
    approx_feats = shape_features(s[["reef_id", "year", "ocean", "max_dhw_30d"]], lib, exclude_self=True)
    a = s.copy()
    for c in approx_feats:
        a[c] = approx_feats[c]
    approx = model.predict_proba(P.design(a))
    print(f"Shortcut check on {len(s)} real 2021-2026 reef-years:")
    print(f"  mean P(significant bleaching): real features {real.mean():.3f}, shortcut {approx.mean():.3f}")
    print(f"  typical difference {np.median(np.abs(real - approx)):.3f}, 90% within "
          f"{np.quantile(np.abs(real - approx), 0.9):.3f}; rank agreement (Spearman) "
          f"{spearmanr(real, approx).statistic:.3f}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    a = ap.parse_args()

    d = P.load_training()
    model = P.SeverityModel().fit(P.design(d), d["percent_bleaching"].to_numpy(float))
    lib = event_library()
    if a.check:
        check(model, lib)

    fc = pd.read_csv(config.DATA_OUT / "heat_forecast_2027_2031.csv")
    fc["max_dhw_30d"] = fc["forecast_peak_dhw"]
    feats = shape_features(fc[["ocean", "max_dhw_30d"]], lib)
    X = pd.concat([fc, feats], axis=1)
    X["dhw_change_4wk"] = X["dhw_change_4wk"].fillna(0)
    Xd = P.design(X)
    fc["p_significant_bleaching"] = model.predict_proba(Xd).round(4)
    fc["predicted_pct_bleached"] = model.predict_severity(Xd).round(1)
    fc["risk_band"] = pd.cut(fc["p_significant_bleaching"], [-0.01, 0.25, 0.5, 0.75, 1.0],
                             labels=["low", "moderate", "high", "very high"])
    fc["beyond_training_dhw"] = fc["forecast_peak_dhw"] > d["max_dhw_30d"].max()
    cols = ["reef_id", "latitude", "longitude", "ocean", "year", "horizon",
            "forecast_peak_dhw", "p_dhw_over_4", "p_dhw_over_8", "heat_band",
            "p_significant_bleaching", "predicted_pct_bleached", "risk_band",
            "recent5_mean_peak_dhw", "beyond_training_dhw"]
    out = config.DATA_OUT / "bleaching_forecast_2027_2031.csv"
    fc[cols].to_csv(out, index=False)
    print(f"\nWrote {len(fc)} reef-years -> {out}")
    s = fc.groupby("year").agg(median_peak_dhw=("forecast_peak_dhw", "median"),
                               mean_p_bleach=("p_significant_bleaching", "mean"),
                               pct_high=("risk_band", lambda b: b.isin(["high", "very high"]).mean()))
    s["mean_p_bleach"] = (s["mean_p_bleach"] * 100).round(0)
    s["pct_high"] = (s["pct_high"] * 100).round(0)
    print("By year (mean_p_bleach = average chance of significant bleaching, %; "
          "pct_high = % of reefs high or very high):")
    print(s.round(1).to_string())
    print(f"{int(fc['beyond_training_dhw'].sum())} reef-years forecast hotter than any survey the "
          f"bleaching model was trained on (flagged beyond_training_dhw).")


if __name__ == "__main__":
    main()
