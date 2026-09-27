"""Slide-ready charts from the pipeline's results -> charts/*.png (+ results_summary.csv)

    pip install matplotlib        # once
    python make_charts.py

Reads data/processed/: reef_stress_analysis.csv, timing_features.csv,
bleaching_risk_v2_2021_2026.csv, bleaching_forecast_2027_2031.csv,
reef_threats_2021_2026.csv, threat_effects.csv

Charts: 1 risk curve, 2 survey timing, 3 old vs new model, 4 heat 2021-2026,
5 threat effects, 6 invasive exposure, 7 bleaching-risk outlook 2021-2031.
"""
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score
from sklearn.model_selection import GroupKFold

import config
import predict_v2 as V2

OUT = config.ROOT / "charts"
OUT.mkdir(exist_ok=True)
P = config.DATA_OUT

# ---- palette (validated reference palette, light mode) ----------------------
SURFACE, INK, INK2, MUTED, GRID = "#fcfcfb", "#0b0b0b", "#52514e", "#8a8984", "#e6e5e1"
BLUE, ORANGE, AQUA, VIOLET = "#2a78d6", "#eb6834", "#1baf7a", "#4a3aa7"
BLUE_RAMP = ["#86b6ef", "#5598e7", "#2a78d6", "#1c5cab", "#104281"]   # ordinal: step 250 -> 650

plt.rcParams.update({
    "font.family": "DejaVu Sans", "font.size": 12, "text.color": INK,
    "axes.edgecolor": GRID, "axes.labelcolor": INK2, "axes.linewidth": 1,
    "axes.facecolor": SURFACE, "figure.facecolor": SURFACE,
    "xtick.color": INK2, "ytick.color": INK2, "xtick.major.size": 0, "ytick.major.size": 0,
    "axes.spines.top": False, "axes.spines.right": False,
    "axes.grid": True, "grid.color": GRID, "grid.linewidth": 1, "axes.axisbelow": True,
    "legend.frameon": False, "savefig.dpi": 200, "savefig.bbox": "tight",
})


def title(ax, t, sub=None):
    ax.set_title(t, loc="left", fontsize=16, fontweight="bold", color=INK, pad=28 if sub else 12)
    if sub:
        ax.text(0, 1.02, sub, transform=ax.transAxes, fontsize=11, color=INK2, va="bottom")


def source(fig, text, y=-0.02):
    fig.text(0.01, y, text, fontsize=9, color=MUTED, ha="left", va="top")


summary = []

# ---- data -------------------------------------------------------------------
train = pd.read_csv(P / "reef_stress_analysis.csv")
b = train.dropna(subset=["percent_bleaching", "max_dhw_30d"]).copy()
b["sig"] = b["percent_bleaching"] >= 10
X = lambda d: np.log1p(d[["max_dhw_30d"]].values)
model = LogisticRegression().fit(X(b), b["sig"])

# ---- 1. risk curve ------------------------------------------------------------
fig, ax = plt.subplots(figsize=(10, 5.6))
xs = np.linspace(0, 18, 200)
ys = model.predict_proba(np.log1p(xs).reshape(-1, 1))[:, 1] * 100
bins = [-0.01, 0.01, 1, 2, 3, 4, 6, 8, 12, 100]
b["bin"] = pd.cut(b["max_dhw_30d"], bins)
obs = b.groupby("bin", observed=True).agg(x=("max_dhw_30d", "median"), rate=("sig", "mean"), n=("sig", "size"))
obs = obs[obs["n"] >= 20]
for v, lab in ((4, "NOAA alert level 1:\nbleaching likely"), (8, "NOAA alert level 2:\nsevere bleaching")):
    ax.axvline(v, color=MUTED, linewidth=1)
    ax.text(v + 0.2, 6, lab, fontsize=10, color=INK2, va="bottom")
ax.plot(xs, ys, color=BLUE, linewidth=2.5, solid_capstyle="round", label="Model (fitted curve)")
ax.scatter(obs["x"], obs["rate"] * 100, s=np.clip(obs["n"] / 6, 40, 260), color=ORANGE,
           edgecolor=SURFACE, linewidth=2, zorder=3, label="Observed surveys (dot size = number of surveys)")
