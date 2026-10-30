-- Additive migration for a separate Boing database.
CREATE TABLE IF NOT EXISTS boing_ai_consents (
  organization_id TEXT PRIMARY KEY REFERENCES boing_organizations(id),
  disclosure_hash TEXT NOT NULL,
  accepted_by TEXT NOT NULL REFERENCES boing_identities(user_id),
  accepted_at TEXT NOT NULL
);
