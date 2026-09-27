"""XGBoost on the temperature data vs the current logistic heat-stress model.

    pip install xgboost          # once
    python xgb_temperature.py

Target: significant bleaching (>= 10% of coral bleached), same as predict.py.
Every model is scored the same honest way: hold out one whole year, train on
the others, measure AUC on the held-out year, repeat for every year.

Models:
  logistic_dhw30   current model: logistic on log(1 + DHW in 30 days before survey)
  xgb_all_temp     XGBoost on all six temperature features
  xgb_monotone     same, but more heat can only RAISE predicted risk
                   (physics constraint; often generalises better to new years)
  xgb_dhw_only     XGBoost on the three DHW windows only

Writes data/processed/xgb_comparison.csv and xgb_importance.csv.
"""
import sys

import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score, brier_score_loss

import config

TEMP = ["max_dhw_30d", "max_dhw_90d", "max_dhw", "mean_sst_anomaly", "max_sst_anomaly", "days_bleaching_alert"]
DHW = ["max_dhw_30d", "max_dhw_90d", "max_dhw"]
# +1 = prediction may only go up as the feature goes up; 0 = unconstrained
MONO = {"max_dhw_30d": 1, "max_dhw_90d": 1, "max_dhw": 1, "mean_sst_anomaly": 0,
        "max_sst_anomaly": 1, "days_bleaching_alert": 1}

try:
    from xgboost import XGBClassifier
    ENGINE = "xgboost"
except ImportError:
    if "--allow-fallback" not in sys.argv:
        sys.exit("xgboost is not installed. Run:  pip install xgboost")
    from sklearn.ensemble import HistGradientBoostingClassifier
    ENGINE = "sklearn HistGradientBoosting (stand-in, NOT xgboost)"


def make_xgb(features, monotone=False):
    if ENGINE == "xgboost":
        kw = dict(n_estimators=300, max_depth=3, learning_rate=0.05, subsample=0.8,
                  colsample_bytree=0.8, min_child_weight=5, reg_lambda=1.0,
                  eval_metric="logloss", random_state=0, n_jobs=-1)
        if monotone:
            kw["monotone_constraints"] = "(" + ",".join(str(MONO[f]) for f in features) + ")"
        return XGBClassifier(**kw)
    kw = dict(max_iter=300, max_depth=3, learning_rate=0.05, min_samples_leaf=20, random_state=0)
    if monotone:
        kw["monotonic_cst"] = [MONO[f] for f in features]
    return HistGradientBoostingClassifier(**kw)


class Logistic:
    """The current predict.py model, wrapped to look like the others."""
    def fit(self, X, y):
        self.m = LogisticRegression().fit(np.log1p(X), y)
        return self

    def predict_proba(self, X):
        return self.m.predict_proba(np.log1p(X))


MODELS = {
    "logistic_dhw30": (["max_dhw_30d"], lambda f: Logistic()),
    "xgb_all_temp": (TEMP, lambda f: make_xgb(f)),
    "xgb_monotone": (TEMP, lambda f: make_xgb(f, monotone=True)),
    "xgb_dhw_only": (DHW, lambda f: make_xgb(f, monotone=True)),
}


def main():
    df = pd.read_csv(config.OUTPUT_FILE)
    missing = [c for c in TEMP if c not in df]
    if missing:
        sys.exit(f"Missing {missing}: rerun python build_dataset.py")
    d = df.dropna(subset=["percent_bleaching"] + TEMP).reset_index(drop=True)
    y = (d["percent_bleaching"] >= 10).astype(int).values
    years = sorted(int(v) for v in d["year"].unique())
    print(f"Engine: {ENGINE}")
    print(f"{len(d)} surveys, {y.mean():.0%} with significant bleaching; holding out each of {years}\n")

    rows = []
    for name, (feats, build) in MODELS.items():
        X = d[feats].values
        for yr in years:
            te = (d["year"] == yr).values
            if len(set(y[te])) < 2:
                continue
            m = build(feats).fit(X[~te], y[~te])
            p = m.predict_proba(X[te])[:, 1]
            rows.append({"model": name, "year": yr, "auc": roc_auc_score(y[te], p),
                         "brier": brier_score_loss(y[te], p), "n": int(te.sum())})
        r = [x for x in rows if x["model"] == name]
        print(f"  {name:15s} mean AUC {np.mean([x['auc'] for x in r]):.3f}   "
              f"(worst year {min(x['auc'] for x in r):.2f}, best {max(x['auc'] for x in r):.2f})")

    res = pd.DataFrame(rows)
    table = res.pivot(index="year", columns="model", values="auc")[list(MODELS)]
    print("\nHeld-out-year AUC by year (higher is better; 0.5 = coin flip):")
    print(table.round(3).to_string())
    base = table["logistic_dhw30"]
    print("\nCompared with the current logistic model:")
    summary = []
    for name in list(MODELS)[1:]:
        diff = table[name] - base
        wins = int((diff > 0).sum())
        summary.append((name, table[name].mean(), diff.mean(), wins))
        print(f"  {name:15s} {diff.mean():+.3f} mean AUC; better in {wins} of {len(diff)} years")

    best = max(summary, key=lambda s: s[1])
    if best[2] > 0.02 and best[3] >= len(base) * 0.75:
        verdict = (f"{best[0]} beats the logistic model clearly (+{best[2]:.3f} AUC, better in "
                   f"{best[3]}/{len(base)} years). Worth switching.")
    elif best[2] > 0:
        verdict = (f"{best[0]} is slightly better (+{best[2]:.3f} AUC, better in {best[3]}/{len(base)} "
                   f"years) - too small/inconsistent to justify a less explainable model.")
    else:
        verdict = "XGBoost does not beat the simple logistic model on unseen years. Keep logistic."
    print(f"\nVerdict: {verdict}")

    # Feature importance from the monotone model trained on all years
    m = make_xgb(TEMP, monotone=True).fit(d[TEMP].values, y)
    if ENGINE == "xgboost":
        gain = m.get_booster().get_score(importance_type="gain")
        imp = pd.Series({TEMP[int(k[1:])] if k.startswith("f") and k[1:].isdigit() else k: v
                         for k, v in gain.items()}).reindex(TEMP).fillna(0)
        imp = (imp / imp.sum()).sort_values(ascending=False)
        label = "share of total gain"
    else:
        from sklearn.inspection import permutation_importance
        pi = permutation_importance(m, d[TEMP].values, y, scoring="roc_auc", n_repeats=10, random_state=0)
        imp = pd.Series(pi.importances_mean, index=TEMP).sort_values(ascending=False)
        label = "drop in AUC when shuffled"
    print(f"\nWhat the monotone XGBoost relies on ({label}):")
    print(imp.round(3).to_string())

    res.to_csv(config.DATA_OUT / "xgb_comparison.csv", index=False)
    imp.rename("importance").to_csv(config.DATA_OUT / "xgb_importance.csv")
    print(f"\nWrote {config.DATA_OUT / 'xgb_comparison.csv'} and xgb_importance.csv")


if __name__ == "__main__":
    main()
