CREATE TABLE IF NOT EXISTS boing_membership_audit_targets (
  event_id TEXT PRIMARY KEY REFERENCES boing_audit_events(id),
  target_user_id TEXT NOT NULL REFERENCES boing_identities(user_id)
);
