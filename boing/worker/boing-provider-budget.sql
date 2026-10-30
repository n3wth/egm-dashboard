-- Daily UTC counters reserve attempts before dispatch. Do not delete current-day
-- rows: doing so resets the enforced limits. Values contain no provider data.
CREATE TABLE IF NOT EXISTS boing_provider_call_budget (
  day TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('github', 'pagespeed')),
  organization_id TEXT NOT NULL,
  calls INTEGER NOT NULL CHECK (calls >= 1),
  PRIMARY KEY (day, provider, organization_id)
);
