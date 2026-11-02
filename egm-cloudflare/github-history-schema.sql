CREATE TABLE IF NOT EXISTS github_daily_history (
  query_id TEXT NOT NULL CHECK(query_id IN ('traffic','activity')),
  date TEXT NOT NULL CHECK(date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND date(date) IS NOT NULL AND date(date)=date),
  observed_at TEXT NOT NULL CHECK(julianday(observed_at) IS NOT NULL),
  body TEXT NOT NULL CHECK(json_valid(body)),
  PRIMARY KEY(query_id,date)
);
CREATE TABLE IF NOT EXISTS github_window_history (
  query_id TEXT NOT NULL CHECK(query_id IN ('reach','referrers','paths','downloads','website','website_contribution')),
  collection_date TEXT NOT NULL CHECK(collection_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND date(collection_date) IS NOT NULL AND date(collection_date)=collection_date),
  observed_at TEXT NOT NULL CHECK(julianday(observed_at) IS NOT NULL),
  body TEXT NOT NULL CHECK(json_valid(body)),
  PRIMARY KEY(query_id,collection_date)
);
