import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { BOING_IDENTITY_SCHEMA } from './boing-identity.mjs'
import { GITHUB_APP_SCHEMA } from './boing-github-app.mjs'
import { JOBS_SCHEMA } from './boing-jobs.mjs'
import { updateProjectWebsite } from './boing-website.mjs'

function fixture() {
  const sql = new DatabaseSync(':memory:')
  sql.exec('PRAGMA foreign_keys=ON')
  sql.exec(BOING_IDENTITY_SCHEMA)
  sql.exec(readFileSync(new URL('./boing-tenancy-schema.sql', import.meta.url), 'utf8'))
  sql.exec(GITHUB_APP_SCHEMA)
  sql.exec(JOBS_SCHEMA)
  sql.exec(`INSERT INTO boing_identities(user_id,email,status) VALUES('a','a@example.com','active'),('b','b@example.com','active'),('m','m@example.com','active');
    INSERT INTO boing_organizations VALUES('oa','A','org_a','active',0,'now'),('ob','B','org_b','active',0,'now');
    INSERT INTO boing_memberships VALUES('oa','a','owner','active','now'),('ob','b','owner','active','now'),('oa','m','member','active','now');
    INSERT INTO boing_projects VALUES('p','oa','P',NULL,'https://old.example.org/','active','now');
    INSERT INTO boing_snapshots VALUES('p','legacy','now');`)
  const db = {
    prepare(query) { return { bind(...args) { return { async run() { const r = sql.prepare(query).run(...args); return { meta: { changes: Number(r.changes) } } } } } } },
    async batch(statements) { sql.exec('BEGIN'); try { const result = []; for (const statement of statements) result.push(await statement.run()); sql.exec('COMMIT'); return result } catch (error) { sql.exec('ROLLBACK'); throw error } },
  }
  return { sql, db }
}
const request = { userId: 'a', verifiedOrganizationId: 'oa', projectId: 'p', website: 'https://new.example.org/' }

test('website changes advance revisions, invalidate without deleting legacy data, and resist ABA', async () => {
  const { sql, db } = fixture()
  assert.equal(await updateProjectWebsite(db, request), true)
  assert.equal(await updateProjectWebsite(db, { ...request, website: 'https://old.example.org/' }), true)
  assert.equal(await updateProjectWebsite(db, { ...request, website: null }), true)
  assert.equal(sql.prepare("SELECT revision FROM boing_source_versions WHERE project_id='p' AND kind='website'").get().revision, 3)
  assert.equal(sql.prepare("SELECT count(*) n FROM boing_snapshot_invalidations WHERE project_id='p'").get().n, 1)
  assert.equal(sql.prepare("SELECT body FROM boing_snapshots WHERE project_id='p'").get().body, 'legacy')
  assert.equal(sql.prepare("SELECT website_url FROM boing_projects WHERE id='p'").get().website_url, null)
})

test('cross-tenant, member and revoked owner updates fail without changing revision', async () => {
  const { sql, db } = fixture()
  assert.equal(await updateProjectWebsite(db, { ...request, verifiedOrganizationId: 'ob' }), false)
  assert.equal(await updateProjectWebsite(db, { ...request, userId: 'm' }), false)
  sql.exec("UPDATE boing_memberships SET status='suspended' WHERE user_id='a'")
  assert.equal(await updateProjectWebsite(db, request), false)
  assert.equal(sql.prepare('SELECT count(*) n FROM boing_source_versions').get().n, 0)
  assert.equal(sql.prepare("SELECT website_url FROM boing_projects WHERE id='p'").get().website_url, 'https://old.example.org/')
})

test('a changed membership binding cannot authorize a website update', async () => {
  const { sql, db } = fixture()
  sql.exec(readFileSync(new URL('./boing-membership-binding-migration.sql', import.meta.url), 'utf8'))
  sql.exec("INSERT INTO boing_workos_membership_bindings VALUES('oa','a','om_1','2026-01-01T00:00:00Z')")
  const bound = { ...request, membershipBinding: { id: 'om_1', updatedAt: '2026-01-01T00:00:00Z' } }
  sql.exec("UPDATE boing_workos_membership_bindings SET workos_updated_at='2026-01-02T00:00:00Z'")
  assert.equal(await updateProjectWebsite(db, bound), false)
  assert.equal(sql.prepare("SELECT website_url FROM boing_projects WHERE id='p'").get().website_url, 'https://old.example.org/')
  assert.equal(sql.prepare('SELECT count(*) n FROM boing_source_versions').get().n, 0)
})

test('unsafe URLs and missing verified scope fail closed', async () => {
  const { sql, db } = fixture()
  for (const website of ['http://127.0.0.1/', 'http://service.local/', 'https://user:pass@public.com/', 'https://public.com/?token=secret', 'javascript:alert(1)']) {
    await assert.rejects(updateProjectWebsite(db, { ...request, website }))
  }
  await assert.rejects(updateProjectWebsite(db, { ...request, verifiedOrganizationId: null }))
  assert.equal(sql.prepare('SELECT count(*) n FROM boing_source_versions').get().n, 0)
})

test('revision failure rolls back the website update and snapshot marker', async () => {
  const { sql, db } = fixture()
  sql.exec("CREATE TRIGGER reject_version BEFORE INSERT ON boing_source_versions BEGIN SELECT RAISE(ABORT, 'failure'); END")
  await assert.rejects(updateProjectWebsite(db, request), /failure/)
  assert.equal(sql.prepare("SELECT website_url FROM boing_projects WHERE id='p'").get().website_url, 'https://old.example.org/')
  assert.equal(sql.prepare('SELECT count(*) n FROM boing_snapshot_invalidations').get().n, 0)
})
