-- Existing grants are deliberately not backfilled. A separately verified,
-- explicitly approved grant must bind the WorkOS membership version.
CREATE TABLE IF NOT EXISTS boing_workos_membership_bindings (
  organization_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  workos_membership_id TEXT NOT NULL,
  workos_updated_at TEXT NOT NULL,
  PRIMARY KEY (organization_id, user_id),
  FOREIGN KEY (organization_id, user_id) REFERENCES boing_memberships(organization_id, user_id)
);
