"""Forecast each reef's yearly peak heat stress (peak DHW) for the next 5 years.

Replaces scenario.py's assumption that the next five years repeat the last
five. Two models, both scored only on years they never saw:

  A. Peak DHW from monthly SST (fills in history).  Weekly NOAA DHW is cached
     only for 2021-2026 (and some survey years), but monthly SST exists from
     1985. An XGBoost model learns yearly peak DHW from that year's monthly SST
     (hotspots above the reef's warmest-month normal, anomalies), validated
     leave-one-year-out. It gives every reef a 1985-2025 peak-DHW history
     (observed weekly value where we have it, estimate otherwise).

  B. The forecast. Issued in September of year O (data: complete years up to
     O-1, plus the El Nino index ONI up to Jun-Aug of O), it predicts peak DHW
     in years O+1 ... O+5 from: the reef's recent peaks, its warming trend,
     its warmest-month normal, latitude, ocean and ENSO. Candidates (ridge,
     XGBoost) are compared with the scenario.py baseline in walk-forward tests
     (origins 2006-2024, each fit only on targets already observed).
     P(DHW >= 4) and P(DHW >= 8) are a logistic calibration of the forecast,
     fitted on the model's own earlier out-of-sample forecasts at the same
     horizon; the 10-90% range comes from those out-of-sample errors.

    python fetch_monthly.py      # once, downloads monthly SST (cached)
    python forecast_heat.py

Writes to data/processed/:
  heat_history_1985_2025.csv    reef_id, year, peak_dhw, peak_dhw_source (observed / estimated)
  heat_forecast_validation.csv  walk-forward scores per model and horizon
  heat_forecast_2027_2031.csv   the forecast (one row per reef and year)
"""
import re
import time
from pathlib import Path

import numpy as np
import pandas as pd
import requests
from scipy.stats import spearmanr
from sklearn.linear_model import LogisticRegression, Ridge
from sklearn.metrics import mean_absolute_error, r2_score, roc_auc_score
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from xgboost import XGBRegressor

import config
from fetch_monthly import load_monthly, reef_pixels
from fetch_noaa import CACHE as WEEKLY_CACHE, _neighbours

ONI_URL = "https://www.cpc.ncep.noaa.gov/data/indices/oni.ascii.txt"
ONI_CACHE = config.DATA_CACHE / "oni.txt"
CLIM_YEARS = (1985, 2012)
FIRST_YEAR, LAST_FULL_YEAR = 1985, 2025
ISSUE_YEAR = 2026                    # forecast issued Sep 2026 -> years 2027-2031
HORIZONS = [1, 2, 3, 4, 5]
TEST_ORIGINS = range(2006, LAST_FULL_YEAR)
OCEANS = ["Atlantic", "Indian", "Pacific"]
THRESHOLDS = (4, 8)
OUT = config.DATA_OUT


# ---------------------------------------------------------------- inputs ---

def oni():
    """ONI (3-month Nino 3.4 anomaly) as {(season, year): value}. Cached; refreshed after 30 days."""
    if not ONI_CACHE.exists() or time.time() - ONI_CACHE.stat().st_mtime > 30 * 86400:
        try:
            r = requests.get(ONI_URL, timeout=60)
            r.raise_for_status()
            ONI_CACHE.write_text(r.text)
        except requests.RequestException as e:
            if not ONI_CACHE.exists():
                raise SystemExit(f"Could not download ONI ({e}); rerun later")
            print(f"  ONI download failed ({e}), using cached copy")
    out = {}
    for line in ONI_CACHE.read_text().splitlines()[1:]:
        p = line.split()
        if len(p) == 4:
            out[(p[0], int(p[1]))] = float(p[3])
    return out


def monthly_by_reef_pixel(pixels):
    """For each reef pixel: its own monthly SST, or the first ocean neighbour's."""
    m = load_monthly()
    counts = m.groupby(["latitude", "longitude"]).size()
    good = set(counts[counts >= 400].index)
    use = {}
    for la, lo in pixels:
        use[(la, lo)] = next((n for n in _neighbours(la, lo) if n in good), None)
    series = {k: g.set_index("time")["sst"].sort_index()
              for k, g in m.groupby(["latitude", "longitude"]) if k in set(use.values())}
    return series, use


