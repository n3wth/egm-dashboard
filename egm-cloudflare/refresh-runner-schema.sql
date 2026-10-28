CREATE TABLE IF NOT EXISTS refresh_control (
  id INTEGER PRIMARY KEY CHECK(id=1),
  lease_id TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0,
  finished_at INTEGER NOT NULL DEFAULT 0,
  last_status TEXT,
  github_status TEXT,
  semrush_status TEXT,
  mentions_status TEXT
);
INSERT OR IGNORE INTO refresh_control(id) VALUES(1);
