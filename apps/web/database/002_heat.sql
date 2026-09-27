-- Annual peak heat stress per reef, supplied as heat_history_1985_2025.csv,
-- heat_forecast_2027_2031.csv and heat_forecast_validation.csv.
-- Plain tables for the same reason as 001: ~120k static annual rows (see database/README.md).

-- One row per reef and year, 1985–2025. The supplied history has no 2003 rows.
-- ocean stays on each row: the two heat files label reef 1000056 differently
-- (Indian in the history, Pacific in the forecast), and both are kept as supplied.
CREATE TABLE reef_data.heat_history (
  source_row integer PRIMARY KEY CHECK (source_row > 0),
  reef_id integer NOT NULL REFERENCES reef_data.reefs ON DELETE RESTRICT,
  ocean text NOT NULL CHECK (ocean IN ('Pacific', 'Atlantic', 'Indian', 'Red Sea', 'Arabian Gulf')),
  year integer NOT NULL CHECK (year BETWEEN 1985 AND 2025),
  peak_dhw double precision NOT NULL CHECK (peak_dhw >= 0),
  peak_dhw_source text NOT NULL CHECK (peak_dhw_source IN ('observed', 'estimated')),
  UNIQUE (reef_id, year) -- also indexes the foreign key
);
CREATE INDEX heat_history_year_reef_idx ON reef_data.heat_history (year, reef_id, source_row);

-- Back-test skill per model and forecast horizon (years ahead).
CREATE TABLE reef_data.heat_forecast_validation (
  source_row integer PRIMARY KEY CHECK (source_row > 0),
  model text NOT NULL CHECK (model <> ''),
  horizon integer NOT NULL CHECK (horizon BETWEEN 1 AND 5),
  n integer NOT NULL CHECK (n > 0),
  origins integer NOT NULL CHECK (origins > 0),
  mae_dhw double precision NOT NULL CHECK (mae_dhw >= 0),
  spatial_spearman double precision NOT NULL CHECK (spatial_spearman BETWEEN -1 AND 1),
  auc_dhw4 double precision NOT NULL CHECK (auc_dhw4 BETWEEN 0 AND 1),
  brier_dhw4 double precision NOT NULL CHECK (brier_dhw4 BETWEEN 0 AND 1),
  pred_rate_dhw4 double precision NOT NULL CHECK (pred_rate_dhw4 BETWEEN 0 AND 1),
  obs_rate_dhw4 double precision NOT NULL CHECK (obs_rate_dhw4 BETWEEN 0 AND 1),
  auc_dhw8 double precision NOT NULL CHECK (auc_dhw8 BETWEEN 0 AND 1),
  brier_dhw8 double precision NOT NULL CHECK (brier_dhw8 BETWEEN 0 AND 1),
  pred_rate_dhw8 double precision NOT NULL CHECK (pred_rate_dhw8 BETWEEN 0 AND 1),
  obs_rate_dhw8 double precision NOT NULL CHECK (obs_rate_dhw8 BETWEEN 0 AND 1),
  UNIQUE (model, horizon)
);

-- Model forecast per reef and year, 2027–2031 (horizon 1–5). Every forecast row
-- must have back-test skill for its model and horizon.
CREATE TABLE reef_data.heat_forecast (
  source_row integer PRIMARY KEY CHECK (source_row > 0),
  reef_id integer NOT NULL REFERENCES reef_data.reefs ON DELETE RESTRICT,
  ocean text NOT NULL CHECK (ocean IN ('Pacific', 'Atlantic', 'Indian', 'Red Sea', 'Arabian Gulf')),
  year integer NOT NULL CHECK (year BETWEEN 2027 AND 2031),
  horizon integer NOT NULL CHECK (horizon = year - 2026),
  forecast_peak_dhw double precision NOT NULL CHECK (forecast_peak_dhw >= 0),
  peak_dhw_median double precision NOT NULL CHECK (peak_dhw_median >= 0),
  peak_dhw_p10 double precision NOT NULL CHECK (peak_dhw_p10 >= 0),
  peak_dhw_p90 double precision NOT NULL,
  p_dhw_over_4 double precision NOT NULL CHECK (p_dhw_over_4 BETWEEN 0 AND 1),
  p_dhw_over_8 double precision NOT NULL CHECK (p_dhw_over_8 BETWEEN 0 AND 1),
  heat_band text NOT NULL CHECK (heat_band IN ('low', 'moderate', 'high', 'very high')),
  recent5_mean_peak_dhw double precision NOT NULL CHECK (recent5_mean_peak_dhw >= 0),
  beyond_history_dhw boolean NOT NULL,
  model text NOT NULL,
  UNIQUE (reef_id, year), -- also indexes the reef foreign key
  CHECK (peak_dhw_p10 <= peak_dhw_median AND peak_dhw_median <= peak_dhw_p90),
  CHECK (forecast_peak_dhw BETWEEN peak_dhw_p10 AND peak_dhw_p90),
  CHECK (p_dhw_over_8 <= p_dhw_over_4),
  FOREIGN KEY (model, horizon) REFERENCES reef_data.heat_forecast_validation (model, horizon) ON DELETE RESTRICT
);
CREATE INDEX heat_forecast_year_reef_idx ON reef_data.heat_forecast (year, reef_id, source_row);
CREATE INDEX heat_forecast_model_horizon_idx ON reef_data.heat_forecast (model, horizon);

-- Source-shaped read models: exactly the CSV columns, in CSV order, plus source_row.
CREATE VIEW reef_data.heat_history_records AS
SELECT h.source_row, h.reef_id, r.latitude, r.longitude, h.ocean, h.year, h.peak_dhw, h.peak_dhw_source
FROM reef_data.heat_history h JOIN reef_data.reefs r USING (reef_id);

CREATE VIEW reef_data.heat_forecast_records AS
SELECT f.source_row, f.reef_id, r.latitude, r.longitude, f.ocean, f.year, f.horizon, f.forecast_peak_dhw,
       f.peak_dhw_median, f.peak_dhw_p10, f.peak_dhw_p90, f.p_dhw_over_4, f.p_dhw_over_8, f.heat_band,
       f.recent5_mean_peak_dhw, f.beyond_history_dhw, f.model
FROM reef_data.heat_forecast f JOIN reef_data.reefs r USING (reef_id);

CREATE VIEW reef_data.heat_forecast_validation_records AS
SELECT source_row, model, horizon, n, origins, mae_dhw, spatial_spearman, auc_dhw4, brier_dhw4, pred_rate_dhw4,
       obs_rate_dhw4, auc_dhw8, brier_dhw8, pred_rate_dhw8, obs_rate_dhw8
FROM reef_data.heat_forecast_validation;

COMMENT ON TABLE reef_data.heat_history IS 'heat_history_1985_2025.csv: annual peak degree heating weeks per reef, 1985-2025 (no 2003 rows).';
COMMENT ON COLUMN reef_data.heat_history.peak_dhw_source IS 'As supplied. 1985-2009 are all estimated; 2021-2025 are all observed and equal bleaching_risk.peak_dhw.';
COMMENT ON TABLE reef_data.heat_forecast IS 'heat_forecast_2027_2031.csv: supplied model forecast of annual peak DHW per reef. Model output, not observations.';
COMMENT ON COLUMN reef_data.heat_forecast.beyond_history_dhw IS 'True when the forecast exceeds the range seen in the history (extrapolation).';
COMMENT ON TABLE reef_data.heat_forecast_validation IS 'heat_forecast_validation.csv: back-test skill of the forecast models and baselines by horizon.';

GRANT SELECT ON ALL TABLES IN SCHEMA reef_data TO reef_data_read;
