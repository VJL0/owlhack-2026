"""Per-reef threat profile for recent years: heat, invasive species, fishing.

For every surveyed reef and every year you ask for (default 2021-2026):

  HEAT (a real prediction)
    peak_dhw, p_significant_bleaching, predicted_pct_bleached, bleaching_risk_band
    -> from predict_v2.py (validated on unseen years, AUC ~0.76-0.82)

  INVASIVE / OUTBREAK SPECIES (exposure, plus an effect only if one is proven)
    lionfish_present_25km, lionfish_years_established_25km   (Atlantic reefs)
    cots_sightings_50km                                       (Indo-Pacific reefs)

  INDUSTRIAL FISHING (exposure)
    fishing_hours_25km, trawler_hours_50km
    -> only for years covered by the Global Fishing Watch files in data/raw/gfw;
       other years are left BLANK (not zero), with fishing_data_available = False

  EFFECTS ON CORAL COVER
    The script re-estimates, from the 2013-2020 surveys, how much each threat
    changes coral cover (comparing reefs in the same 5-degree region and year,
    with the same heat stress; 95% CI by resampling reefs). An effect is applied
    to the recent years ONLY if its CI excludes zero; otherwise the reef gets
    no estimated effect and the summary says "no detectable effect".
    Estimates are written to threat_effects.csv.

These are exposure estimates and modelled effects, not observed damage.

    python threats.py
    python threats.py --years 2023 2024
    python threats.py --no-gfw          # skip reading the fishing files (faster)
"""
import argparse
import re
import sys

import numpy as np
import pandas as pd

import config
from invasives import invasive_features

INDO_PACIFIC = {"Pacific", "Indian", "Red Sea", "Arabian Gulf"}

# (column in data, how to transform it, which oceans it applies to, plain name)
EFFECTS = [
    ("cots_sightings_50km", "log1p", INDO_PACIFIC, "crown-of-thorns sightings within 50 km (per log-step)"),
    ("lionfish_years_established_25km", "none", {"Atlantic"}, "lionfish: years established within 25 km (per year)"),
    ("fishing_hours_25km", "log1p", None, "industrial fishing hours within 25 km (per log-step)"),
]


def _tx(v, how):
    return np.log1p(v) if how == "log1p" else v


def estimate_effects(train: pd.DataFrame, n_boot=2000, seed=0) -> pd.DataFrame:
    """Within region-year effect of each threat on coral cover, controlling for heat."""
    rng = np.random.default_rng(seed)
    t = train.dropna(subset=["hard_coral_cover_pct", "max_dhw"]).copy()
    t["ry"] = (np.floor(t["latitude"] / 5).astype(int).astype(str) + "_" +
               np.floor(t["longitude"] / 5).astype(int).astype(str) + "_" + t["year"].astype(str))

    def fit(df, x):
        z = df[["hard_coral_cover_pct", x, "max_dhw"]]
        z = z - z.groupby(df["ry"]).transform("mean")
        return np.linalg.lstsq(z[[x, "max_dhw"]].values, z["hard_coral_cover_pct"].values, rcond=None)[0][0]

    rows = []
    for col, how, oceans, label in EFFECTS:
        if col not in t:
            rows.append({"threat": col, "description": label, "n_surveys": 0, "effect_pp": np.nan,
                         "ci_low": np.nan, "ci_high": np.nan, "p_value": np.nan, "evidence": "n/a",
                         "detectable": False, "note": "column missing (rebuild the dataset)"})
            continue
        df = t if oceans is None else t[t["ocean"].isin(oceans)]
        df = df.dropna(subset=[col]).copy()
        df["x"] = _tx(df[col], how)
        b = fit(df, "x")
        idx = df.groupby("reef_id").indices
        reefs = list(idx)
        boots = [fit(df.iloc[np.concatenate([idx[r] for r in rng.choice(reefs, len(reefs))])], "x")
                 for _ in range(n_boot)]
        boots = np.array(boots)
        lo, hi = np.percentile(boots, [2.5, 97.5])
        # two-sided bootstrap p-value: how often the resampled effect lands on the other side of zero
        p = min(1.0, 2 * min((boots <= 0).mean(), (boots >= 0).mean()))
        det = p < 0.05
        evidence = ("strong (p < 0.01)" if p < 0.01 else "moderate (p 0.01-0.05)"
                    if det else "none (p >= 0.05)")
        rows.append({"threat": col, "description": label, "n_surveys": len(df),
                     "effect_pp": round(b, 3), "ci_low": round(lo, 3), "ci_high": round(hi, 3),
                     "p_value": round(p, 4), "evidence": evidence, "detectable": det,
                     "note": "applied to recent years" if det else "no detectable effect; not applied"})
    return pd.DataFrame(rows)


