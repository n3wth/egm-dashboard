-- Apply to the isolated Boing database before deploying the updated Worker.
CREATE TABLE IF NOT EXISTS boing_auth_rate_limits (
  client_hash TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS boing_auth_rate_limits_expiry ON boing_auth_rate_limits(expires_at);
