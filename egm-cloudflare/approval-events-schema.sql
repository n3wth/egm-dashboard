CREATE TABLE IF NOT EXISTS approval_subscriptions (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  url TEXT NOT NULL,
  secret_box TEXT NOT NULL,
  previous_box TEXT,
  rotated_at INTEGER,
  expires_at INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS approval_receipts (
  subscription_id TEXT NOT NULL REFERENCES approval_subscriptions(id),
  request_id TEXT NOT NULL REFERENCES users(id),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt INTEGER NOT NULL DEFAULT 0,
  complete INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(subscription_id,request_id)
);
