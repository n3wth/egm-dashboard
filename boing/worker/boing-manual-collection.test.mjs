import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { BOING_IDENTITY_SCHEMA } from './boing-identity.mjs'
import { GITHUB_APP_SCHEMA } from './boing-github-app.mjs'
import { JOBS_SCHEMA } from './boing-jobs.mjs'
import { admitManualCollection } from './boing-manual-collection.mjs'

function fixture() {
  const sql = new DatabaseSync(':memory:')
  sql.exec(BOING_IDENTITY_SCHEMA)
  sql.exec(readFileSync(new URL('./boing-tenancy-schema.sql', import.meta.url), 'utf8'))
  sql.exec(readFileSync(new URL('./boing-membership-binding-migration.sql', import.meta.url), 'utf8'))
  sql.exec(GITHUB_APP_SCHEMA)
  sql.exec(JOBS_SCHEMA)
  sql.exec(readFileSync(new URL('./boing-provider-budget.sql', import.meta.url), 'utf8'))
  sql.exec(readFileSync(new URL('./boing-execution-fence-migration.sql', import.meta.url), 'utf8'))
  sql.exec(`INSERT INTO boing_identities(user_id,email,status) VALUES ('user_a','a@example.test','active');
    INSERT INTO boing_organizations VALUES ('org1','One','org_a','active',0,'now'),('org2','Two','org_b','active',0,'now');
    INSERT INTO boing_projects VALUES ('p1','org1','One',NULL,'https://example.test','active','now'),('p2','org2','Two',NULL,'https://example.test','active','now');
    INSERT INTO boing_memberships VALUES ('org1','user_a','owner','active','now');
    INSERT INTO boing_workos_membership_bindings VALUES ('org1','user_a','om_1','version1');
    INSERT INTO boing_source_versions VALUES ('p1','website',1),('p2','website',1);`)
  const db = { prepare(query) { return { bind(...args) { return { async all() { return { results: sql.prepare(query).all(...args) } }, async run() { return { meta: { changes: Number(sql.prepare(query).run(...args).changes) } } } } } } } }
  return { sql, env: { DB: db, BOING_COLLECTION_ENABLED: 'true', BOING_MEMBERSHIP_BINDING_REQUIRED: 'true', BOING_PAGESPEED_BUDGET_APPROVED: 'true', PAGESPEED_API_KEY: 'test', BOING_PAGESPEED_DAILY_CALL_LIMIT: '100', BOING_PAGESPEED_WORKSPACE_DAILY_CALL_LIMIT: '10' } }
}
const context = { status: 'allowed', organizationId: 'org1', userId: 'user_a', role: 'owner', membershipId: 'om_1', membershipUpdatedAt: 'version1' }
const now = Date.parse('2026-10-28T00:00:00.000Z')

test('manual admission is scoped, budget-gated and rate-limited', async () => {
  const { sql, env } = fixture()
  assert.equal((await admitManualCollection({ ...env, BOING_PAGESPEED_BUDGET_APPROVED: 'false' }, context, 'p1', now)).status, 'not_queued')
  assert.equal((await admitManualCollection(env, context, 'p2', now)).status, 'not_queued')
  const result = await admitManualCollection(env, context, 'p1', now)
  assert.equal(result.status, 'queued')
  assert.equal(result.admitted.length, 1)
  assert.equal((await admitManualCollection(env, context, 'p1', now + 1)).status, 'not_queued')
  assert.equal(sql.prepare('SELECT count(*) n FROM boing_collection_jobs').get().n, 1)
})

test('membership changes or suspension prevent admission after verification', async () => {
  const { sql, env } = fixture()
  sql.exec("UPDATE boing_workos_membership_bindings SET workos_updated_at='version2'")
  assert.equal((await admitManualCollection(env, context, 'p1', now)).status, 'not_queued')
  sql.exec("UPDATE boing_workos_membership_bindings SET workos_updated_at='version1'; UPDATE boing_organizations SET status='suspended' WHERE id='org1'")
  assert.equal((await admitManualCollection(env, context, 'p1', now)).status, 'not_queued')
  assert.equal(sql.prepare('SELECT count(*) n FROM boing_collection_jobs').get().n, 0)
})

test('manual admission respects a workspace-wide hourly job cap', async () => {
  const { sql, env } = fixture()
  const insert = sql.prepare(`INSERT INTO boing_collection_jobs
    (id,organization_id,project_id,actor_id,kind,source_revision,status,created_at,expires_at)
    VALUES (?,'org1','p1','user_a','website',1,'cancelled',?,?)`)
  for (let i = 0; i < 5; i++) insert.run('job' + i, new Date(now - 1000).toISOString(), now)
  // Remove the per-source collision so the workspace cap is the deciding check.
  sql.exec("UPDATE boing_collection_jobs SET kind='github'")
  assert.equal((await admitManualCollection(env, context, 'p1', now)).status, 'not_queued')
  assert.equal(sql.prepare('SELECT count(*) n FROM boing_collection_jobs').get().n, 5)
})
