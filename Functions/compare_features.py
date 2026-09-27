"""Do the new reef-history features make bleaching predictions better?

    python fetch_history.py        # once, downloads the new features
    python compare_features.py

Every model is scored three ways on years it never saw:
  loyo       hold out each year in turn, train on the rest (mean AUC)
  fwd_2018   train 2013-2018, test 2019-2020
  fwd_2016   train 2013-2016, test 2017-2020
AUC: higher is better (0.5 = coin flip).
level = mean predicted bleaching / actual bleaching on the forward tests
        (1.0 = right level; the current model is ~2-3x too high).

A feature is worth keeping only if it helps in all three tests.
Writes data/processed/feature_comparison.csv
"""
import sys

import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import FunctionTransformer, StandardScaler

import config

PLUS = config.DATA_OUT / "reef_stress_plus.csv"
LOG = {"max_dhw_30d", "past_heat_dhw", "max_dhw_90d", "max_dhw"}   # heat measures: log(1+x)

MODELS = {
    "current (heat 30d)":        ["max_dhw_30d"],
    "+ past heat":               ["max_dhw_30d", "past_heat_dhw"],
    "+ normal temperature":      ["max_dhw_30d", "sst_warmest_month_normal"],
    "+ depth":                   ["max_dhw_30d", "depth_m"],
    "+ all three":               ["max_dhw_30d", "past_heat_dhw", "sst_warmest_month_normal", "depth_m"],
}
TEMP = ["max_dhw_30d", "max_dhw_90d", "max_dhw", "mean_sst_anomaly", "max_sst_anomaly",
        "days_bleaching_alert"]


class Logistic:
    def __init__(self, feats):
        self.feats = feats
        idx = [i for i, f in enumerate(feats) if f in LOG]

        def tx(X):
            X = X.astype(float).copy()
            X[:, idx] = np.log1p(np.clip(X[:, idx], 0, None))
            return X
        self.m = make_pipeline(FunctionTransformer(tx), StandardScaler(), LogisticRegression(max_iter=1000))

    def fit(self, X, y):
        self.m.fit(X, y)
        return self

    def predict_proba(self, X):
        return self.m.predict_proba(X)

    def coefs(self):
        return dict(zip(self.feats, self.m[-1].coef_[0]))


def xgb_available():
    try:
        import xgb_temperature as xt
        return xt
    except SystemExit:
        return None


def score(build, feats, d, y):
    X = d[feats].values
    years = sorted(d["year"].unique())
    loyo = []
    for yr in years:
        te = (d["year"] == yr).values
        if len(set(y[te])) > 1:
            p = build(feats).fit(X[~te], y[~te]).predict_proba(X[te])[:, 1]
            loyo.append(roc_auc_score(y[te], p))
    row = {"loyo": np.mean(loyo)}
    for end in (2018, 2016):
        tr = (d["year"] <= end).values
        p = build(feats).fit(X[tr], y[tr]).predict_proba(X[~tr])[:, 1]
        row[f"fwd_{end}"] = roc_auc_score(y[~tr], p)
        row[f"level_{end}"] = p.mean() / y[~tr].mean()
    return row


def main():
    if not PLUS.exists():
        sys.exit(f"{PLUS} not found. Run python fetch_history.py first.")
    df = pd.read_csv(PLUS)
    new = ["past_heat_dhw", "sst_warmest_month_normal", "depth_m"]
    have = [c for c in new if c in df and df[c].notna().mean() > 0.5]
    models = {k: v for k, v in MODELS.items() if all(f in have or f == "max_dhw_30d" for f in v)}
    if len(models) < len(MODELS):
        print(f"Skipping models needing features not yet filled: "
              f"{sorted(set(MODELS) - set(models))}")
    used = sorted({f for v in models.values() for f in v})
    df["depth_m"] = df["depth_m"].fillna(df["depth_m"].median())
    d = df.dropna(subset=["percent_bleaching"] + used + TEMP).reset_index(drop=True)
    y = (d["percent_bleaching"] >= 10).astype(int).values
    print(f"{len(d)} of {len(df)} surveys have every feature; all models use these same surveys\n")

    rows = []
    for name, feats in models.items():
        rows.append({"model": name, **score(lambda f: Logistic(f), feats, d, y)})
    xt = xgb_available()
    if xt is not None:
        allf = TEMP + [f for f in have if f not in TEMP]
        mono = dict(xt.MONO, past_heat_dhw=0, sst_warmest_month_normal=0, depth_m=0)
        xt.MONO.update(mono)
        rows.append({"model": f"xgb_monotone (all temp + new) [{xt.ENGINE.split()[0]}]",
                     **score(lambda f: xt.make_xgb(f, monotone=True), allf, d, y)})
    res = pd.DataFrame(rows).set_index("model")
    print(res.round(3).to_string())

    base = res.iloc[0]
    print("\nChange vs current model (AUC):")
    verdicts = []
    for name, r in res.iloc[1:].iterrows():
        diff = r[["loyo", "fwd_2018", "fwd_2016"]] - base[["loyo", "fwd_2018", "fwd_2016"]]
        keep = (diff > 0).all() and diff.mean() >= 0.01
        verdicts.append(keep)
        print(f"  {name:32s} loyo {diff['loyo']:+.3f}  fwd_2018 {diff['fwd_2018']:+.3f}  "
              f"fwd_2016 {diff['fwd_2016']:+.3f}  -> {'KEEP' if keep else 'no clear gain'}")
    res["keep"] = [False] + verdicts

    # direction of each feature in the full model, trained on all years
    if "+ all three" in models:
        m = Logistic(models["+ all three"]).fit(d[models["+ all three"]].values, y)
        print("\nDirection in the combined model (standardised; + raises bleaching risk):")
        for f, c in m.coefs().items():
            print(f"  {f:26s} {c:+.2f}")

    out = config.DATA_OUT / "feature_comparison.csv"
    res.to_csv(out)
    print(f"\nWrote {out}")


if __name__ == "__main__":
    main()
