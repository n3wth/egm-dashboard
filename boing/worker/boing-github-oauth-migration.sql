-- Additive migration for a separate Boing database. Apply before configuring GitHub.
CREATE TABLE IF NOT EXISTS boing_github_oauth_flows (
  state_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, session_hash TEXT NOT NULL, organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL, installation_id INTEGER NOT NULL, installation_state TEXT NOT NULL,
  verifier TEXT NOT NULL, expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS boing_github_install_handoffs (
  state_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, session_hash TEXT NOT NULL,
  organization_id TEXT NOT NULL, project_id TEXT NOT NULL, expires_at INTEGER NOT NULL
);
