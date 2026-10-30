import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { AUDIT_SCHEMA } from './boing-audit.mjs'
import { GITHUB_APP_SCHEMA } from './boing-github-app.mjs'
import { JOBS_SCHEMA, claimCollectionJob, publishCollectionSnapshot } from './boing-jobs.mjs'
import { handleProjectArchive } from './boing-project-archive.mjs'
import { listProjects, readProjectSnapshot, readProjectSources } from './boing-tenancy.mjs'

function fixture() {
  const sql = new DatabaseSync(':memory:')
  sql.exec('PRAGMA foreign_keys=ON')
  sql.exec(readFileSync(new URL('./boing-tenancy-schema.sql', import.meta.url), 'utf8'))
  sql.exec(AUDIT_SCHEMA); sql.exec(GITHUB_APP_SCHEMA); sql.exec(JOBS_SCHEMA)
  sql.exec(`INSERT INTO boing_identities VALUES('user_Owner','owner@example.com','active'),('user_Member','member@example.com','active');
    INSERT INTO boing_organizations VALUES('a','A','org_A','active',0,'now'),('b','B','org_B','active',0,'now');
    INSERT INTO boing_memberships VALUES('a','user_Owner','owner','active','now'),('a','user_Member','member','active','now'),('b','user_Owner','owner','active','now');
    INSERT INTO boing_projects VALUES('p','a','P',NULL,'https://site.com','active','now'),('q','b','Q',NULL,'https://other.com','active','now');
    INSERT INTO boing_source_versions VALUES('p','website',1),('q','website',1);
    INSERT INTO boing_collection_jobs(id,organization_id,project_id,actor_id,kind,source_revision,status,claim_id,created_at,expires_at,lease_expires_at)
      VALUES('run','a','p','user_Owner','website',1,'running','claim','now',2000000000000,2000000000000),
      ('queue','a','p','user_Owner','website',1,'queued',NULL,'now',2000000000000,NULL),
      ('other','b','q','user_Owner','website',1,'queued',NULL,'now',2000000000000,NULL);`)
  const db = { prepare(query) { return { bind(...args) { return {
    async first() { return sql.prepare(query).get(...args) ?? null },
    async all() { return { results: sql.prepare(query).all(...args) } },
    async run() { return { meta: { changes: Number(sql.prepare(query).run(...args).changes) } } }
  } } } }, async batch(statements) { sql.exec('BEGIN'); try { const results = []; for (const s of statements) results.push(await s.run()); sql.exec('COMMIT'); return results } catch (error) { sql.exec('ROLLBACK'); throw error } } }
  const env = { DB: db, APP_URL: 'https://app.test', WORKOS_API_KEY: 'test' }
  const owner = { id: 'user_Owner', status: 'active', verified: 1 }
  const provider = async url => { const q = new URL(url).searchParams; return Response.json({ object: 'list', data: [{ user_id: q.get('user_id'), organization_id: q.get('organization_id'), status: 'active' }], list_metadata: { after: null } }) }
  const call = (project = 'p', { actor = owner, org = 'a', origin = 'https://app.test', requestWorkos = provider, method = 'POST', action = 'archive' } = {}) => handleProjectArchive(new Request(`https://app.test/api/boing/projects/${project}/${action}`, { method, headers: { origin } }), env, actor, org, { requestWorkos, now: 1800000000000 })
  return { sql, db, env, call }
}

test('archive and restore bind the original owner grant and roll back on audit failure', async () => {
  for (const action of ['archive', 'restore']) for (const mode of ['success', 'provider_changed', 'binding_changed', 'audit_failure']) {
    const { sql, db, env, call } = fixture()
    if (action === 'restore') assert.equal((await call()).status, 200)
    sql.exec(readFileSync(new URL('./boing-membership-binding-migration.sql', import.meta.url), 'utf8'))
    sql.exec("INSERT INTO boing_workos_membership_bindings VALUES('a','user_Owner','om_123','2026-01-01T00:00:00.000Z')")
    env.BOING_MEMBERSHIP_BINDING_REQUIRED = 'true'
    let checks = 0
    const provider = async () => Response.json({ object: 'list', data: [{ id: 'om_123', user_id: 'user_Owner', organization_id: 'org_A', status: 'active', updated_at: mode === 'provider_changed' && ++checks > 1 ? '2026-01-02T00:00:00.000Z' : '2026-01-01T00:00:00.000Z' }], list_metadata: { after: null } })
    if (mode === 'binding_changed') { const batch = db.batch; db.batch = async statements => { sql.exec("UPDATE boing_workos_membership_bindings SET workos_updated_at='changed'"); return batch(statements) } }
    if (mode === 'audit_failure') sql.exec("CREATE TRIGGER fail_audit BEFORE INSERT ON boing_audit_events BEGIN SELECT RAISE(ABORT, 'failure'); END")
    const result = await call('p', { action, requestWorkos: provider })
    assert.equal(result.status, mode === 'success' ? 200 : mode === 'provider_changed' ? 403 : 503)
    assert.equal(sql.prepare("SELECT status FROM boing_projects WHERE id='p'").get().status, mode === 'success' ? (action === 'archive' ? 'archived' : 'active') : (action === 'archive' ? 'active' : 'archived'))
  }
})

