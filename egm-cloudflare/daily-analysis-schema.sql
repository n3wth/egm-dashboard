CREATE TABLE IF NOT EXISTS daily_analysis_runs (
  day TEXT PRIMARY KEY CHECK(length(day)=10 AND date(day,'+0 days') IS NOT NULL AND date(day,'+0 days')=day),
  lease_id TEXT NOT NULL,
  attempted_at TEXT NOT NULL,
  input_fingerprint TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('started','available','failed')),
  body TEXT CHECK(body IS NULL OR json_valid(body))
);