def yearly_sst_features(series):
    """series: monthly SST for one pixel (DatetimeIndex). -> one row per year."""
    s = series.copy()
    s.index = pd.PeriodIndex(s.index.tz_localize(None), freq="M")
    s = s[~s.index.duplicated()].asfreq("M")
    clim_mask = (s.index.year >= CLIM_YEARS[0]) & (s.index.year <= CLIM_YEARS[1])
    clim = s[clim_mask].groupby(s[clim_mask].index.month).mean()
    mmm = clim.max()
    anom = s - clim.reindex(s.index.month).to_numpy()
    hot = (s - mmm).clip(lower=0)
    # DHW is a 12-week (~3-month) running sum of hotspots, in degree C-weeks
    dhm3 = hot.rolling(3, min_periods=2).sum() * 4.345
    df = pd.DataFrame({"anom": anom, "hot": hot, "dhm3": dhm3, "above": (s > mmm).astype(float)})
    df["year"] = df.index.year
    y = df.groupby("year").agg(peak_dhm3=("dhm3", "max"), max_hotspot=("hot", "max"),
                               max_anom=("anom", "max"), mean_anom=("anom", "mean"),
                               months_above_mmm=("above", "sum"), n_months=("anom", "count"))
    y["mmm"] = mmm
    return y.reset_index()


def weekly_peaks(pixels):
    """Observed yearly peak DHW from the weekly cache: {(lat, lon, year): peak}, full years only."""
    wanted = {n for p in pixels for n in _neighbours(*p)}
    pat = re.compile(r"crw_(-?[\d.]+)_(-?[\d.]+)_(\d{4})_s%d\.csv$" % config.NOAA_DAY_STRIDE)
    out = {}
    for f in WEEKLY_CACHE.iterdir():
        mt = pat.match(f.name)
        if not mt:
            continue
        la, lo, yr = float(mt[1]), float(mt[2]), int(mt[3])
        if (la, lo) not in wanted or yr > LAST_FULL_YEAR:
            continue
        d = pd.to_numeric(pd.read_csv(f, usecols=["CRW_DHW"])["CRW_DHW"], errors="coerce")
        d = d[d > -300]
        if len(d) >= 48:              # full year of weekly samples
            out[(la, lo, yr)] = d.max()
    return out


def build_yearly(reefs):
    pixels = list(reefs[["nlat", "nlon"]].drop_duplicates().itertuples(index=False, name=None))
    m, use = monthly_by_reef_pixel(pixels)
    print(f"  monthly SST for {sum(v is not None for v in use.values())}/{len(pixels)} reef pixels")
    print("  reading weekly DHW cache...")
    weekly = weekly_peaks(pixels)
    rows = []
    for la, lo in pixels:
        src = use[(la, lo)]
        if src is None:
            continue
        y = yearly_sst_features(m[src])
        y = y[(y["year"] >= FIRST_YEAR) & (y["year"] <= LAST_FULL_YEAR) & (y["n_months"] == 12)]
        y["nlat"], y["nlon"] = la, lo
        # observed peak: same neighbour order as the rest of the pipeline
        obs = {}
        for n in _neighbours(la, lo):
            for yr in y["year"]:
                if yr not in obs and (n[0], n[1], yr) in weekly:
                    obs[yr] = weekly[(n[0], n[1], yr)]
        y["peak_dhw_observed"] = y["year"].map(obs)
        rows.append(y)
    return pd.concat(rows, ignore_index=True)


# -------------------------------------------------- model A: fill history ---

A_FEATS = ["peak_dhm3", "max_hotspot", "max_anom", "mean_anom", "months_above_mmm", "mmm", "abs_lat"]


def make_a():
    return XGBRegressor(n_estimators=400, max_depth=4, learning_rate=0.05, subsample=0.8,
                        colsample_bytree=0.8, min_child_weight=5, random_state=0, n_jobs=-1)


