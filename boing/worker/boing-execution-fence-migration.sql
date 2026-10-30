-- Execution records remain after suspension. Do not delete open or uncertain
-- records without reconciling the corresponding external operation.
CREATE TABLE IF NOT EXISTS boing_collection_executions (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  claim_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('open', 'settled', 'uncertain')),
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  UNIQUE(job_id, claim_id)
);
