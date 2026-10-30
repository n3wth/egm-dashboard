-- Permanent allocation ledger. Revoked slugs are never reassigned, including
-- to the same organization. Keep this table when deleting a workspace.
-- Run this entire migration in one atomic database transaction. A failed
-- consistency check must roll back all schema and data changes.
-- This migration is deliberately one-shot: existing trigger names cause a
-- failure, even if their definitions look compatible. Never replace them.
CREATE TABLE IF NOT EXISTS boing_subdomain_generations (
  slug TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  generation TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL CHECK (state IN ('active', 'revoked')),
  created_at TEXT NOT NULL
);

-- Never silently accept a conflicting or orphaned preexisting ledger. Missing
-- ledger rows for existing mappings are the sole supported backfill case.
CREATE TABLE boing_subdomain_migration_assertion (valid INTEGER NOT NULL CHECK(valid=1));
INSERT INTO boing_subdomain_migration_assertion(valid)
SELECT CASE WHEN EXISTS (
  SELECT 1 FROM boing_organization_subdomains s JOIN boing_subdomain_generations g ON g.slug=s.slug
  WHERE g.organization_id IS NOT s.organization_id OR g.state IS NOT 'active' OR g.created_at IS NOT s.created_at
) OR EXISTS (
  SELECT 1 FROM boing_subdomain_generations g
  WHERE g.slug IS NULL OR g.organization_id IS NULL OR g.created_at IS NULL OR g.state IS NULL
    OR g.state NOT IN ('active','revoked') OR length(g.generation) IS NOT 32 OR g.generation GLOB '*[^0-9a-f]*'
) OR EXISTS (
  SELECT 1 FROM boing_subdomain_generations g LEFT JOIN boing_organization_subdomains s
    ON s.slug=g.slug AND s.organization_id=g.organization_id
  WHERE g.state='active' AND s.slug IS NULL
) OR EXISTS (
  SELECT 1 FROM sqlite_master WHERE type='trigger' AND name IN (
    'boing_subdomain_no_reuse','boing_subdomain_record','boing_subdomain_immutable',
    'boing_subdomain_delete_guard','boing_subdomain_retire','boing_subdomain_ledger_no_delete',
    'boing_subdomain_ledger_no_replace','boing_subdomain_ledger_immutable'
  )
) THEN 0 ELSE 1 END;

-- Preserve existing mappings exactly; generation values are created locally.
INSERT INTO boing_subdomain_generations(slug, organization_id, generation, state, created_at)
SELECT slug, organization_id, lower(hex(randomblob(16))), 'active', created_at
FROM boing_organization_subdomains s
WHERE NOT EXISTS (SELECT 1 FROM boing_subdomain_generations g WHERE g.slug=s.slug);

-- Verify that every live mapping received exactly the matching active proof.
INSERT INTO boing_subdomain_migration_assertion(valid)
SELECT CASE WHEN EXISTS (
  SELECT 1 FROM boing_organization_subdomains s LEFT JOIN boing_subdomain_generations g ON g.slug=s.slug
  WHERE g.slug IS NULL OR g.organization_id IS NOT s.organization_id OR g.state IS NOT 'active'
    OR g.created_at IS NOT s.created_at OR length(g.generation) IS NOT 32
    OR g.generation GLOB '*[^0-9a-f]*'
) THEN 0 ELSE 1 END;
DROP TABLE boing_subdomain_migration_assertion;

CREATE TRIGGER boing_subdomain_no_reuse BEFORE INSERT ON boing_organization_subdomains
WHEN EXISTS (SELECT 1 FROM boing_subdomain_generations WHERE slug=NEW.slug)
  OR EXISTS (SELECT 1 FROM boing_organization_subdomains WHERE organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT, 'subdomain already allocated'); END;

CREATE TRIGGER boing_subdomain_record AFTER INSERT ON boing_organization_subdomains
BEGIN
  INSERT INTO boing_subdomain_generations(slug, organization_id, generation, state, created_at)
  VALUES(NEW.slug, NEW.organization_id, lower(hex(randomblob(16))), 'active', NEW.created_at);
END;

CREATE TRIGGER boing_subdomain_immutable BEFORE UPDATE ON boing_organization_subdomains
BEGIN SELECT RAISE(ABORT, 'subdomain mapping is immutable'); END;

CREATE TRIGGER boing_subdomain_delete_guard BEFORE DELETE ON boing_organization_subdomains
WHEN NOT EXISTS (SELECT 1 FROM boing_subdomain_generations WHERE slug=OLD.slug AND organization_id=OLD.organization_id AND state='active')
BEGIN SELECT RAISE(ABORT, 'subdomain ledger mismatch'); END;

CREATE TRIGGER boing_subdomain_retire AFTER DELETE ON boing_organization_subdomains
BEGIN
  UPDATE boing_subdomain_generations SET state='revoked'
  WHERE slug=OLD.slug AND organization_id=OLD.organization_id AND state='active';
END;

CREATE TRIGGER boing_subdomain_ledger_no_delete BEFORE DELETE ON boing_subdomain_generations
BEGIN SELECT RAISE(ABORT, 'subdomain ledger is permanent'); END;

CREATE TRIGGER boing_subdomain_ledger_no_replace BEFORE INSERT ON boing_subdomain_generations
WHEN EXISTS (SELECT 1 FROM boing_subdomain_generations WHERE slug=NEW.slug OR generation=NEW.generation)
  OR (NEW.state='active' AND NOT EXISTS (SELECT 1 FROM boing_organization_subdomains WHERE slug=NEW.slug AND organization_id=NEW.organization_id))
BEGIN SELECT RAISE(ABORT, 'subdomain ledger is permanent'); END;

CREATE TRIGGER boing_subdomain_ledger_immutable BEFORE UPDATE ON boing_subdomain_generations
WHEN NEW.slug IS NOT OLD.slug OR NEW.organization_id IS NOT OLD.organization_id OR
     NEW.generation IS NOT OLD.generation OR NEW.created_at IS NOT OLD.created_at OR
     OLD.state <> 'active' OR NEW.state <> 'revoked' OR
     EXISTS (SELECT 1 FROM boing_organization_subdomains WHERE slug=OLD.slug AND organization_id=OLD.organization_id)
BEGIN SELECT RAISE(ABORT, 'subdomain ledger is immutable'); END;