def fill_history(yearly):
    d = yearly.dropna(subset=["peak_dhw_observed"])
    X, y = d[A_FEATS], np.log1p(d["peak_dhw_observed"])
    pred = pd.Series(np.nan, index=d.index)
    for yr in sorted(d["year"].unique()):              # leave-one-year-out
        te = d["year"] == yr
        if te.sum() < 20 or (~te).sum() < 200:
            continue
        pred[te] = make_a().fit(X[~te], y[~te]).predict(X[te])
    ok = pred.notna()
    obs, est = d.loc[ok, "peak_dhw_observed"], np.expm1(pred[ok]).clip(lower=0)
    print(f"\nModel A (peak DHW from monthly SST), leave-one-year-out on {ok.sum()} reef-years "
          f"({d.loc[ok, 'year'].nunique()} years):")
    print(f"  MAE {mean_absolute_error(obs, est):.2f} DHW  R2 {r2_score(obs, est):.3f}  "
          f"AUC(DHW>=4) {roc_auc_score(obs >= 4, est):.3f}  "
          f"(raw monthly proxy R2 {r2_score(obs, d.loc[ok, 'peak_dhm3']):.3f})")
    by = pd.DataFrame({"year": d.loc[ok, "year"], "obs": obs, "est": est}).groupby("year").mean()
    print("  mean observed vs estimated peak DHW by year:")
    print("  " + "  ".join(f"{int(yr)}: {r.obs:.1f}/{r.est:.1f}" for yr, r in by.iterrows()))
    full = make_a().fit(X, y)
    yearly["peak_dhw_estimated"] = np.expm1(full.predict(yearly[A_FEATS])).clip(min=0)
    yearly["peak_dhw"] = yearly["peak_dhw_observed"].fillna(yearly["peak_dhw_estimated"])
    yearly["peak_dhw_source"] = np.where(yearly["peak_dhw_observed"].notna(), "observed", "estimated")
    return yearly


# ------------------------------------------------------ model B: forecast ---

def forecast_rows(yearly, pix, oni_idx):
    """One row per pixel x origin x horizon. Features use only years <= origin-1."""
    P = yearly.pivot(index=["nlat", "nlon"], columns="year", values="peak_dhw")
    A = yearly.pivot(index=["nlat", "nlon"], columns="year", values="mean_anom")
    P, A = P.reindex(columns=range(FIRST_YEAR, LAST_FULL_YEAR + 1)), A.reindex(columns=P.columns)
    static = pix.set_index(["nlat", "nlon"]).reindex(P.index)
    mmm = yearly.groupby(["nlat", "nlon"])["mmm"].first().reindex(P.index)
    out = []
    for o in range(FIRST_YEAR + 10, ISSUE_YEAR + 1):
        hist = lambda n: P.loc[:, o - n:o - 1].to_numpy()
        a20 = A.loc[:, max(FIRST_YEAR, o - 20):o - 1]
        yrs = a20.columns.to_numpy(dtype=float)
        a = a20.to_numpy()
        slope = ((a - np.nanmean(a, 1, keepdims=True)) * (yrs - yrs.mean())).sum(1) / ((yrs - yrs.mean()) ** 2).sum()
        jja, mam = oni_idx.get(("JJA", o)), oni_idx.get(("MAM", o))
        if jja is None:
            continue
        base = pd.DataFrame({
            "hist_last": hist(1)[:, 0], "hist_mean5": np.nanmean(hist(5), 1),
            "hist_mean10": np.nanmean(hist(10), 1), "hist_max10": np.nanmax(hist(10), 1),
            "hist_frac4_10": np.nanmean(hist(10) >= 4, 1), "hist_frac8_10": np.nanmean(hist(10) >= 8, 1),
            "hist_frac4_5": np.nanmean(hist(5) >= 4, 1), "hist_frac8_5": np.nanmean(hist(5) >= 8, 1),
            "anom_mean10": np.nanmean(A.loc[:, o - 10:o - 1].to_numpy(), 1), "anom_slope20": slope,
            "mmm": mmm.to_numpy(), "latitude": static["lat"].to_numpy(),
            "longitude": static["lon"].to_numpy(), "abs_lat": np.abs(static["lat"].to_numpy()),
            "ocean": static["ocean"].to_numpy(), "oni_jja": jja, "oni_change": jja - mam,
        }, index=P.index)
        for h in HORIZONS:
            t = o + h
            r = base.copy()
            r["origin"], r["year"], r["horizon"] = o, t, h
            r["anom_extrap"] = r["anom_mean10"] + r["anom_slope20"] * (t - (o - 5.5))
            r["target"] = P[t].to_numpy() if t <= LAST_FULL_YEAR else np.nan
            out.append(r.reset_index())
    d = pd.concat(out, ignore_index=True)
    # log scale, like the target: keeps extrapolation proportional for reefs hotter than any in training
    for c in ["hist_last", "hist_mean5", "hist_mean10", "hist_max10"]:
        d[f"log_{c}"] = np.log1p(d[c])
    for oc in OCEANS:
        d[f"ocean_{oc}"] = (d["ocean"] == oc).astype(float)
        for h in (1, 2):
            d[f"oni_h{h}_{oc}"] = d[f"ocean_{oc}"] * d["oni_jja"] * (d["horizon"] == h)
    for h in (1, 2):
        d[f"oni_h{h}"] = d["oni_jja"] * (d["horizon"] == h)
        d[f"oni_change_h{h}"] = d["oni_change"] * (d["horizon"] == h)
    return d


