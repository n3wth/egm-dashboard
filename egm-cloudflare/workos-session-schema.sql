-- Apply before enabling WORKOS_RBAC_ENABLED. No existing sessions are changed.
CREATE TABLE IF NOT EXISTS workos_sessions (
  session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  tokens TEXT NOT NULL,
  scoped INTEGER NOT NULL DEFAULT 0 CHECK(scoped IN (0,1)),
  version INTEGER NOT NULL DEFAULT 0,
  lease_id TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0,
  provider_session_id TEXT
);
CREATE TABLE IF NOT EXISTS workos_membership_sync (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL,
  state TEXT NOT NULL,
  next_attempt INTEGER NOT NULL DEFAULT 0,
  lease_id TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0
);
