"""2026-2030 bleaching-risk SCENARIO for every surveyed reef.

There is no measured heat stress for future years, so this is a scenario, not
a forecast. Assumption ("recent-climate scenario"): each reef's next five
years look like its last five (2021-2025, which include both calm years and
the record 2024 heat). Each future year is treated as a random draw from those
five years. Continued warming would make the real risk HIGHER, so these
numbers are conservative.

Reads the output of predict.py (bleaching_risk_2021_2025.csv) and writes one
row per reef with:
  p_bleach_per_year         chance of significant bleaching in any one year
  p_any_bleach_by_2030      chance of at least one significant bleaching, 2026-2030
  expected_bleach_years     expected number of significant-bleaching years out of 5
  p_any_severe_heat_by_2030 chance of at least one year with peak DHW >= 8
  scenario_risk_band        banded on expected_bleach_years (<1, 1-2, 2-3, 3+)

    python scenario.py
    python scenario.py --base-years 2022 2023 2024 2025 --horizon 2026 2030
"""
import argparse
import sys

import numpy as np
import pandas as pd

import config


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--risk-file", help="defaults to data/processed/bleaching_risk_2021_2025.csv")
    ap.add_argument("--base-years", type=int, nargs="+", default=[2021, 2022, 2023, 2024, 2025])
    ap.add_argument("--horizon", type=int, nargs=2, default=[2026, 2030], metavar=("FIRST", "LAST"))
    ap.add_argument("--sample", action="store_true")
    a = ap.parse_args()

    path = a.risk_file or config.DATA_OUT / "bleaching_risk_2021_2025.csv"
    try:
        risk = pd.read_csv(path)
    except FileNotFoundError:
        sys.exit(f"{path} not found. Run predict.py first.")
    base = risk[risk["year"].isin(a.base_years)].dropna(subset=["p_significant_bleaching", "peak_dhw"])
    found = sorted(int(y) for y in base["year"].unique())
    if not found:
        sys.exit(f"None of the base years {a.base_years} are in {path.name}")
    n_years = a.horizon[1] - a.horizon[0] + 1
    print(f"Base years: {found}  ->  scenario {a.horizon[0]}-{a.horizon[1]} ({n_years} years)")

    g = base.groupby(["reef_id", "latitude", "longitude"])
    reefs = g.agg(
        base_years_available=("year", "nunique"),
        mean_peak_dhw=("peak_dhw", "mean"),
        worst_peak_dhw=("peak_dhw", "max"),
        p_bleach_per_year=("p_significant_bleaching", "mean"),
        share_years_dhw_over_4=("peak_dhw", lambda v: (v >= 4).mean()),
        share_years_dhw_over_8=("peak_dhw", lambda v: (v >= 8).mean()),
    ).reset_index()

    # Each future year = independent draw of one base year; bleaching then
    # happens with that year's probability. Over n years:
    p = reefs["p_bleach_per_year"]
    reefs["p_any_bleach_by_%d" % a.horizon[1]] = 1 - (1 - p) ** n_years
    reefs["expected_bleach_years"] = p * n_years
    reefs["p_any_severe_heat_by_%d" % a.horizon[1]] = 1 - (1 - reefs["share_years_dhw_over_8"]) ** n_years
    key = "p_any_bleach_by_%d" % a.horizon[1]
    # "At least once in 5 years" is near-certain almost everywhere, so band on
    # the expected number of bleaching years instead; it separates reefs far better.
    reefs["scenario_risk_band"] = pd.cut(reefs["expected_bleach_years"], [-0.01, 1, 2, 3, n_years],
                                         labels=["low (<1 yr)", "moderate (1-2 yrs)",
                                                 "high (2-3 yrs)", "very high (3+ yrs)"])
    reefs["scenario"] = "recent-climate (%d-%d repeats), no extra warming" % (min(found), max(found))

    out = config.DATA_OUT / f"bleaching_scenario_{a.horizon[0]}_{a.horizon[1]}.csv"
    reefs.round(4).to_csv(out, index=False)

    print(f"\nWrote {len(reefs)} reefs -> {out}")
    print(f"\nAcross all reefs (scenario, {a.horizon[0]}-{a.horizon[1]}):")
    print(f"  average chance of significant bleaching per year:     {p.mean():.0%}")
    print(f"  reefs with >50% chance of bleaching at least once:    {(reefs[key] > 0.5).mean():.0%}")
    print(f"  reefs with >95% chance of bleaching at least once:    {(reefs[key] > 0.95).mean():.0%}")
    print(f"  expected significant-bleaching years per reef:        {reefs['expected_bleach_years'].mean():.1f} of {n_years}")
    print(f"  reefs likely (>50%) to see a severe heat year (8+):   "
          f"{(reefs['p_any_severe_heat_by_%d' % a.horizon[1]] > 0.5).mean():.0%}")
    print(f"\nRisk bands (expected significant-bleaching years out of {n_years}):")
    print(reefs["scenario_risk_band"].value_counts(sort=False).rename("reefs").to_string())
    print("\nReminder: scenario assumes no further warming, so treat these as a floor.")


if __name__ == "__main__":
    main()