for v in (0, 4, 8):
    p = model.predict_proba(np.log1p([[v]]))[0, 1] * 100
    ax.annotate(f"{p:.0f}%", (v, p), xytext=(-30, 8) if v else (14, -4), textcoords="offset points",
                fontsize=12, fontweight="bold", color=INK)
    summary.append(("risk_curve", f"P(significant bleaching) at {v} DHW", round(p, 1), "%"))
ax.set_xlim(-0.3, 18); ax.set_ylim(0, 100)
ax.set_xlabel("Heat stress in the 30 days before the survey (degree heating weeks)")
ax.set_ylabel("Chance of significant bleaching (%)")
ax.legend(loc="center right", fontsize=10, bbox_to_anchor=(1, 0.42))
title(ax, "More heat stress, more bleaching",
      f"Chance that 10%+ of a reef's coral bleached, from {len(b):,} reef surveys (2013-2020)")
source(fig, "Data: Global Coral Bleaching Database (van Woesik et al.); NOAA Coral Reef Watch 5 km DHW. "
            "Curve: heat alone (logistic on log(1 + DHW)); the full model also uses timing and ocean.")
fig.savefig(OUT / "1_risk_curve.png"); plt.close(fig)

# ---- 2. survey timing ---------------------------------------------------------------
tf = pd.read_csv(P / "timing_features.csv")
tm = pd.concat([train.reset_index(drop=True), tf[["days_since_peak"]]], axis=1)
tm = tm.dropna(subset=["percent_bleaching", "max_dhw", "days_since_peak"])
tm = tm[tm["max_dhw"] >= 4].copy()          # reefs that had a real heat event
tm["sig"] = tm["percent_bleaching"] >= 10
edges = [-1, 14, 30, 60, 90, 150, 365]
names_t = ["0-2 weeks", "2-4 weeks", "1-2 months", "2-3 months", "3-5 months", "5-12 months"]
tm["lag"] = pd.cut(tm["days_since_peak"], edges, labels=names_t)
lag = tm.groupby("lag", observed=False).agg(rate=("sig", "mean"), n=("sig", "size"))
fig, ax = plt.subplots(figsize=(10, 5.2))
ax.bar(range(len(lag)), lag["rate"] * 100, width=0.6, color=BLUE, zorder=2)
for i, (nm, r) in enumerate(lag.iterrows()):
    ax.text(i, r.rate * 100 + 1.5, f"{r.rate:.0%}", ha="center", fontsize=12, fontweight="bold", color=INK)
    ax.text(i, -9, f"{int(r.n)} surveys", ha="center", fontsize=9, color=MUTED)
    summary.append(("timing", f"% significant bleaching, surveyed {nm} after heat peak", round(r.rate * 100, 1), "%"))
ax.set_xticks(range(len(lag)), names_t); ax.set_ylim(0, 100); ax.grid(axis="x", visible=False)
ax.set_xlabel("Time between the year's heat peak and the survey", labelpad=22)
ax.set_ylabel("Surveys finding significant bleaching (%)")
title(ax, "Timing matters: bleaching fades within weeks",
      f"{len(tm):,} surveys at reefs that reached 4+ DHW. Divers who came soon after the heat peak saw far more bleaching")
source(fig, "Bleaching peaks a few weeks after the heat peak, then corals recover or die. By 5-12 months the next warm season "
            "is often building again.\nThe new model uses survey timing; the old one did not, so it overpredicted.", y=-0.05)
fig.savefig(OUT / "2_survey_timing.png"); plt.close(fig)

# ---- 3. old vs new model on never-seen data ------------------------------------------
dv = V2.load_training()
pct = dv["percent_bleaching"].to_numpy(float); yv = (pct >= 10).astype(int)
Xn = V2.design(dv); Xo = np.log1p(dv[["max_dhw_30d"]].to_numpy())


def fit_prob(which, tr, te):
    if which == "new":
        return V2.SeverityModel().fit(Xn[tr], pct[tr]).predict_proba(Xn[te])
    return LogisticRegression().fit(Xo[tr], yv[tr]).predict_proba(Xo[te])[:, 1]


