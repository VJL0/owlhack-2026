"""Quick first model: which stressors best predict coral cover?

    python analyze.py                            # predicts hard coral cover
    python analyze.py --target percent_bleaching # predicts bleaching instead
    python analyze.py --sample                   # sample output
    python analyze.py --group year               # hold out whole years (tests prediction of new years)
    python analyze.py --group cell               # hold out whole 5 km NOAA pixels (no near-twin sites)
    python analyze.py --features max_dhw         # restrict to some features (comma-separated)

Cross-validation is grouped by reef site, so the model is scored on sites it
never saw. Without that, repeat surveys of the same reef leak into the test
set and the score looks far better than it is.
"""
import sys

import pandas as pd
from sklearn.ensemble import RandomForestRegressor
from sklearn.inspection import permutation_importance
from sklearn.model_selection import GroupKFold, cross_val_score

import config

import numpy as np

TARGET = sys.argv[sys.argv.index("--target") + 1] if "--target" in sys.argv else "hard_coral_cover_pct"
GROUP = sys.argv[sys.argv.index("--group") + 1] if "--group" in sys.argv else "site"
ONLY = sys.argv[sys.argv.index("--features") + 1].split(",") if "--features" in sys.argv else None

df = pd.read_csv(config.OUTPUT_FILE)
features = [c for c in df.columns if c.startswith(("max_dhw", "mean_sst", "max_sst", "days_bleach",
                                                   "fishing_", "trawler_", "lionfish_", "cots_"))]
if ONLY:
    features = [f for f in features if f in ONLY]
if TARGET not in df:
    sys.exit(f"No column '{TARGET}'. Options: {[c for c in df.columns if df[c].dtype != object]}")
data = df.dropna(subset=[TARGET] + features)
print(f"Target: {TARGET}")
print(f"{len(data)} rows with complete data, {data['reef_id'].nunique()} sites")
print("Features:", features)

X, y = data[features], data[TARGET]
if GROUP == "year":
    groups = data["year"]
elif GROUP == "cell":
    groups = (np.floor(data["latitude"] / 0.05).astype(int).astype(str) + "_" +
              np.floor(data["longitude"] / 0.05).astype(int).astype(str))
else:
    groups = data["reef_id"]
model = RandomForestRegressor(n_estimators=400, min_samples_leaf=3, random_state=0, n_jobs=-1)
n_splits = groups.nunique() if GROUP == "year" else min(5, groups.nunique())
cv = GroupKFold(n_splits=n_splits)
r2 = cross_val_score(model, X, y, groups=groups, cv=cv, scoring="r2")
print(f"\nR^2 on held-out {GROUP}s: {r2.mean():.2f} (+/- {r2.std():.2f})")
if GROUP == "year":
    # R^2 punishes getting the year's overall level wrong. Rank correlation asks
    # a different question: within the held-out year, did the model put the
    # worst-hit reefs at the top? That is what a risk map needs.
    from scipy.stats import spearmanr
    print("  year    R^2   rank corr (Spearman)")
    rhos = []
    for (tr, te), score in zip(cv.split(X, y, groups), r2):
        m = RandomForestRegressor(n_estimators=300, min_samples_leaf=3, random_state=0, n_jobs=-1)
        m.fit(X.iloc[tr], y.iloc[tr])
        rho = spearmanr(m.predict(X.iloc[te]), y.iloc[te]).correlation
        rhos.append(rho)
        print(f"  {int(data['year'].iloc[te[0]])}  {score:6.2f}   {rho:5.2f}")
    print(f"  mean rank corr: {np.nanmean(rhos):.2f}  (0 = no skill, 1 = perfect ranking)")

model.fit(X, y)
imp = permutation_importance(model, X, y, n_repeats=20, random_state=0, n_jobs=-1)
table = (pd.DataFrame({"feature": features, "importance": imp.importances_mean,
                       "std": imp.importances_std})
         .sort_values("importance", ascending=False))
print("\nPermutation importance (drop in R^2 when the feature is shuffled):")
print(table.to_string(index=False, float_format="%.3f"))
table.to_csv(config.DATA_OUT / "feature_importance.csv", index=False)
