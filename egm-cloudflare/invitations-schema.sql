CREATE TABLE IF NOT EXISTS invitations (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  email TEXT,
  kind TEXT NOT NULL CHECK(kind IN ('link','email')),
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  redeemed_at INTEGER,
  redeemed_by TEXT,
  redemption_id TEXT,
  revoked_at INTEGER,
  delivery_state TEXT NOT NULL DEFAULT 'local' CHECK(delivery_state IN ('local','sending','sent','unknown','failed')),
  provider_id TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS invitations_active_email ON invitations(email) WHERE kind='email' AND redeemed_at IS NULL AND revoked_at IS NULL;