tests = {}
for which in ("old", "new"):
    lo = []
    for yr_ in sorted(dv["year"].unique()):
        te = (dv["year"] == yr_).to_numpy()
        lo.append(roc_auc_score(yv[te], fit_prob(which, ~te, te)))
    row = {"Each year held out\n(2013-2020)": np.mean(lo)}
    for end in (2018, 2016):
        tr = (dv["year"] <= end).to_numpy()
        row[f"Train to {end},\ntest {end + 1}-2020"] = roc_auc_score(yv[~tr], fit_prob(which, tr, ~tr))
    p = np.zeros(len(dv))
    for tr, te in GroupKFold(5).split(Xn, yv, dv["reef_id"]):
        p[te] = fit_prob(which, tr, te)
    row["Reefs held out\n(never seen)"] = roc_auc_score(yv, p)
    tests[which] = row
tt = pd.DataFrame(tests)
fig, ax = plt.subplots(figsize=(10, 5.4))
x = np.arange(len(tt)); w = 0.36
ax.bar(x - w / 2 - 0.01, tt["old"], width=w, color=BLUE_RAMP[0], zorder=2, label="Old model: heat in the last 30 days only")
ax.bar(x + w / 2 + 0.01, tt["new"], width=w, color=BLUE, zorder=2, label="New model: + heat timing, ocean-specific thresholds, severity")
for i, (nm, r) in enumerate(tt.iterrows()):
    ax.text(i - w / 2, r.old + 0.008, f"{r.old:.2f}", ha="center", fontsize=11, color=INK2)
    ax.text(i + w / 2, r.new + 0.008, f"{r.new:.2f}", ha="center", fontsize=11, fontweight="bold", color=INK)
    summary.append(("model_comparison", f"old model AUC: {nm.replace(chr(10), ' ')}", round(r.old, 3), "AUC"))
    summary.append(("model_comparison", f"new model AUC: {nm.replace(chr(10), ' ')}", round(r.new, 3), "AUC"))
ax.axhline(0.5, color=MUTED, linewidth=1.5)
ax.text(len(tt) - 0.45, 0.5, "coin flip", ha="left", va="bottom", fontsize=10, color=INK2)
ax.set_xticks(x, tt.index); ax.set_ylim(0.45, 1.0); ax.set_xlim(-0.6, len(tt) - 0.1)
ax.grid(axis="x", visible=False); ax.set_ylabel("AUC (ranking accuracy)")
ax.legend(loc="upper left", fontsize=10)
title(ax, "The new model beats the old one on every test",
      "Accuracy on surveys the model never saw during training (higher is better)")
source(fig, "AUC = chance the model ranks a bleached reef above an unbleached one. Target: 10%+ of coral bleached. "
            f"{len(dv):,} surveys, 2013-2020.")
fig.savefig(OUT / "3_model_comparison.png"); plt.close(fig)

# ---- 4. heat stress 2021-2026 ---------------------------------------------------
risk = pd.read_csv(P / "bleaching_risk_v2_2021_2026.csv").drop_duplicates(["reef_id", "year"], keep="last")
yr = risk.groupby("year").agg(p4=("peak_dhw", lambda v: (v >= 4).mean() * 100),
                              p8=("peak_dhw", lambda v: (v >= 8).mean() * 100),
                              pb=("p_significant_bleaching", "mean")).reset_index()
fig, ax = plt.subplots(figsize=(10, 5.6))
x = np.arange(len(yr)); w = 0.34
ax.bar(x - w / 2 - 0.01, yr["p4"], width=w, color=BLUE_RAMP[1], zorder=2, label="Past 4 DHW (bleaching likely)")
ax.bar(x + w / 2 + 0.01, yr["p8"], width=w, color=BLUE_RAMP[4], zorder=2, label="Past 8 DHW (severe)")
for i, r in yr.iterrows():
    ax.text(i - w / 2, r.p4 + 1.2, f"{r.p4:.0f}%", ha="center", fontsize=11, color=INK)
    ax.text(i + w / 2, r.p8 + 1.2, f"{r.p8:.0f}%", ha="center", fontsize=11, color=INK2)
    summary.append(("heat_by_year", f"{int(r.year)} % reefs past 4 DHW", round(r.p4, 1), "%"))
    summary.append(("heat_by_year", f"{int(r.year)} % reefs past 8 DHW", round(r.p8, 1), "%"))
    summary.append(("heat_by_year", f"{int(r.year)} mean P(significant bleaching)", round(r.pb * 100, 1), "%"))
