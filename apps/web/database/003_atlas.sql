-- Reef Atlas app data, formerly bundled as apps/web/src/data/*.json: the Florida
-- demonstration (nine reef-tract sites) and the flagship reef dossiers.
-- Loaded by scripts/import-atlas.mjs, which replaces a whole bundle in one
-- transaction and records the SHA-256 of what the app will read back.
-- Plain tables: a few thousand static rows (see database/README.md).

CREATE TABLE reef_data.atlas_imports (
  dataset text PRIMARY KEY CHECK (dataset ~ '^[a-z0-9-]+(/[a-z0-9-]+)?$'),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  built_on date,
  imported_at timestamptz NOT NULL DEFAULT now()
);

-- Florida's Coral Reef, listed north to south-west (tract_order).
CREATE TABLE reef_data.florida_sites (
  site_id text PRIMARY KEY CHECK (site_id ~ '^[a-z][a-z-]*[a-z]$'),
  tract_order integer NOT NULL UNIQUE CHECK (tract_order > 0),
  name text NOT NULL CHECK (name <> ''),
  region text NOT NULL CHECK (region <> ''),
  anchor text NOT NULL CHECK (anchor <> ''),
  designation text CHECK (designation <> ''),
  latitude double precision NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude double precision NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  -- centre of the NOAA Coral Reef Watch 5 km pixel sampled for this site
  crw_latitude double precision NOT NULL CHECK (crw_latitude BETWEEN -90 AND 90),
  crw_longitude double precision NOT NULL CHECK (crw_longitude BETWEEN -180 AND 180)
);

-- NOAA Coral Reef Watch 5 km daily product, sampled weekly (12:00 UTC).
CREATE TABLE reef_data.florida_thermal (
  site_id text NOT NULL REFERENCES reef_data.florida_sites ON DELETE RESTRICT,
  sampled_at timestamptz NOT NULL,
  dhw double precision NOT NULL CHECK (dhw >= 0),
  sst double precision NOT NULL,
  ssta double precision NOT NULL,
  baa integer NOT NULL CHECK (baa BETWEEN 0 AND 4),
  PRIMARY KEY (site_id, sampled_at)
);

-- NOAA NHC HURDAT2 best track, storms that came near the tract.
CREATE TABLE reef_data.storms (
  storm_id text PRIMARY KEY CHECK (storm_id ~ '^AL[0-9]{6}$'),
  name text NOT NULL CHECK (name <> ''),
  season integer NOT NULL CHECK (season = right(storm_id, 4)::integer),
  peak_wind_kt integer NOT NULL CHECK (peak_wind_kt > 0)
);

CREATE TABLE reef_data.storm_fixes (
  storm_id text NOT NULL REFERENCES reef_data.storms ON DELETE RESTRICT,
  observed_at timestamptz NOT NULL,
  -- HURDAT2 record identifier (L = landfall, I = intensity peak, ...); NULL when blank
  record_identifier text CHECK (record_identifier IN ('C', 'G', 'I', 'L', 'P', 'R', 'S', 'T', 'W')),
  status text NOT NULL CHECK (status IN ('TD', 'TS', 'HU', 'EX', 'SD', 'SS', 'LO', 'WV', 'DB')),
  latitude double precision NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude double precision NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  max_wind_kt integer NOT NULL CHECK (max_wind_kt >= 0),
  min_pressure_mb integer CHECK (min_pressure_mb > 0),
  PRIMARY KEY (storm_id, observed_at)
);

-- Closest approach of each storm track to each site (derived from storm_fixes).
CREATE TABLE reef_data.storm_site_passes (
  storm_id text NOT NULL REFERENCES reef_data.storms ON DELETE RESTRICT,
  site_id text NOT NULL REFERENCES reef_data.florida_sites ON DELETE RESTRICT,
  closest_at timestamptz NOT NULL,
  distance_km integer NOT NULL CHECK (distance_km >= 0),
  wind_kt integer NOT NULL CHECK (wind_kt >= 0),
  PRIMARY KEY (storm_id, site_id)
);
CREATE INDEX storm_site_passes_site_idx ON reef_data.storm_site_passes (site_id, closest_at);

-- USGS Nonindigenous Aquatic Species records of lionfish (Pterois).
-- source_row keeps the order of the source listing within a day.
CREATE TABLE reef_data.lionfish_records (
  nas_key integer PRIMARY KEY CHECK (nas_key > 0),
  source_row integer NOT NULL UNIQUE CHECK (source_row > 0),
  observed_on date NOT NULL,
  latitude double precision NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude double precision NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  locality text NOT NULL,
  accuracy text NOT NULL CHECK (accuracy <> ''),
  record_type text NOT NULL CHECK (record_type <> '')
);

-- Great-circle distance from each record to each site (derived).
CREATE TABLE reef_data.lionfish_site_distances (
  nas_key integer NOT NULL REFERENCES reef_data.lionfish_records ON DELETE RESTRICT,
  site_id text NOT NULL REFERENCES reef_data.florida_sites ON DELETE RESTRICT,
  distance_km double precision NOT NULL CHECK (distance_km >= 0),
  PRIMARY KEY (nas_key, site_id)
);
CREATE INDEX lionfish_site_distances_site_idx ON reef_data.lionfish_site_distances (site_id, distance_km);

-- Placeholder for Global Fishing Watch AIS / SAR activity. SIMULATED, not observed.
CREATE TABLE reef_data.florida_simulated_activity (
  site_id text NOT NULL REFERENCES reef_data.florida_sites ON DELETE RESTRICT,
  month date NOT NULL CHECK (extract(day FROM month) = 1),
  fishing_hours double precision NOT NULL CHECK (fishing_hours >= 0),
  vessel_hours double precision NOT NULL CHECK (vessel_hours >= 0),
  sar_detections integer NOT NULL CHECK (sar_detections >= 0),
  sar_unmatched integer NOT NULL CHECK (sar_unmatched >= 0),
  PRIMARY KEY (site_id, month),
  CHECK (sar_unmatched <= sar_detections)
);

-- Where each Florida layer comes from, in display order.
CREATE TABLE reef_data.florida_sources (
  source_key text PRIMARY KEY CHECK (source_key ~ '^[a-z]+$'),
  position integer NOT NULL UNIQUE CHECK (position > 0),
  name text NOT NULL CHECK (name <> ''),
  url text NOT NULL CHECK (url ~ '^https://'),
  kind text NOT NULL CHECK (kind IN ('observed', 'derived', 'model', 'simulated'))
);

-- Flagship dossiers and their panels are assembled documents (narrative, lanes,
-- events, drivers) that one screen reads whole. json, not jsonb: key order sets
-- on-screen order and must be preserved exactly.
CREATE TABLE reef_data.atlas_documents (
  doc_id text PRIMARY KEY CHECK (doc_id ~ '^[a-z0-9-]+/[a-z0-9-]+$'),
  body json NOT NULL CHECK (json_typeof(body) = 'object')
);

COMMENT ON TABLE reef_data.florida_simulated_activity IS 'SIMULATED placeholder for Global Fishing Watch AIS/SAR activity. Never present as observations.';
COMMENT ON TABLE reef_data.atlas_imports IS 'One row per loaded atlas dataset: SHA-256 of the JSON the app reads back, verified at load.';
COMMENT ON TABLE reef_data.atlas_documents IS 'Flagship dossiers built by scripts/build-flagships.mjs from public monitoring data.';

GRANT SELECT ON ALL TABLES IN SCHEMA reef_data TO reef_data_read;
