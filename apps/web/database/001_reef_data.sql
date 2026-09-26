-- Reef datasets supplied as bleaching_risk_2021_2025.csv and reef_stress_analysis.csv.
-- Plain PostgreSQL tables: ~18.5k static annual rows are far below the volume where
-- Tiger's hypertable guidance applies (see database/README.md).
CREATE SCHEMA IF NOT EXISTS reef_data;
REVOKE ALL ON SCHEMA reef_data FROM PUBLIC;

CREATE TABLE reef_data.imports (
  file_name text PRIMARY KEY,
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  row_count integer NOT NULL CHECK (row_count > 0),
  imported_at timestamptz NOT NULL DEFAULT now()
);

-- Both files repeat identical coordinates for every reef_id, so they live here once.
CREATE TABLE reef_data.reefs (
  reef_id integer PRIMARY KEY CHECK (reef_id > 0),
  latitude double precision NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude double precision NOT NULL CHECK (longitude BETWEEN -180 AND 180)
);

-- Annual snapshots: keep the supplied year rather than inventing event timestamps.
-- source_row is the one-based CSV data-record ordinal (header excluded).
CREATE TABLE reef_data.bleaching_risk (
  source_row integer PRIMARY KEY CHECK (source_row > 0),
  reef_id integer NOT NULL REFERENCES reef_data.reefs ON DELETE RESTRICT,
  year integer NOT NULL CHECK (year BETWEEN 2021 AND 2025),
  peak_dhw double precision NOT NULL CHECK (peak_dhw >= 0),
  max_sst_anomaly double precision NOT NULL,
  p_significant_bleaching double precision NOT NULL CHECK (p_significant_bleaching BETWEEN 0 AND 1),
  risk_band text NOT NULL CHECK (risk_band IN ('none', 'watch (0-4)', 'significant (4-8)', 'severe (8+)')),
  beyond_training_dhw boolean NOT NULL,
  UNIQUE (reef_id, year) -- also indexes the foreign key
);
CREATE INDEX bleaching_risk_year_reef_idx ON reef_data.bleaching_risk (year, reef_id, source_row);

-- Multiple surveys per reef/year are legitimate (528 repeated keys); source_row keeps each.
CREATE TABLE reef_data.reef_stress (
  source_row integer PRIMARY KEY CHECK (source_row > 0),
  reef_id integer NOT NULL REFERENCES reef_data.reefs ON DELETE RESTRICT,
  year integer NOT NULL CHECK (year BETWEEN 2013 AND 2020),
  window_start date NOT NULL,
  window_end date NOT NULL CHECK (window_end >= window_start),
  hard_coral_cover_pct double precision CHECK (hard_coral_cover_pct BETWEEN 0 AND 100),
  percent_bleaching double precision CHECK (percent_bleaching BETWEEN 0 AND 100),
  depth_m double precision CHECK (depth_m >= 0),
  max_dhw_30d double precision NOT NULL CHECK (max_dhw_30d >= 0),
  max_dhw_90d double precision NOT NULL CHECK (max_dhw_90d >= 0),
  max_dhw double precision NOT NULL CHECK (max_dhw >= 0),
  mean_sst_anomaly double precision NOT NULL,
  max_sst_anomaly double precision NOT NULL,
  days_bleaching_alert integer NOT NULL CHECK (days_bleaching_alert >= 0),
  noaa_pixel_offset boolean NOT NULL
);
CREATE INDEX reef_stress_reef_year_idx ON reef_data.reef_stress (reef_id, year, source_row);
CREATE INDEX reef_stress_year_reef_idx ON reef_data.reef_stress (year, reef_id, source_row);

-- Source-shaped read models: exactly the CSV columns, in CSV order, plus source_row.
CREATE VIEW reef_data.bleaching_risk_records AS
SELECT b.source_row, b.reef_id, r.latitude, r.longitude, b.year, b.peak_dhw, b.max_sst_anomaly,
       b.p_significant_bleaching, b.risk_band, b.beyond_training_dhw
FROM reef_data.bleaching_risk b JOIN reef_data.reefs r USING (reef_id);

CREATE VIEW reef_data.reef_stress_records AS
SELECT s.source_row, s.reef_id, r.latitude, r.longitude, s.year, s.window_start, s.window_end,
       s.hard_coral_cover_pct, s.percent_bleaching, s.depth_m, s.max_dhw_30d, s.max_dhw_90d, s.max_dhw,
       s.mean_sst_anomaly, s.max_sst_anomaly, s.days_bleaching_alert, s.noaa_pixel_offset
FROM reef_data.reef_stress s JOIN reef_data.reefs r USING (reef_id);

COMMENT ON TABLE reef_data.bleaching_risk IS 'bleaching_risk_2021_2025.csv: modelled probability of significant bleaching per reef/year.';
COMMENT ON TABLE reef_data.reef_stress IS 'reef_stress_analysis.csv: survey records 2013-2020 with 365-day NOAA CRW heat-stress windows.';
COMMENT ON COLUMN reef_data.bleaching_risk.p_significant_bleaching IS 'Supplied model output (0-1), not an observed bleaching percentage.';
COMMENT ON COLUMN reef_data.bleaching_risk.beyond_training_dhw IS 'True when peak_dhw is outside the model training range (extrapolation).';

-- Tiger Cloud read-only pattern: a NOLOGIN group role holds the grants; login users join it.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'reef_data_read') THEN
    CREATE ROLE reef_data_read NOLOGIN;
  END IF;
END
$$;
GRANT USAGE ON SCHEMA reef_data TO reef_data_read;
GRANT SELECT ON ALL TABLES IN SCHEMA reef_data TO reef_data_read;
