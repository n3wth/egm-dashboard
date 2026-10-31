-- One row per person per decision. Claim it before calling Resend.
-- Apply this to egm-growth-access before turning decision mail on.
-- There is no backfill: rows are created only for a new pending decision.
CREATE TABLE IF NOT EXISTS decision_notifications (
  user_id TEXT NOT NULL REFERENCES users(id),
  decision TEXT NOT NULL CHECK(decision IN ('approved','denied')),
  state TEXT NOT NULL CHECK(state IN ('claimed','sent','failed','skipped')),
  claimed_at TEXT NOT NULL,
  sent_at TEXT,
  provider_id TEXT,
  PRIMARY KEY (user_id, decision)
);