labels = [str(int(v)) + ("\n(Jan-Sep)" if v == 2026 else "") for v in yr["year"]]
ax.set_xticks(x, labels); ax.set_ylim(0, 100); ax.grid(axis="x", visible=False)
ax.set_ylabel("Share of surveyed reefs (%)")
ax.legend(loc="upper left", fontsize=10)
i24 = list(yr["year"]).index(2024) if 2024 in list(yr["year"]) else None
if i24 is not None:
    ax.annotate("4th global bleaching event:\nNOAA/ICRI report 84% of the\nworld's reef area affected, 2023-25",
                xy=(i24 - w / 2, yr.loc[i24, "p4"] + 5), xytext=(i24 + 0.55, 97), fontsize=10, color=INK2,
                ha="left", va="top", arrowprops=dict(arrowstyle="-", color=MUTED, linewidth=1))
title(ax, "Heat stress at reefs, 2021-2026",
      f"Peak yearly heat stress at {risk['reef_id'].nunique():,} surveyed reef sites (NOAA satellite data)")
source(fig, "Estimated from measured satellite heat stress, not diver surveys. 2026 covers January to September only.")
fig.savefig(OUT / "4_heat_2021_2026.png"); plt.close(fig)

# ---- 5. threat effects on coral cover -------------------------------------------
eff = pd.read_csv(P / "threat_effects.csv")
names = {"cots_sightings_50km": "Crown-of-thorns starfish\n(per step up in sightings, 50 km)",
         "lionfish_years_established_25km": "Lionfish\n(per year established, 25 km)",
         "fishing_hours_25km": "Industrial fishing\n(per step up in hours, 25 km)"}
eff = eff.iloc[::-1].reset_index(drop=True)
fig, ax = plt.subplots(figsize=(10, 4.8))
ax.axvline(0, color=INK2, linewidth=1)
for i, r in eff.iterrows():
    c = ORANGE if r["detectable"] else MUTED
    ax.plot([r.ci_low, r.ci_high], [i, i], color=c, linewidth=3, solid_capstyle="round")
    ax.scatter([r.effect_pp], [i], s=140, color=c, edgecolor=SURFACE, linewidth=2, zorder=3)
    tag = "linked to lower coral cover" if r["detectable"] else "no clear effect"
    ax.text(max(r.ci_high, 0) + 0.12, i, f"{r.effect_pp:+.2f} pts  (p = {r.p_value:.3f}, {tag})",
            va="center", fontsize=10.5, color=INK if r["detectable"] else INK2)
    summary.append(("threat_effects", f"{r.threat} effect on coral cover", r.effect_pp, "pct points"))
    summary.append(("threat_effects", f"{r.threat} 95% CI", f"{r.ci_low} to {r.ci_high}", "pct points"))
    summary.append(("threat_effects", f"{r.threat} p-value", r.p_value, ""))
ax.set_yticks(range(len(eff)), [names.get(t, t) for t in eff["threat"]])
ax.set_xlim(min(eff.ci_low.min(), -0.5) - 0.3, max(eff.ci_high.max(), 0.5) + 3.2)
ax.set_ylim(-0.6, len(eff) - 0.4); ax.grid(axis="y", visible=False)
ax.set_xlabel("Change in coral cover (percentage points); line = 95% confidence interval")
title(ax, "Which threats are linked to less coral?",
      "Reefs compared within the same region and year, at the same heat stress")
source(fig, "Heat stress is not in this chart: it drives bleaching (see risk curve). Sightings-based species data "
            "reflect where divers look as well as where species are.")
fig.savefig(OUT / "5_threat_effects.png"); plt.close(fig)

# ---- 6. invasive-species exposure 2021-2026 ---------------------------------------
th = pd.read_csv(P / "reef_threats_2021_2026.csv")
ip = th[th["ocean"].isin(["Pacific", "Indian", "Red Sea", "Arabian Gulf"])]
at = th[th["ocean"] == "Atlantic"]
e1 = ip.groupby("year")["cots_sightings_50km"].apply(lambda v: (v > 0).mean() * 100)
e2 = at.groupby("year")["lionfish_present_25km"].apply(lambda v: (v == 1).mean() * 100)
fig, ax = plt.subplots(figsize=(10, 5.2))
ax.plot(e2.index, e2.values, color=VIOLET, linewidth=2.5, marker="o", markersize=8,
        markeredgecolor=SURFACE, markeredgewidth=2, label=f"Atlantic reefs with lionfish established ({len(at.reef_id.unique())} reefs)")
