CREATE TABLE IF NOT EXISTS feedback_items (
  id TEXT PRIMARY KEY,
  author_id TEXT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  survey_iteration INTEGER NOT NULL DEFAULT 0,
  posthog_attempts INTEGER NOT NULL DEFAULT 0,
  posthog_next_attempt INTEGER NOT NULL DEFAULT 0,
  posthog_complete INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS feedback_subscriptions (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  url TEXT NOT NULL,
  secret_box TEXT NOT NULL,
  previous_box TEXT,
  rotated_at INTEGER,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS feedback_activity (
  submission_id TEXT NOT NULL,
  author_id TEXT NOT NULL REFERENCES users(id),
  event TEXT NOT NULL,
  survey_iteration INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt INTEGER NOT NULL DEFAULT 0,
  complete INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(submission_id,event)
);
CREATE TABLE IF NOT EXISTS feedback_receipts (
  subscription_id TEXT NOT NULL REFERENCES feedback_subscriptions(id),
  feedback_id TEXT NOT NULL REFERENCES feedback_items(id),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt INTEGER NOT NULL DEFAULT 0,
  complete INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(subscription_id,feedback_id)
);
