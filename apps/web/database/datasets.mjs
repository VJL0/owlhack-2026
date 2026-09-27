// Explicit allowlist: these are the only source files the importer can read.
// `columns` is the exact CSV header; `view` returns those columns plus source_row.
// `years` bounds the explorer's year filter (null: no year column); `reefs` says
// whether rows belong to a reef. Order matters: a forecast references its validation row.
export const datasets = [
  {
    slug: 'risk', label: 'Bleaching risk · 2021–2025', years: [2021, 2025], reefs: true,
    file: 'bleaching_risk_2021_2025.csv', table: 'bleaching_risk', view: 'bleaching_risk_records', rows: 13245,
    sha256: 'c521207947936b9051d3e692da83f8d0446805ad60c52337c8b7d520fdbc6533',
    columns: 'reef_id,latitude,longitude,year,peak_dhw,max_sst_anomaly,p_significant_bleaching,risk_band,beyond_training_dhw',
  },
  {
    slug: 'stress', label: 'Reef stress · 2013–2020', years: [2013, 2020], reefs: true,
    file: 'reef_stress_analysis.csv', table: 'reef_stress', view: 'reef_stress_records', rows: 5294,
    sha256: 'e0715571b8ab96b1a3ba737bc10c888d34497f063752fb45837d25556184c172',
    columns: 'reef_id,latitude,longitude,year,window_start,window_end,hard_coral_cover_pct,percent_bleaching,depth_m,max_dhw_30d,max_dhw_90d,max_dhw,mean_sst_anomaly,max_sst_anomaly,days_bleaching_alert,noaa_pixel_offset',
  },
  {
    slug: 'history', label: 'Heat history · 1985–2025', years: [1985, 2025], reefs: true,
    file: 'heat_history_1985_2025.csv', table: 'heat_history', view: 'heat_history_records', rows: 105960,
    sha256: '386a965930089b283f40874d2b41374bcef6041fdc5c26a4915e0cfb4ee54dba',
    columns: 'reef_id,latitude,longitude,ocean,year,peak_dhw,peak_dhw_source',
  },
  {
    slug: 'validation', label: 'Forecast skill', years: null, reefs: false,
    file: 'heat_forecast_validation.csv', table: 'heat_forecast_validation', view: 'heat_forecast_validation_records', rows: 20,
    sha256: 'b1e7019aa05b03acac84090c3d7fa75824d7161c2b4acc36d52b674ab376c242',
    columns: 'model,horizon,n,origins,mae_dhw,spatial_spearman,auc_dhw4,brier_dhw4,pred_rate_dhw4,obs_rate_dhw4,auc_dhw8,brier_dhw8,pred_rate_dhw8,obs_rate_dhw8',
  },
  {
    slug: 'forecast', label: 'Heat forecast · 2027–2031', years: [2027, 2031], reefs: true,
    file: 'heat_forecast_2027_2031.csv', table: 'heat_forecast', view: 'heat_forecast_records', rows: 13245,
    sha256: 'e2edb4d2bbc73b01660fa1140f8e1bece020023dd83013b23c9a75ea276e2937',
    columns: 'reef_id,latitude,longitude,ocean,year,horizon,forecast_peak_dhw,peak_dhw_median,peak_dhw_p10,peak_dhw_p90,p_dhw_over_4,p_dhw_over_8,heat_band,recent5_mean_peak_dhw,beyond_history_dhw,model',
  },
];

export const datasetBySlug = (slug) => datasets.find((dataset) => dataset.slug === slug);

// Schema migrations, applied in order. An applied file must never change.
export const migrations = [
  { version: 1, file: '001_reef_data.sql' },
  { version: 2, file: '002_heat.sql' },
  { version: 3, file: '003_atlas.sql' },
];
