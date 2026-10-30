import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { AUDIT_SCHEMA } from './boing-audit.mjs'
import { assignWorkspaceSubdomain, revokeWorkspaceSubdomain, readWorkspaceSubdomainProof } from './boing-subdomain-lifecycle.mjs'

const migration = readFileSync(new URL('./boing-subdomain-generation-migration.sql', import.meta.url), 'utf8')
function migrateAtomically(sql) {
  sql.exec('BEGIN')
  try { sql.exec(migration); sql.exec('COMMIT') } catch (error) { sql.exec('ROLLBACK'); throw error }
}
function fixture({ migrated = true } = {}) {
  const sql = new DatabaseSync(':memory:')
  sql.exec('PRAGMA foreign_keys=ON')
  sql.exec(readFileSync(new URL('./boing-tenancy-schema.sql', import.meta.url), 'utf8'))
  sql.exec(AUDIT_SCHEMA)
  sql.exec(`INSERT INTO boing_identities VALUES('user_Admin','admin@example.com','active'),('user_Owner','owner@example.com','active');
    INSERT INTO boing_organizations VALUES('a','A','org_A','active',0,'now'),('b','B','org_B','active',0,'now');
    INSERT INTO boing_organization_subdomains VALUES('existing','a','now');`)
  if (migrated) migrateAtomically(sql)
  let pending = Promise.resolve()
  const db = {
    prepare(query) { return { bind(...args) { return {
      async first() { return sql.prepare(query).get(...args) ?? null },
      async run() { return { meta: { changes: Number(sql.prepare(query).run(...args).changes) } } },
    } } } },
    batch(statements) {
      const operation = pending.then(async () => { sql.exec('BEGIN'); try { const results = []; for (const statement of statements) results.push(await statement.run()); sql.exec('COMMIT'); return results } catch (error) { sql.exec('ROLLBACK'); throw error } })
      pending = operation.catch(() => {})
      return operation
    },
  }
  const env = { DB: db, BOING_PLATFORM_ADMIN_IDS: 'user_Admin' }
  const existing = { actorId: 'user_Admin', organizationId: 'a', workosOrganizationId: 'org_A', slug: 'existing' }
  const other = { actorId: 'user_Admin', organizationId: 'b', workosOrganizationId: 'org_B', slug: 'fresh' }
  return { sql, db, env, existing, other }
}

test('migration preserves existing mapping and creates an immutable generation', async () => {
  const { sql, db, existing } = fixture()
  const proof = await readWorkspaceSubdomainProof(db, 'existing', 'a')
  assert.match(proof.generation, /^[a-f0-9]{32}$/)
  assert.throws(() => migrateAtomically(sql))
  assert.deepEqual(await readWorkspaceSubdomainProof(db, 'existing', 'a'), proof)
  assert.equal(sql.prepare('SELECT organization_id FROM boing_organization_subdomains WHERE slug=?').get(existing.slug).organization_id, 'a')
  assert.throws(() => sql.exec("UPDATE boing_organization_subdomains SET organization_id='b' WHERE slug='existing'"))
  assert.throws(() => sql.exec("INSERT OR REPLACE INTO boing_organization_subdomains VALUES('existing','b','now')"))
  assert.throws(() => sql.exec("INSERT OR REPLACE INTO boing_organization_subdomains VALUES('different','a','now')"))
  assert.throws(() => sql.exec("UPDATE boing_subdomain_generations SET state='revoked' WHERE slug='existing'"))
  assert.deepEqual(await readWorkspaceSubdomainProof(db, 'existing', 'a'), proof)
})

test('inconsistent ledger aborts migration atomically without changing existing mappings', () => {
  for (const ledger of [
    "('existing','b','00000000000000000000000000000001','active','now')",
    "('existing','a','00000000000000000000000000000001','revoked','now')",
    "('missing','b','00000000000000000000000000000001','active','now')",
    "('existing','a','bad','active','now')",
  ]) {
    const { sql } = fixture({ migrated: false })
    sql.exec(`CREATE TABLE boing_subdomain_generations (slug TEXT PRIMARY KEY, organization_id TEXT NOT NULL, generation TEXT NOT NULL UNIQUE, state TEXT NOT NULL, created_at TEXT NOT NULL); INSERT INTO boing_subdomain_generations VALUES ${ledger};`)
    assert.throws(() => migrateAtomically(sql))
    assert.equal(sql.prepare("SELECT organization_id FROM boing_organization_subdomains WHERE slug='existing'").get().organization_id, 'a')
    assert.equal(sql.prepare("SELECT count(*) n FROM sqlite_master WHERE name='boing_subdomain_migration_assertion'").get().n, 0)
    assert.equal(sql.prepare("SELECT count(*) n FROM sqlite_master WHERE name='boing_subdomain_record'").get().n, 0)
  }
})

test('a preexisting incompatible trigger aborts before backfill, preserving schema', () => {
  const { sql } = fixture({ migrated: false })
  sql.exec("CREATE TRIGGER boing_subdomain_no_reuse BEFORE INSERT ON boing_organization_subdomains BEGIN SELECT 1; END")
  assert.throws(() => migrateAtomically(sql))
  const trigger = sql.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name='boing_subdomain_no_reuse'").get().sql
  assert.match(trigger, /SELECT 1/)
  assert.equal(sql.prepare("SELECT count(*) n FROM sqlite_master WHERE name='boing_subdomain_generations'").get().n, 0)
  assert.equal(sql.prepare("SELECT count(*) n FROM sqlite_master WHERE name='boing_subdomain_record'").get().n, 0)
})