ax.plot(e1.index, e1.values, color=ORANGE, linewidth=2.5, marker="o", markersize=8,
        markeredgecolor=SURFACE, markeredgewidth=2, label=f"Indo-Pacific reefs with crown-of-thorns sightings ({len(ip.reef_id.unique())} reefs)")
for s, lab in ((e1, "crown-of-thorns"), (e2, "lionfish")):
    ax.text(s.index[-1] + 0.12, s.values[-1], f"{s.values[-1]:.0f}%", va="center", fontsize=12, fontweight="bold")
    ax.text(s.index[0] - 0.12, s.values[0], f"{s.values[0]:.0f}%", va="center", ha="right", fontsize=11, color=INK2)
    for y_, v_ in s.items():
        summary.append(("exposure", f"{int(y_)} % reefs with {lab} nearby", round(v_, 1), "%"))
ax.set_xticks(e1.index, [str(int(v)) + ("\n(Jan-Sep)" if v == 2026 else "") for v in e1.index])
ax.set_xlim(e1.index[0] - 0.6, e1.index[-1] + 0.6); ax.set_ylim(0, 100)
ax.set_ylabel("Share of reefs (%)"); ax.legend(loc="lower right", fontsize=10)
title(ax, "Invasive and outbreak species near reefs",
      "Lionfish: recorded within 25 km by that year.  Crown-of-thorns: sightings within 50 km in the prior 3 years")
source(fig, "Data: GBIF occurrence records. A rise can reflect more divers reporting as well as more animals.")
fig.savefig(OUT / "6_invasive_exposure.png"); plt.close(fig)

# ---- 7. bleaching-risk outlook 2021-2031 ----------------------------------------------
fc = pd.read_csv(P / "bleaching_forecast_2027_2031.csv")
hi = lambda b_: b_.isin(["high", "very high"]).mean() * 100
past = risk.groupby("year")["risk_band"].apply(hi)
fut = fc.groupby("year")["risk_band"].apply(hi)
fig, ax = plt.subplots(figsize=(10.5, 5.4))
ax.bar(past.index, past.values, width=0.62, color=BLUE, zorder=2, label="2021-2026: from measured satellite heat")
ax.bar(fut.index, fut.values, width=0.62, color=BLUE_RAMP[0], hatch="//", edgecolor=SURFACE, linewidth=0,
       zorder=2, label="2027-2031: from the heat forecast")
for s_, bold in ((past, True), (fut, False)):
    for y_, v_ in s_.items():
        ax.text(y_, v_ + 1.5, f"{v_:.0f}%", ha="center", fontsize=11, color=INK if bold else INK2,
                fontweight="bold" if bold else "normal")
        summary.append(("risk_outlook", f"{int(y_)} % reefs high or very high bleaching risk", round(v_, 1), "%"))
ax.axvline(2026.5, color=MUTED, linewidth=1)
ax.text(2026.6, 99, "forecast", fontsize=10, color=INK2, va="top")
ax.text(2026.4, 99, "estimated", fontsize=10, color=INK2, va="top", ha="right")
yrs_all = list(past.index) + list(fut.index)
ax.set_xticks(yrs_all, [str(int(v)) + ("\n(Jan-Sep)" if v == 2026 else "") for v in yrs_all])
ax.set_ylim(0, 105); ax.grid(axis="x", visible=False)
ax.set_ylabel("Reefs at high or very high risk (%)")
ax.legend(loc="upper left", fontsize=10, bbox_to_anchor=(0, -0.13), ncol=2)
title(ax, "Bleaching risk stays high through 2031",
      f"Share of {risk['reef_id'].nunique():,} reef sites with a 50%+ chance of significant bleaching (10%+ of coral)")
source(fig, "2027 forecast is driven by the El Nino reading for Jun-Aug 2026 (ONI +1.8). Forecast years use one best-guess "
            "heat level per reef, so treat them as typical-year risk, not exact odds.", y=-0.12)
fig.savefig(OUT / "7_risk_outlook_2021_2031.png"); plt.close(fig)

pd.DataFrame(summary, columns=["section", "metric", "value", "unit"]).to_csv(P / "results_summary.csv", index=False)
print(f"Wrote 7 charts -> {OUT}")
print(f"Wrote {len(summary)} headline numbers -> {P / 'results_summary.csv'}")
