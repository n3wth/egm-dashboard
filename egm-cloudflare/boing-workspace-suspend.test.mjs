import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { AUDIT_SCHEMA } from './boing-audit.mjs'
import { GITHUB_APP_SCHEMA } from './boing-github-app.mjs'
import { JOBS_SCHEMA, claimCollectionJob, publishCollectionSnapshot } from './boing-jobs.mjs'
import { listProjects } from './boing-tenancy.mjs'
import { suspendWorkspace } from './boing-workspace-suspend.mjs'

function fixture() {
  const sql = new DatabaseSync(':memory:')
  sql.exec('PRAGMA foreign_keys=ON')
  sql.exec(readFileSync(new URL('./boing-tenancy-schema.sql', import.meta.url), 'utf8'))
  sql.exec(AUDIT_SCHEMA)
  sql.exec(GITHUB_APP_SCHEMA)
  sql.exec(JOBS_SCHEMA)
  sql.exec(`INSERT INTO boing_identities VALUES('user_Admin','admin@example.com','active'),('user_Owner','owner@example.com','active');
    INSERT INTO boing_organizations VALUES('a','A','org_A','active',0,'now'),('b','B','org_B','active',0,'now');
    INSERT INTO boing_memberships VALUES('a','user_Owner','owner','active','now'),('b','user_Owner','owner','active','now');
    INSERT INTO boing_projects VALUES('p','a','P',NULL,'https://example.com','active','now'),('q','b','Q',NULL,'https://example.com','active','now');
    INSERT INTO boing_source_versions VALUES('p','website',1),('q','website',1);
    INSERT INTO boing_collection_jobs(id,organization_id,project_id,actor_id,kind,source_revision,status,claim_id,created_at,expires_at,lease_expires_at)
    VALUES('running','a','p','user_Owner','website',1,'running','claim','now',2000000000000,2000000000000),
      ('queued','a','p','user_Owner','website',1,'queued',NULL,'now',2000000000000,NULL),
      ('other','b','q','user_Owner','website',1,'queued',NULL,'now',2000000000000,NULL);`)
  const db = { prepare(query) { return { bind(...args) { return {
    async first() { return sql.prepare(query).get(...args) ?? null },
    async all() { return { results: sql.prepare(query).all(...args) } },
    async run() { return { meta: { changes: Number(sql.prepare(query).run(...args).changes) } } },
  } } } }, async batch(statements) { sql.exec('BEGIN'); try { const results = []; for (const s of statements) results.push(await s.run()); sql.exec('COMMIT'); return results } catch (error) { sql.exec('ROLLBACK'); throw error } } }
  const env = { DB: db, BOING_PLATFORM_ADMIN_IDS: 'user_Admin' }
  const call = (input = {}) => suspendWorkspace(env, { actorId: 'user_Admin', organizationId: 'a', workosOrganizationId: 'org_A', ...input }, { now: 1800000000000 })
  return { sql, db, env, call }
}

test('operator suspension fences access and in-flight collection only for the selected workspace', async () => {
  const { sql, db, call } = fixture()
  assert.deepEqual(await call(), { status: 'suspended' })
  assert.equal(sql.prepare("SELECT status FROM boing_organizations WHERE id='a'").get().status, 'suspended')
  assert.equal(sql.prepare("SELECT status FROM boing_organizations WHERE id='b'").get().status, 'active')
  assert.deepEqual(sql.prepare("SELECT status FROM boing_collection_jobs WHERE organization_id='a' ORDER BY id").all().map(row => row.status), ['cancelled', 'cancelled'])
  assert.equal(sql.prepare("SELECT status FROM boing_collection_jobs WHERE id='other'").get().status, 'queued')
  assert.deepEqual(await listProjects(db, 'user_Owner', 'a'), [])
  assert.equal(await claimCollectionJob(db, 'queued', 1800000000001), null)
  assert.equal(await publishCollectionSnapshot(db, { organizationId: 'a', projectId: 'p', jobId: 'running', claimId: 'claim', snapshot: '{}', now: 1800000000001 }), false)
  assert.equal(sql.prepare("SELECT count(*) n FROM boing_audit_events WHERE organization_id='a' AND action='workspace.suspended'").get().n, 1)
  assert.deepEqual(await call(), { status: 'denied' })
})

test('requires an active allowlisted operator and the exact provider mapping', async () => {
  const { sql, env, call } = fixture()
  assert.equal((await call({ actorId: 'user_Owner' })).status, 'denied')
  assert.equal((await call({ workosOrganizationId: 'org_B' })).status, 'denied')
  sql.exec("UPDATE boing_identities SET status='suspended' WHERE user_id='user_Admin'")
  assert.equal((await call()).status, 'denied')
  env.BOING_PLATFORM_ADMIN_IDS = ''
  assert.equal((await call()).status, 'denied')
  assert.equal(sql.prepare("SELECT status FROM boing_organizations WHERE id='a'").get().status, 'active')
  assert.equal(sql.prepare('SELECT count(*) n FROM boing_audit_events').get().n, 0)
})

test('audit or cancellation failures roll back the entire fence', async () => {
  for (const table of ['boing_audit_events', 'boing_collection_jobs']) {
    const { sql, call } = fixture()
    sql.exec(`CREATE TRIGGER fail_${table} BEFORE ${table === 'boing_audit_events' ? 'INSERT' : 'UPDATE'} ON ${table} BEGIN SELECT RAISE(ABORT, 'failure'); END`)
    assert.equal((await call()).status, 'unavailable')
    assert.equal(sql.prepare("SELECT status FROM boing_organizations WHERE id='a'").get().status, 'active')
    assert.equal(sql.prepare("SELECT status FROM boing_collection_jobs WHERE id='running'").get().status, 'running')
    assert.equal(sql.prepare('SELECT count(*) n FROM boing_audit_events').get().n, 0)
  }
})