test('archive denies subsequent reads and pending or running publication, preserving data and other tenants', async () => {
  const { sql, db, call } = fixture()
  sql.exec("INSERT INTO boing_snapshots VALUES('p','{\"views\":1}','now')")
  const response = await call()
  assert.deepEqual(await response.json(), { archived: true, dataDeleted: false })
  assert.equal(sql.prepare("SELECT status FROM boing_projects WHERE id='p'").get().status, 'archived')
  assert.equal((await listProjects(db, 'user_Owner', 'a')).length, 0)
  assert.deepEqual(sql.prepare("SELECT status FROM boing_collection_jobs WHERE organization_id='a' ORDER BY id").all().map(x => x.status), ['cancelled', 'cancelled'])
  assert.equal(sql.prepare("SELECT status FROM boing_collection_jobs WHERE id='other'").get().status, 'queued')
  assert.equal(await claimCollectionJob(db, 'queue', 1800000000001), null)
  assert.equal(await publishCollectionSnapshot(db, { organizationId: 'a', projectId: 'p', jobId: 'run', claimId: 'claim', snapshot: '{}', now: 1800000000001 }), false)
  assert.equal(sql.prepare("SELECT revision FROM boing_source_versions WHERE project_id='p'").get().revision, 2)
  assert.equal(sql.prepare("SELECT count(*) n FROM boing_snapshots WHERE project_id='p'").get().n, 1)
  assert.equal(sql.prepare("SELECT count(*) n FROM boing_snapshot_invalidations WHERE project_id='p'").get().n, 1)
  assert.equal(sql.prepare("SELECT count(*) n FROM boing_audit_events WHERE project_id='p' AND action='project.archived'").get().n, 1)
  assert.equal((await call()).status, 404)
})

test('archive requires an owner, exact origin, current mapping, and correct project scope', async () => {
  const { sql, call } = fixture()
  assert.equal((await call('p', { actor: { id: 'user_Member', verified: 1, status: 'active' } })).status, 403)
  assert.equal((await call('q')).status, 404)
  assert.equal((await call('p', { origin: 'https://evil.test' })).status, 403)
  assert.equal((await call('p', { method: 'GET' })).status, 405)
  const unavailable = async () => { throw Error('offline') }
  assert.equal((await call('p', { requestWorkos: unavailable })).status, 503)
  const remap = async () => { sql.exec("UPDATE boing_organizations SET workos_organization_id='org_Changed' WHERE id='a'"); return Response.json({ object: 'list', data: [{ user_id: 'user_Owner', organization_id: 'org_A', status: 'active' }], list_metadata: { after: null } }) }
  assert.equal((await call('p', { requestWorkos: remap })).status, 403)
  assert.equal(sql.prepare("SELECT status FROM boing_projects WHERE id='p'").get().status, 'active')
})

test('restore requires an owner and keeps earlier data and jobs invalidated', async () => {
  const { sql, db, call } = fixture()
  sql.exec(`INSERT INTO boing_snapshots VALUES('p','{"views":1}','now');
    INSERT INTO boing_collection_results VALUES('p','website',1,'{"performanceScore":80}','now');`)
  assert.equal((await call()).status, 200)
  assert.equal((await call('p', { action: 'restore', actor: { id: 'user_Member', verified: 1, status: 'active' } })).status, 403)
  assert.equal((await call('p', { action: 'restore', org: 'b' })).status, 404)
  const response = await call('p', { action: 'restore' })
  assert.deepEqual(await response.json(), { restored: true, previousDataRestored: false })
  assert.equal((await listProjects(db, 'user_Owner', 'a')).length, 1)
  assert.equal(await readProjectSnapshot(db, 'user_Owner', 'p', 'a'), null)
  assert.equal((await readProjectSources(db, 'user_Owner', 'p', 'a')).find(row => row.kind === 'website').body, null)
  assert.equal(sql.prepare("SELECT count(*) n FROM boing_collection_jobs WHERE project_id='p' AND status='cancelled'").get().n, 2)
  assert.equal(sql.prepare("SELECT count(*) n FROM boing_audit_events WHERE project_id='p' AND action='project.restored'").get().n, 1)
  assert.equal((await call('p', { action: 'restore' })).status, 404)
})

test('restore refuses archived projects without complete prior invalidation', async () => {
  for (const incomplete of ['marker', 'source', 'job']) {
    const { sql, call } = fixture()
    assert.equal((await call()).status, 200)
    if (incomplete === 'marker') sql.exec("DELETE FROM boing_snapshot_invalidations WHERE project_id='p'")
    if (incomplete === 'source') sql.exec("INSERT INTO boing_collection_results VALUES('p','website',2,'{}','now')")
    if (incomplete === 'job') sql.exec("UPDATE boing_collection_jobs SET status='queued' WHERE id='queue'")
    assert.equal((await call('p', { action: 'restore' })).status, 404)
    assert.equal(sql.prepare("SELECT status FROM boing_projects WHERE id='p'").get().status, 'archived')
  }
})

test('audit or cancellation failure rolls back all archival changes', async () => {
  for (const table of ['boing_audit_events', 'boing_collection_jobs']) {
    const { sql, call } = fixture()
    sql.exec(`DROP TABLE ${table}`)
    assert.equal((await call()).status, 503)
    assert.equal(sql.prepare("SELECT status FROM boing_projects WHERE id='p'").get().status, 'active')
    assert.equal(sql.prepare("SELECT revision FROM boing_source_versions WHERE project_id='p'").get().revision, 1)
  }
})
