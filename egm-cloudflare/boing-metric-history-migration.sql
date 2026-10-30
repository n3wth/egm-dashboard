-- Additive migration for an existing Boing D1 database. Apply before
-- deploying the collector that writes history. No historical backfill.
CREATE TABLE IF NOT EXISTS boing_metric_history (
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('github', 'website')),
  source_revision INTEGER NOT NULL CHECK (source_revision >= 1),
  day TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  metrics TEXT NOT NULL,
  PRIMARY KEY (project_id, kind, source_revision, day),
  FOREIGN KEY (organization_id, project_id) REFERENCES boing_projects(organization_id, id)
);
