-- Additive migration; apply to Boing databases before deploying code that
-- accepts invitations. This table stores provider IDs, never bearer tokens.
CREATE TABLE IF NOT EXISTS boing_workos_invitation_bindings (
  invitation_id TEXT PRIMARY KEY REFERENCES boing_invitations(id),
  workos_invitation_id TEXT NOT NULL UNIQUE
);
