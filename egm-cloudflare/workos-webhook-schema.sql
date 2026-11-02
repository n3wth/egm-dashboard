-- Apply once on the production D1 database before relying on push deprovisioning.
-- The webhook handler also creates the receipt table and adds the session column if they are missing.
CREATE TABLE IF NOT EXISTS workos_webhook_events (
  id TEXT PRIMARY KEY,
  received_at TEXT NOT NULL
);
-- SQLite rejects this statement once the column exists. That failure is safe to ignore.
ALTER TABLE workos_sessions ADD COLUMN provider_session_id TEXT;
