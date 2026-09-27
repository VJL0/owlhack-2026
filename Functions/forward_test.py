"""Forward-in-time test: train on earlier years, test on later years.

This is how the model is really used - predicting a future it has not seen.
(There are no diver survey results after Aug 2020 in the bleaching database,
so 2021+ cannot be scored; the latest testable years are 2019-2020.)

    pip install xgboost
    python forward_test.py                      # train 2013-2018 -> test 2019-2020
    python forward_test.py --train-end 2016     # train 2013-2016 -> test 2017-2020

Same models as xgb_temperature.py. Writes data/processed/forward_test_<split>.csv
"""
import argparse

import numpy as np
import pandas as pd
from sklearn.metrics import roc_auc_score, brier_score_loss

import config
import xgb_temperature as xt


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--train-end", type=int, default=2018, help="last year used for training")
    ap.add_argument("--allow-fallback", action="store_true")
    a = ap.parse_args()

    df = pd.read_csv(config.OUTPUT_FILE)
    d = df.dropna(subset=["percent_bleaching"] + xt.TEMP).reset_index(drop=True)
    y = (d["percent_bleaching"] >= 10).astype(int).values
    tr = (d["year"] <= a.train_end).values
    te = ~tr
    tr_years = sorted(int(v) for v in d.loc[tr, "year"].unique())
    te_years = sorted(int(v) for v in d.loc[te, "year"].unique())
    print(f"Engine: {xt.ENGINE}")
    print(f"Train: {tr_years[0]}-{tr_years[-1]} ({tr.sum()} surveys, {y[tr].mean():.0%} bleached)")
    print(f"Test:  {te_years[0]}-{te_years[-1]} ({te.sum()} surveys, {y[te].mean():.0%} bleached)\n")

    rows = []
    for name, (feats, build) in xt.MODELS.items():
        m = build(feats).fit(d.loc[tr, feats].values, y[tr])
        p = m.predict_proba(d.loc[te, feats].values)[:, 1]
        row = {"model": name, "test_auc_all": roc_auc_score(y[te], p), "brier": brier_score_loss(y[te], p),
               "mean_predicted": p.mean(), "actual_rate": y[te].mean()}
        for yr in te_years:
            k = (d.loc[te, "year"] == yr).values
            row[f"auc_{yr}"] = roc_auc_score(y[te][k], p[k]) if len(set(y[te][k])) > 1 else np.nan
        rows.append(row)

    res = pd.DataFrame(rows).set_index("model")
    print("Results on the future years (AUC: higher is better, 0.5 = coin flip;")
    print("Brier: lower is better; mean_predicted vs actual_rate = is the overall level right?)")
    print(res.round(3).to_string())
    base = res.loc["logistic_dhw30", "test_auc_all"]
    alt = res.drop(index="logistic_dhw30")["test_auc_all"]
    best, diff = alt.idxmax(), alt.max() - base
    if diff < 0.02:
        print(f"\nVerdict: logistic_dhw30 holds up (best XGBoost, {best}, is {diff:+.3f} AUC vs logistic).")
    else:
        print(f"\nVerdict: {best} does better on the future years (+{diff:.3f} AUC over logistic).")
    over = res.loc["logistic_dhw30", "mean_predicted"] / res.loc["logistic_dhw30", "actual_rate"]
    print(f"Level check: logistic predicted {res.loc['logistic_dhw30', 'mean_predicted']:.0%} bleached vs "
          f"{res.loc['logistic_dhw30', 'actual_rate']:.0%} actual ({over:.1f}x). Ranking is the reliable part.")
    out = config.DATA_OUT / f"forward_test_train_to_{a.train_end}.csv"
    res.to_csv(out)
    print(f"Wrote {out}")


if __name__ == "__main__":
    main()
