-- Additive staging schema. Apply only after backing up the legacy database.
-- Keep in sync with BOING_IDENTITY_SCHEMA; identities never grant legacy access.
CREATE TABLE IF NOT EXISTS boing_identities (
  user_id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active', 'suspended'))
);
CREATE TABLE IF NOT EXISTS boing_organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  workos_organization_id TEXT UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('active', 'suspended')),
  ai_enabled INTEGER NOT NULL DEFAULT 0 CHECK (ai_enabled IN (0, 1)),
  created_at TEXT NOT NULL
);

-- Hostnames are selectors only. Membership is checked separately on each request.
CREATE TABLE IF NOT EXISTS boing_organization_subdomains (
  slug TEXT PRIMARY KEY CHECK (length(slug) BETWEEN 1 AND 63),
  organization_id TEXT NOT NULL UNIQUE REFERENCES boing_organizations(id),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS boing_memberships (
  organization_id TEXT NOT NULL REFERENCES boing_organizations(id),
  user_id TEXT NOT NULL REFERENCES boing_identities(user_id),
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
  status TEXT NOT NULL CHECK (status IN ('active', 'suspended')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (organization_id, user_id)
);
CREATE INDEX IF NOT EXISTS boing_memberships_user ON boing_memberships(user_id, status);

CREATE TABLE IF NOT EXISTS boing_projects (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES boing_organizations(id),
  name TEXT NOT NULL,
  repository TEXT,
  website_url TEXT,
  status TEXT NOT NULL CHECK (status IN ('active', 'archived')),
  created_at TEXT NOT NULL,
  UNIQUE (organization_id, id)
);
CREATE INDEX IF NOT EXISTS boing_projects_organization ON boing_projects(organization_id, status);

CREATE TABLE IF NOT EXISTS boing_project_memberships (
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (project_id, user_id),
  FOREIGN KEY (organization_id, project_id) REFERENCES boing_projects(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, user_id) REFERENCES boing_memberships(organization_id, user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS boing_snapshots (
  project_id TEXT PRIMARY KEY REFERENCES boing_projects(id),
  body TEXT NOT NULL,
  generated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS boing_presentations (
  project_id TEXT PRIMARY KEY REFERENCES boing_projects(id),
  body TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 0)
);

-- One row marks a completed migration and prevents a rerun from importing
-- changed legacy data or granting users access after the initial cutover.
CREATE TABLE IF NOT EXISTS boing_migrations (
  id TEXT PRIMARY KEY,
  completed_at TEXT NOT NULL
);
