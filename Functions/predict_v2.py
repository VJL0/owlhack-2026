"""Bleaching risk, version 2: heat + heat timing + region-specific thresholds,
trained on bleaching SEVERITY (the full % bleached, not just yes/no).

Scored on years it never saw (same tests as before):
                         leave-one-year-out  train->2018  train->2016  held-out reefs
  v1 (30-day heat only)        0.762            0.695        0.684         0.809
  v2 (this model)              0.821            0.757        0.762         0.893

    python timing_features.py     # once (uses cached NOAA data)
    python future_timing.py       # once
    python predict_v2.py          # add --validate to rerun the tests above

Future years: predicted for a survey 2 weeks after that year's heat peak,
i.e. bleaching at the height of the event.
Writes data/processed/bleaching_risk_v2_2021_2026.csv
"""
import argparse

import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression, Ridge
from sklearn.metrics import roc_auc_score
from sklearn.model_selection import GroupKFold
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

import config

OCEANS = ["Arabian Gulf", "Atlantic", "Indian", "Pacific", "Red Sea"]
TIMING = ["dhw_at_survey", "dhw_change_4wk", "days_since_peak", "peak_dhw_180d",
          "days_dhw4_90d", "sst_anomaly_30d"]


def design(df):
    """Features: heat, heat timing, ocean, ocean x heat (each ocean gets its own
    heat threshold), distance from the equator."""
    h = np.log1p(df["max_dhw_30d"].to_numpy(float))[:, None]
    O = np.column_stack([(df["ocean"] == o).to_numpy(float) for o in OCEANS])
    t = np.column_stack([
        np.log1p(df["dhw_at_survey"]), df["dhw_change_4wk"],
        df["days_since_peak"].fillna(365) / 100, np.log1p(df["peak_dhw_180d"]),
        np.log1p(df["days_dhw4_90d"]), df["sst_anomaly_30d"]])
    return np.column_stack([h, t, O, O * h, np.abs(df["latitude"].to_numpy(float)) / 10])


class SeverityModel:
    """Ridge regression on logit(% bleached) gives a severity score; a one-variable
    logistic turns the score into P(>= 10% bleached)."""
    def fit(self, X, pct):
        z = np.log((pct + 1) / (101 - pct))
        self.reg = make_pipeline(StandardScaler(), Ridge(alpha=1.0)).fit(X, z)
        self.cal = LogisticRegression().fit(self.reg.predict(X)[:, None], (pct >= 10).astype(int))
        return self

    def predict_severity(self, X):
        z = self.reg.predict(X)
        return np.clip(101 / (1 + np.exp(-z)) - 1, 0, 100)

    def predict_proba(self, X):
        return self.cal.predict_proba(self.reg.predict(X)[:, None])[:, 1]


def load_training():
    a = pd.read_csv(config.OUTPUT_FILE)
    t = pd.read_csv(config.DATA_OUT / "timing_features.csv")
    if not ((a["reef_id"].values == t["reef_id"].values).all()
            and (a["window_end"].values == t["window_end"].values).all()):
        raise SystemExit("timing_features.csv is out of date: rerun python timing_features.py")
    d = pd.concat([a, t[TIMING]], axis=1)
    return d.dropna(subset=["percent_bleaching", "max_dhw_30d"] + TIMING[:2] + TIMING[3:]).reset_index(drop=True)


def validate(d):
    X, pct = design(d), d["percent_bleaching"].to_numpy(float)
    y = (pct >= 10).astype(int)
    loyo = []
    for yr in sorted(d["year"].unique()):
        te = (d["year"] == yr).to_numpy()
        loyo.append(roc_auc_score(y[te], SeverityModel().fit(X[~te], pct[~te]).predict_proba(X[te])))
    print(f"  leave-one-year-out AUC {np.mean(loyo):.3f} (worst year {min(loyo):.2f})")
    for end in (2018, 2016):
        tr = (d["year"] <= end).to_numpy()
        p = SeverityModel().fit(X[tr], pct[tr]).predict_proba(X[~tr])
        print(f"  train to {end}, test after: AUC {roc_auc_score(y[~tr], p):.3f}, "
              f"predicted {p.mean():.0%} vs actual {y[~tr].mean():.0%} bleached")
    p = np.zeros(len(d))
    for tr, te in GroupKFold(5).split(X, y, d["reef_id"]):
        p[te] = SeverityModel().fit(X[tr], pct[tr]).predict_proba(X[te])
    print(f"  held-out reefs AUC {roc_auc_score(y, p):.3f}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--validate", action="store_true")
    a = ap.parse_args()

    d = load_training()
    print(f"Training on {len(d)} surveys, {d['year'].min()}-{d['year'].max()}")
    if a.validate:
        validate(d)
    model = SeverityModel().fit(design(d), d["percent_bleaching"].to_numpy(float))

    fut = pd.read_csv(config.DATA_OUT / "future_timing_features.csv")
    fut["reef_id"] = fut["reef_id"].astype(int)
    fut["year"] = fut["year"].astype(int)
    # peaks in early January have no data 4 weeks back: treat the change as flat
    fut["dhw_change_4wk"] = fut["dhw_change_4wk"].fillna(0)
    reefs = d.drop_duplicates("reef_id").set_index("reef_id")
    fut["ocean"] = fut["reef_id"].map(reefs["ocean"])
    fut["latitude"] = fut["reef_id"].map(reefs["latitude"])
    fut["longitude"] = fut["reef_id"].map(reefs["longitude"])
    ok = fut.dropna(subset=["max_dhw_30d", "ocean"] + TIMING[:2] + TIMING[3:]).index
    fut["p_significant_bleaching"] = np.nan
    fut["predicted_pct_bleached"] = np.nan
    X = design(fut.loc[ok])
    fut.loc[ok, "p_significant_bleaching"] = model.predict_proba(X).round(4)
    fut.loc[ok, "predicted_pct_bleached"] = model.predict_severity(X).round(1)
    fut["peak_dhw"] = fut["max_dhw_30d"]
    fut["risk_band"] = pd.cut(fut["p_significant_bleaching"], [-0.01, 0.25, 0.5, 0.75, 1.0],
                              labels=["low", "moderate", "high", "very high"])
    fut["beyond_training_dhw"] = fut["peak_dhw"] > d["max_dhw_30d"].max()
    cols = ["reef_id", "latitude", "longitude", "ocean", "year", "peak_dhw",
            "p_significant_bleaching", "predicted_pct_bleached", "risk_band",
            "assumed_survey_date", "beyond_training_dhw"]
    years = fut["year"].dropna().astype(int)
    out = config.DATA_OUT / f"bleaching_risk_v2_{years.min()}_{years.max()}.csv"
    fut[cols].to_csv(out, index=False)
    print(f"\nWrote {len(fut)} reef-years -> {out}")
    s = fut.groupby("year").agg(reefs=("reef_id", "nunique"),
                                mean_p=("p_significant_bleaching", "mean"),
                                pct_high=("risk_band", lambda b: b.isin(["high", "very high"]).mean()))
    s["mean_p"] = (s["mean_p"] * 100).round(0)
    s["pct_high"] = (s["pct_high"] * 100).round(0)
    print("By year (mean_p = average chance of significant bleaching, %; "
          "pct_high = % of reefs high or very high):")
    print(s.to_string())


if __name__ == "__main__":
    main()
