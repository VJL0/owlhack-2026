// Explicit allowlist: these are the only source files the importer can read.
// `columns` is the exact CSV header; `view` returns those columns plus source_row.
export const datasets = [
  {
    file: 'bleaching_risk_2021_2025.csv', table: 'bleaching_risk', view: 'bleaching_risk_records', rows: 13245,
    sha256: 'c521207947936b9051d3e692da83f8d0446805ad60c52337c8b7d520fdbc6533',
    columns: 'reef_id,latitude,longitude,year,peak_dhw,max_sst_anomaly,p_significant_bleaching,risk_band,beyond_training_dhw',
  },
  {
    file: 'reef_stress_analysis.csv', table: 'reef_stress', view: 'reef_stress_records', rows: 5294,
    sha256: 'e0715571b8ab96b1a3ba737bc10c888d34497f063752fb45837d25556184c172',
    columns: 'reef_id,latitude,longitude,year,window_start,window_end,hard_coral_cover_pct,percent_bleaching,depth_m,max_dhw_30d,max_dhw_90d,max_dhw,mean_sst_anomaly,max_sst_anomaly,days_bleaching_alert,noaa_pixel_offset',
  },
];