def gfw_years() -> set:
    years = set()
    for f in config.GFW_DIR.rglob("*.csv"):
        m = re.search(r"(20\d\d)-\d\d-\d\d", f.name)
        if m:
            years.add(int(m.group(1)))
    return years


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--years", type=int, nargs="+", default=[2021, 2022, 2023, 2024, 2025, 2026])
    ap.add_argument("--no-gfw", action="store_true")
    ap.add_argument("--sample", action="store_true")
    a = ap.parse_args()

    train = pd.read_csv(config.OUTPUT_FILE)
    if "ocean" not in train:
        sys.exit("No 'ocean' column: rerun python build_dataset.py first.")

    # ---- 1. Effects of each threat on coral cover (from 2013-2020 surveys) -------
    print("Estimating each threat's effect on coral cover (same region, year and heat)...")
    effects = estimate_effects(train)
    effects.to_csv(config.DATA_OUT / "threat_effects.csv", index=False)
    for _, e in effects.iterrows():
        print(f"  {e['description']}: {e['effect_pp']:+.2f} pp coral cover "
              f"(95% CI {e['ci_low']:+.2f} to {e['ci_high']:+.2f}, p={e['p_value']:.3f}, "
              f"n={e['n_surveys']}) -> evidence: {e['evidence']}")

    # ---- 2. Heat: bleaching risk from predict_v2.py (current model) ---------------
    v2 = sorted(config.DATA_OUT.glob("bleaching_risk_v2_*.csv"))
    if not v2:
        sys.exit("No bleaching_risk_v2_*.csv found. Run python predict_v2.py first.")
    print(f"Bleaching risk from {v2[-1].name} (predict_v2 model)")
    risk = (pd.read_csv(v2[-1]).drop_duplicates(["reef_id", "year"], keep="last")
            .rename(columns={"risk_band": "bleaching_risk_band"}))
    risk = risk[risk["year"].isin(a.years)]
    missing = sorted(set(a.years) - set(risk["year"]))
    if missing:
        print(f"\nNo bleaching risk for {missing} in {v2[-1].name}")

    grid = risk[["reef_id", "latitude", "longitude", "ocean", "year", "peak_dhw",
                 "p_significant_bleaching", "predicted_pct_bleached", "bleaching_risk_band"]].copy()
    grid = grid.reset_index(drop=True)
    grid["survey_id"] = range(len(grid))
    grid["window_start"] = pd.to_datetime(grid["year"].astype(str) + "-01-01")
    grid["window_end"] = pd.to_datetime(grid["year"].astype(str) + "-12-31 23:59")
    print(f"\nBuilding threat profile for {len(grid)} reef-years "
          f"({grid['reef_id'].nunique()} reefs, years {sorted(int(y) for y in grid['year'].unique())})")

    # ---- 3. Invasive species exposure ------------------------------------------
    inv = invasive_features(grid)
    grid = grid.merge(inv, on="survey_id", how="left")

    # ---- 4. Fishing exposure (only years the GFW files cover) ------------------
    covered = set() if a.no_gfw else gfw_years()
    grid["fishing_data_available"] = grid["year"].isin(covered)
    for c in ("fishing_hours_25km", "trawler_hours_50km"):
        grid[c] = np.nan
    if grid["fishing_data_available"].any():
        from gfw_effort import gfw_features, load_gfw_near
        sub = grid[grid["fishing_data_available"]]
        fish = gfw_features(sub, load_gfw_near(sub)).set_index("survey_id")
        for c in ("fishing_hours_25km", "trawler_hours_50km"):
            grid.loc[grid["fishing_data_available"], c] = grid.loc[
                grid["fishing_data_available"], "survey_id"].map(fish[c]).values
    if covered:
        print(f"[GFW] fishing data covers {min(covered)}-{max(covered)}; "
              f"other years left blank")
    uncovered = sorted(set(grid["year"]) - covered)
    if uncovered and not a.no_gfw:
        print(f"[GFW] no fishing files for {uncovered}. Download those years "
              f"(monthly, 0.1 deg) into data/raw/gfw to fill them.")

    # ---- 5. Apply detected effects ----------------------------------------------
    total = pd.Series(0.0, index=grid.index)
    applied_any = False
    for _, e in effects[effects["detectable"]].iterrows():
        col = e["threat"]
        how = next(h for c, h, _, _ in EFFECTS if c == col)
        est = e["effect_pp"] * _tx(grid[col], how)
        name = f"est_cover_change_{col.split('_')[0]}_pp"
        grid[name] = est.round(2) + 0.0          # + 0.0 turns -0.0 into 0.0
        total = total.add(est.fillna(0))
        applied_any = True
    grid["est_cover_change_invasive_fishing_pp"] = (total.round(2) + 0.0) if applied_any else 0.0

    # ---- 6. Plain-language summary per reef-year ---------------------------------
    def present(r):
        t = []
        if r["peak_dhw"] >= 4:
            t.append("heat stress (4+ DHW)")
        if r.get("cots_sightings_50km", 0) > 0:
            t.append("crown-of-thorns nearby")
        if r.get("lionfish_present_25km", 0) == 1:
            t.append("lionfish established")
        if r["fishing_data_available"] and r["fishing_hours_25km"] > 0:
            t.append("industrial fishing nearby")
        return "; ".join(t) if t else "none detected"
    grid["threats_present"] = grid.apply(present, axis=1)

    cols = ["reef_id", "latitude", "longitude", "ocean", "year",
            "peak_dhw", "p_significant_bleaching", "predicted_pct_bleached", "bleaching_risk_band",
            "cots_sightings_25km", "cots_sightings_50km",
            "lionfish_present_25km", "lionfish_years_established_25km",
            "fishing_data_available", "fishing_hours_25km", "trawler_hours_50km"]
    cols += [c for c in grid.columns if c.startswith("est_cover_change")]
    cols += ["threats_present"]
    out = config.DATA_OUT / f"reef_threats_{min(a.years)}_{max(a.years)}.csv"
    grid[[c for c in cols if c in grid]].to_csv(out, index=False)

    # ---- 7. Summary ---------------------------------------------------------------
    print(f"\nWrote {len(grid)} reef-years -> {out}")
    print("Wrote effect estimates -> " + str(config.DATA_OUT / "threat_effects.csv"))
    ip = grid[grid["ocean"].isin(INDO_PACIFIC)]
    at = grid[grid["ocean"] == "Atlantic"]
    s = pd.DataFrame({
        "reefs": grid.groupby("year")["reef_id"].nunique(),
        "pct_heat_4plus": grid.groupby("year")["peak_dhw"].apply(lambda v: (v >= 4).mean() * 100),
        "mean_p_bleach": grid.groupby("year")["p_significant_bleaching"].mean() * 100,
        "pct_IndoPac_cots_nearby": ip.groupby("year")["cots_sightings_50km"].apply(lambda v: (v > 0).mean() * 100),
        "pct_Atl_lionfish": at.groupby("year")["lionfish_present_25km"].apply(lambda v: (v == 1).mean() * 100),
        "pct_fishing_nearby": grid[grid["fishing_data_available"]].groupby("year")["fishing_hours_25km"]
                                  .apply(lambda v: (v > 0).mean() * 100),
    })
    print("\nBy year (percent of reefs; COTS among Indo-Pacific reefs, lionfish among Atlantic reefs):")
    print(s.round(1).to_string())
    print("\nNote: sightings-based exposure reflects where people dive as well as where "
          "species are; blank fishing = no data for that year, not zero fishing.")


if __name__ == "__main__":
    main()