HIST = ["log_hist_last", "log_hist_mean5", "log_hist_mean10", "log_hist_max10", "hist_frac4_10", "hist_frac8_10"]
CLIMATE = ["anom_mean10", "anom_slope20", "anom_extrap", "mmm", "abs_lat", "horizon"]
ENSO = ["oni_h1", "oni_h2", "oni_change_h1", "oni_change_h2"]
RIDGE_FEATS = (HIST + CLIMATE + ENSO + [f"ocean_{o}" for o in OCEANS]
               + [f"oni_h{h}_{o}" for h in (1, 2) for o in OCEANS])
XGB_FEATS = HIST + CLIMATE + ENSO + ["latitude", "longitude"] + [f"ocean_{o}" for o in OCEANS]


class Baseline:
    """scenario.py's assumption: the future looks like the last n years."""
    def __init__(self, n):
        self.n = n

    def fit(self, d):
        return self

    def predict(self, d):
        return np.log1p(d[f"hist_mean{self.n}"].to_numpy())

    def probs(self, d, prev=None):
        return {thr: d[f"hist_frac{thr}_{self.n}"].to_numpy() for thr in THRESHOLDS}


class Fitted:
    def __init__(self, make, feats):
        self.make, self.feats = make, feats

    def fit(self, d):
        self.m = self.make().fit(d[self.feats].fillna(0), np.log1p(d["target"]))
        return self

    def predict(self, d):
        return self.m.predict(d[self.feats].fillna(0))

    def probs(self, d, prev):
        """P(peak DHW >= thr): logistic calibration of the prediction, fitted on this
        model's earlier out-of-sample forecasts at the same horizon (prev)."""
        pred = self.predict(d)
        out = {}
        for thr in THRESHOLDS:
            p = np.full(len(d), np.nan)
            for h in HORIZONS:
                sel = (d["horizon"] == h).to_numpy()
                g = prev[prev["horizon"] == h]
                y = g["target"] >= thr
                if sel.any() and len(g) >= 200 and y.nunique() == 2:
                    cal = LogisticRegression().fit(g[["pred"]].to_numpy(), y)
                    p[sel] = cal.predict_proba(pred[sel].reshape(-1, 1))[:, 1]
            out[thr] = p
        return out