test('generation collision aborts and rolls back the complete atomic migration', () => {
  const { sql } = fixture({ migrated: false })
  sql.exec("CREATE TABLE boing_subdomain_generations (slug TEXT PRIMARY KEY, organization_id TEXT NOT NULL, generation TEXT NOT NULL UNIQUE, state TEXT NOT NULL, created_at TEXT NOT NULL); INSERT INTO boing_subdomain_generations VALUES ('retired','b','00000000000000000000000000000000','revoked','now')")
  sql.function('randomblob', _size => Buffer.alloc(16))
  assert.throws(() => migrateAtomically(sql))
  assert.deepEqual(sql.prepare('SELECT slug FROM boing_subdomain_generations').all().map(row => row.slug), ['retired'])
  assert.equal(sql.prepare("SELECT count(*) n FROM sqlite_master WHERE name='boing_subdomain_migration_assertion'").get().n, 0)
  assert.equal(sql.prepare("SELECT count(*) n FROM sqlite_master WHERE name='boing_subdomain_record'").get().n, 0)
})

test('revocation is audited and permanently prevents same-org or cross-org ABA', async () => {
  const { sql, db, env, existing } = fixture()
  const old = await readWorkspaceSubdomainProof(db, 'existing', 'a')
  assert.deepEqual(await revokeWorkspaceSubdomain(env, existing), { status: 'revoked' })
  assert.equal(await readWorkspaceSubdomainProof(db, 'existing', 'a'), null)
  assert.equal(sql.prepare("SELECT state FROM boing_subdomain_generations WHERE slug='existing'").get().state, 'revoked')
  assert.equal((await assignWorkspaceSubdomain(env, existing)).status, 'denied')
  assert.equal((await assignWorkspaceSubdomain(env, { ...existing, organizationId: 'b', workosOrganizationId: 'org_B' })).status, 'denied')
  assert.throws(() => sql.exec("INSERT INTO boing_organization_subdomains VALUES('existing','a','again')"))
  assert.throws(() => sql.exec("INSERT OR REPLACE INTO boing_subdomain_generations VALUES('existing','b','00000000000000000000000000000000','active','now')"))
  assert.throws(() => sql.exec("DELETE FROM boing_subdomain_generations WHERE slug='existing'"))
  assert.throws(() => sql.exec("UPDATE boing_subdomain_generations SET state='active' WHERE slug='existing'"))
  const stale = sql.prepare("SELECT 1 FROM boing_subdomain_generations g JOIN boing_organization_subdomains s ON s.slug=g.slug AND s.organization_id=g.organization_id WHERE g.slug=? AND g.organization_id=? AND g.generation=? AND g.state='active'").get(old.slug, old.organizationId, old.generation)
  assert.equal(stale, undefined)
  assert.equal(sql.prepare("SELECT count(*) n FROM boing_audit_events WHERE action='workspace.hostname_revoked'").get().n, 1)
})

test('operator can allocate a new slug only for the verified organization, once', async () => {
  const { sql, db, env, existing, other } = fixture()
  for (const invalid of ['admin', 'xn--thing', 'Bad', '-bad', 'a.b']) assert.equal((await assignWorkspaceSubdomain(env, { ...other, slug: invalid })).status, 'denied')
  assert.equal((await assignWorkspaceSubdomain(env, { ...other, actorId: 'user_Owner' })).status, 'denied')
  assert.equal((await assignWorkspaceSubdomain(env, { ...other, workosOrganizationId: 'org_A' })).status, 'denied')
  assert.equal((await assignWorkspaceSubdomain(env, { ...existing, slug: 'another' })).status, 'denied')
  const results = await Promise.all([assignWorkspaceSubdomain(env, other), assignWorkspaceSubdomain(env, other)])
  assert.equal(results.filter(result => result.status === 'assigned').length, 1)
  assert.equal(results.filter(result => result.status === 'denied').length, 1)
  assert.match((await readWorkspaceSubdomainProof(db, 'fresh', 'b')).generation, /^[a-f0-9]{32}$/)
  assert.equal(sql.prepare("SELECT count(*) n FROM boing_audit_events WHERE action='workspace.hostname_assigned'").get().n, 1)
})

test('missing safeguards or audit failure leave mapping unchanged', async () => {
  const unprepared = fixture({ migrated: false })
  assert.equal((await assignWorkspaceSubdomain(unprepared.env, unprepared.other)).status, 'unavailable')
  assert.equal(unprepared.sql.prepare("SELECT count(*) n FROM boing_organization_subdomains WHERE slug='fresh'").get().n, 0)
  const { sql, env, other } = fixture()
  sql.exec("CREATE TRIGGER fail_audit BEFORE INSERT ON boing_audit_events BEGIN SELECT RAISE(ABORT,'fail'); END")
  assert.equal((await assignWorkspaceSubdomain(env, other)).status, 'unavailable')
  assert.equal(sql.prepare("SELECT count(*) n FROM boing_organization_subdomains WHERE slug='fresh'").get().n, 0)
  assert.equal(sql.prepare("SELECT count(*) n FROM boing_subdomain_generations WHERE slug='fresh'").get().n, 0)
})