MODELS = {
    "baseline_last5 (scenario.py)": lambda: Baseline(5),
    "baseline_last10": lambda: Baseline(10),
    "ridge": lambda: Fitted(lambda: make_pipeline(StandardScaler(), Ridge(alpha=10.0)), RIDGE_FEATS),
    "xgb": lambda: Fitted(lambda: XGBRegressor(n_estimators=300, max_depth=3, learning_rate=0.05,
                                               subsample=0.8, colsample_bytree=0.8, min_child_weight=20,
                                               random_state=0, n_jobs=-1), XGB_FEATS),
}


def walk_forward(d):
    """Refit at every origin on targets already observed (year <= origin-1)."""
    lab = d.dropna(subset=["target"])
    preds = []
    for name, mk in MODELS.items():
        oos = []
        for o in TEST_ORIGINS:
            tr = lab[lab["year"] <= o - 1]
            te = lab[lab["origin"] == o]
            if te.empty:
                continue
            m = mk().fit(tr)
            p = te[["nlat", "nlon", "origin", "year", "horizon", "target"]].copy()
            p["pred"] = m.predict(te)
            # calibration data: earlier origins' OOS forecasts whose targets were already known
            prev = pd.concat(oos) if oos else pd.DataFrame(columns=["year", "horizon", "pred", "target"])
            prev = prev[prev["year"] <= o - 1]
            for thr, v in m.probs(te, prev).items():
                p[f"p{thr}"] = v
            p["resid"] = np.log1p(p["target"]) - p["pred"]
            p["model"] = name
            oos.append(p)
        preds.append(pd.concat(oos))
    return pd.concat(preds, ignore_index=True)


def score(pr):
    rows = []
    for (name, h), g in pr.groupby(["model", "horizon"]):
        est = np.expm1(g["pred"]).clip(lower=0)
        row = {"model": name, "horizon": h, "n": len(g), "origins": g["origin"].nunique(),
               "mae_dhw": mean_absolute_error(g["target"], est),
               # can it rank which reefs get hit hardest in a given year?
               "spatial_spearman": g.groupby("year").apply(
                   lambda x: spearmanr(x["target"], x["pred"]).statistic, include_groups=False).mean()}
        for thr in THRESHOLDS:
            y = g["target"] >= thr
            ok = g[f"p{thr}"].notna()
            row[f"auc_dhw{thr}"] = roc_auc_score(y[ok], g.loc[ok, f"p{thr}"]) if y[ok].nunique() == 2 else np.nan
            row[f"brier_dhw{thr}"] = ((g.loc[ok, f"p{thr}"] - y[ok]) ** 2).mean()
            row[f"pred_rate_dhw{thr}"] = g.loc[ok, f"p{thr}"].mean()
            row[f"obs_rate_dhw{thr}"] = y[ok].mean()
        rows.append(row)
    return pd.DataFrame(rows)


# ------------------------------------------------------------------ main ---

def main():
    reefs = reef_pixels()
    print(f"{len(reefs)} reefs, {reefs[['nlat', 'nlon']].drop_duplicates().shape[0]} NOAA pixels")
    yearly = build_yearly(reefs)
    yearly["abs_lat"] = yearly["nlat"].abs()
    yearly = fill_history(yearly)

    pix = (reefs.groupby(["nlat", "nlon"]).agg(lat=("latitude", "mean"), lon=("longitude", "mean"),
                                               ocean=("ocean", "first")).reset_index())
    hist = reefs.merge(yearly[["nlat", "nlon", "year", "peak_dhw", "peak_dhw_source"]], on=["nlat", "nlon"])
    hist = hist[["reef_id", "latitude", "longitude", "ocean", "year", "peak_dhw", "peak_dhw_source"]]
    hist.round({"peak_dhw": 2}).sort_values(["reef_id", "year"]).to_csv(OUT / "heat_history_1985_2025.csv", index=False)

    d = forecast_rows(yearly, pix, oni())
    print(f"\nModel B: {d['target'].notna().sum()} labelled forecast rows, walk-forward origins "
          f"{TEST_ORIGINS.start}-{TEST_ORIGINS.stop - 1}...")
    pr = walk_forward(d)
    sc = score(pr)
    sc.round(4).to_csv(OUT / "heat_forecast_validation.csv", index=False)
    pd.set_option("display.width", 200)
    print("\nWalk-forward validation (never-seen years). Lower MAE/Brier = better, higher AUC/Spearman = better")
    cols = ["model", "horizon", "mae_dhw", "spatial_spearman", "auc_dhw4", "brier_dhw4", "auc_dhw8", "brier_dhw8"]
    print(sc[cols].round(3).to_string(index=False))
    overall = sc.groupby("model")[["mae_dhw", "spatial_spearman", "auc_dhw4", "brier_dhw4", "auc_dhw8", "brier_dhw8"]].mean()
    print("\nAveraged over horizons 1-5:")
    print(overall.round(3).to_string())

    best = overall["brier_dhw4"].idxmin()
    print(f"\nBest by Brier(DHW>=4): {best}")
    lab = d.dropna(subset=["target"])
    final = MODELS[best]().fit(lab)
    fut = d[d["origin"] == ISSUE_YEAR].copy()
    oos = pr[pr["model"] == best]
    fut["pred"] = final.predict(fut)
    for thr, v in final.probs(fut, oos).items():
        fut[f"p_dhw_over_{thr}"] = v
    # never forecast more heat than has ever been measured at any reef; flag where that bites
    cap = yearly["peak_dhw_observed"].max()
    raw = np.expm1(fut["pred"])
    fut["beyond_history_dhw"] = raw > cap
    fut["forecast_peak_dhw"] = raw.clip(lower=0, upper=cap)
    # range from out-of-sample errors in DHW units (additive; log-space errors blow up the top end)
    err = oos["target"] - np.expm1(oos["pred"]).clip(lower=0)
    q = {h: np.quantile(e, [0.1, 0.5, 0.9]) for h, e in err.groupby(oos["horizon"])}
    for i, name in enumerate(["peak_dhw_p10", "peak_dhw_median", "peak_dhw_p90"]):
        fut[name] = (fut["forecast_peak_dhw"] + fut["horizon"].map(lambda h: q[h][i])).clip(lower=0, upper=cap)
    fut["recent5_mean_peak_dhw"] = fut["hist_mean5"]
    fut["heat_band"] = pd.cut(fut["p_dhw_over_4"], [-0.01, 0.25, 0.5, 0.75, 1.01],
                              labels=["low", "moderate", "high", "very high"])
    fut["model"] = best
    cols = ["reef_id", "latitude", "longitude", "ocean", "year", "horizon", "forecast_peak_dhw",
            "peak_dhw_median", "peak_dhw_p10", "peak_dhw_p90", "p_dhw_over_4", "p_dhw_over_8",
            "heat_band", "recent5_mean_peak_dhw", "beyond_history_dhw", "model"]
    res = reefs.drop(columns="ocean").merge(fut.drop(columns=["latitude", "longitude"]), on=["nlat", "nlon"])
    res = res[cols].sort_values(["reef_id", "year"])
    path = OUT / f"heat_forecast_{ISSUE_YEAR + 1}_{ISSUE_YEAR + 5}.csv"
    res.round(4).to_csv(path, index=False)
    print(f"\nONI Jun-Aug {ISSUE_YEAR}: {d.loc[d['origin'] == ISSUE_YEAR, 'oni_jja'].iloc[0]:+.2f}")
    print(f"Forecasts capped at the highest observed peak ({cap:.1f} DHW): "
          f"{res['beyond_history_dhw'].sum()} reef-years flagged beyond_history_dhw")
    print(f"Wrote {path.name}: {len(res)} rows ({res['reef_id'].nunique()} reefs x {res['year'].nunique()} years)")
    s = res.groupby("year").agg(median_peak_dhw=("peak_dhw_median", "median"),
                                mean_p_dhw4=("p_dhw_over_4", "mean"), mean_p_dhw8=("p_dhw_over_8", "mean"))
    print(s.round(3).to_string())


if __name__ == "__main__":
    main()
