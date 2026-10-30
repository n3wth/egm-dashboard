import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { BOING_IDENTITY_SCHEMA } from './boing-identity.mjs'
import { GITHUB_APP_SCHEMA } from './boing-github-app.mjs'
import { JOBS_SCHEMA, enqueueCollectionJob } from './boing-jobs.mjs'
import { runCollectionJob } from './boing-runner.mjs'
import { COLLECTION_INTERVAL_MS, runCollectionTick } from './boing-scheduler.mjs'
import { admitManualCollection } from './boing-manual-collection.mjs'

const now = 1_800_000_000_000
function fixture(count = 1) {
  const sql = new DatabaseSync(':memory:')
  sql.exec(BOING_IDENTITY_SCHEMA)
  sql.exec(readFileSync(new URL('./boing-tenancy-schema.sql', import.meta.url), 'utf8'))
  sql.exec(GITHUB_APP_SCHEMA)
  sql.exec(JOBS_SCHEMA)
  sql.exec(readFileSync(new URL('./boing-provider-budget.sql', import.meta.url), 'utf8'))
  sql.exec(readFileSync(new URL('./boing-execution-fence-migration.sql', import.meta.url), 'utf8'))
  sql.exec("INSERT INTO boing_identities VALUES('user_Owner','owner@example.com','active'); INSERT INTO boing_organizations VALUES('org1','One','org_One','active',0,'now'); INSERT INTO boing_memberships VALUES('org1','user_Owner','owner','active','now');")
  for (let i = 0; i < count; i++) {
    sql.prepare("INSERT INTO boing_projects VALUES(?, 'org1', ?, NULL, 'https://example.org/', 'active', 'now')").run(`project${i}`, `Project ${i}`)
    sql.prepare("INSERT INTO boing_source_versions VALUES(?, 'website', 1)").run(`project${i}`)
  }
  const db = { prepare(query) { return { bind(...args) { return {
    async first() { return sql.prepare(query).get(...args) ?? null },
    async all() { return { results: sql.prepare(query).all(...args) } },
    async run() { return { meta: { changes: Number(sql.prepare(query).run(...args).changes) } } }
  } } } }, async batch(statements) {
    sql.exec('BEGIN')
    try { const rows = []; for (const statement of statements) rows.push(await statement.run()); sql.exec('COMMIT'); return rows } catch (error) { sql.exec('ROLLBACK'); throw error }
  } }
  const env = { DB: db, BOING_COLLECTION_ENABLED: 'true', BOING_PAGESPEED_BUDGET_APPROVED: 'true', PAGESPEED_API_KEY: 'secret', BOING_PAGESPEED_DAILY_CALL_LIMIT: '100', BOING_PAGESPEED_WORKSPACE_DAILY_CALL_LIMIT: '10' }
  const resolveContext = async (_env, actor, organizationId) => ({ status: 'allowed', role: 'owner', userId: actor.id, organizationId })
  const runJob = async (_env, id) => { sql.prepare("UPDATE boing_collection_jobs SET status='completed' WHERE id=?").run(id); return { status: 'completed' } }
  return { sql, db, env, resolveContext, runJob }
}

test('collection is disabled without both explicit scheduler and provider budget gates', async () => {
  const f = fixture()
  assert.equal((await runCollectionTick({ ...f.env, BOING_COLLECTION_ENABLED: 'false' }, { now })).status, 'disabled')
  assert.equal((await runCollectionTick({ ...f.env, BOING_PAGESPEED_BUDGET_APPROVED: 'false' }, { now })).status, 'disabled')
  assert.equal(f.sql.prepare('SELECT count(*) AS n FROM boing_collection_jobs').get().n, 0)
})

test('scheduler does not admit work if execution tracking is unavailable', async () => {
  const f = fixture()
  f.sql.exec('DROP TABLE boing_collection_executions')
  assert.equal((await runCollectionTick(f.env, { now, resolveContext: f.resolveContext, runJob: f.runJob })).status, 'disabled')
  assert.equal(f.sql.prepare('SELECT count(*) AS n FROM boing_collection_jobs').get().n, 0)
})

test('overlapping ticks share the workspace hourly limit', async () => {
  const f = fixture(12)
  const opts = { now, resolveContext: f.resolveContext, runJob: f.runJob }
  const results = await Promise.all([runCollectionTick(f.env, opts), runCollectionTick(f.env, opts)])
  assert.ok(results.every(result => result.status === 'ok' && result.processed <= 10))
  assert.equal(f.sql.prepare('SELECT count(*) AS n FROM boing_collection_jobs').get().n, 5)
  assert.equal((await runCollectionTick(f.env, opts)).processed, 0)
  assert.equal((await runCollectionTick(f.env, { ...opts, now: now + COLLECTION_INTERVAL_MS + 1 })).processed, 5)
})

test('queued work is recovered and denied or unavailable owner memberships do not collect', async () => {
  const f = fixture(2)
  const actor = { id: 'user_Owner', verified: 1 }
  const queued = await enqueueCollectionJob(f.db, actor, 'org1', 'project0', 'website', now - 1000)
  const outcome = await runCollectionTick(f.env, { now, resolveContext: async () => ({ status: 'unavailable' }), runJob: f.runJob })
  assert.equal(outcome.processed, 1)
  assert.equal(f.sql.prepare('SELECT status FROM boing_collection_jobs WHERE id=?').get(queued).status, 'completed')
  assert.equal(f.sql.prepare('SELECT count(*) AS n FROM boing_collection_jobs').get().n, 1)
})

test('invalid queued jobs cannot starve valid work behind them', async () => {
  const f = fixture(11)
  const actor = { id: 'user_Owner', verified: 1 }
  const insert = f.sql.prepare(`INSERT INTO boing_collection_jobs (id,organization_id,project_id,actor_id,kind,source_revision,status,created_at,expires_at)
    VALUES (?,'org1',?,'user_Owner','website',1,'queued',?,?)`)
  for (let i = 0; i < 11; i++) insert.run(`seed${i}`, `project${i}`, new Date(now - 1000 + i).toISOString(), now + 900_000)
  for (let i = 0; i < 10; i++) f.sql.prepare("UPDATE boing_projects SET status='archived' WHERE id=?").run(`project${i}`)
  const result = await runCollectionTick(f.env, { now, resolveContext: f.resolveContext, runJob: f.runJob })
  assert.equal(result.processed, 1)
  assert.equal(f.sql.prepare("SELECT status FROM boing_collection_jobs WHERE project_id='project10'").get().status, 'completed')
})

test('manual and scheduled admissions share a single atomic workspace limit', async () => {
  const f = fixture(12)
  f.sql.exec(readFileSync(new URL('./boing-membership-binding-migration.sql', import.meta.url), 'utf8'))
  f.sql.exec("INSERT INTO boing_workos_membership_bindings VALUES('org1','user_Owner','om_A','v1')")
  f.env.BOING_MEMBERSHIP_BINDING_REQUIRED = 'true'
  const context = { status: 'allowed', organizationId: 'org1', userId: 'user_Owner', role: 'owner', membershipId: 'om_A', membershipUpdatedAt: 'v1' }
  const opts = { now, resolveContext: async () => context, runJob: f.runJob }
  await Promise.all([runCollectionTick(f.env, opts), ...Array.from({ length: 6 }, (_, i) => admitManualCollection(f.env, context, `project${i}`, now))])
  assert.equal(f.sql.prepare('SELECT count(*) AS n FROM boing_collection_jobs').get().n, 5)
})

test('scheduler admission rejects a membership binding changed after provider verification', async () => {
  const f = fixture()
  f.sql.exec(readFileSync(new URL('./boing-membership-binding-migration.sql', import.meta.url), 'utf8'))
  f.sql.exec("INSERT INTO boing_workos_membership_bindings VALUES('org1','user_Owner','om_A','v2')")
  f.env.BOING_MEMBERSHIP_BINDING_REQUIRED = 'true'
  const resolveContext = async () => ({ status: 'allowed', role: 'owner', organizationId: 'org1', membershipId: 'om_A', membershipUpdatedAt: 'v1' })
  const result = await runCollectionTick(f.env, { now, resolveContext, runJob: f.runJob })
  assert.equal(result.processed, 0)
  assert.equal(f.sql.prepare('SELECT count(*) AS n FROM boing_collection_jobs').get().n, 0)
})

test('scheduled admission respects the global rolling hourly limit across workspaces', async () => {
  const f = fixture(1)
  // Other workspaces count toward the global limit as well.
  for (let i = 0; i < 10; i++) {
    f.sql.prepare('INSERT INTO boing_organizations VALUES(?,?,?,?,?,?)').run(`org${i + 2}`, `Workspace ${i}`, `org_W${i}`, 'active', 0, 'now')
    f.sql.prepare('INSERT INTO boing_memberships VALUES(?,?,?,?,?)').run(`org${i + 2}`, 'user_Owner', 'owner', 'active', 'now')
    f.sql.prepare('INSERT INTO boing_projects VALUES(?,?,?,?,?,?,?)').run(`other${i}`, `org${i + 2}`, 'Other', null, 'https://example.org/', 'active', 'now')
    f.sql.prepare("INSERT INTO boing_collection_jobs VALUES(?,?,?,?,?,?,'completed',NULL,?,?,NULL,NULL)").run(`seed${i}`, `org${i + 2}`, `other${i}`, 'user_Owner', 'website', 1, new Date(now - 1000).toISOString(), now)
  }
  const id = await enqueueCollectionJob(f.db, { id: 'user_Owner', verified: 1 }, 'org1', 'project0', 'website', now)
  assert.equal(id, null)
  assert.equal(f.sql.prepare('SELECT count(*) AS n FROM boing_collection_jobs').get().n, 10)
})

test('scheduled collection runs the real authorization and publication path', async () => {
  const f = fixture()
  f.env.WORKOS_API_KEY = 'workos-secret'
  const request = async () => Response.json({ object: 'list', data: [{ user_id: 'user_Owner', organization_id: 'org_One', status: 'active' }], list_metadata: { after: null } })
  let calls = 0
  const runJob = (env, id) => runCollectionJob(env, id, { clock: () => now + 1, request, websiteCollector: async () => { calls++; return { status: 'available', performanceScore: 91 } } })
  assert.equal((await runCollectionTick(f.env, { now, request, runJob })).processed, 1)
  assert.equal(calls, 1)
  assert.deepEqual(JSON.parse(f.sql.prepare('SELECT body FROM boing_collection_results').get().body), { source: 'PageSpeed Insights', status: 'available', performanceScore: 91 })
})

test('rotates past revoked owners and eventually tries alternate owners within a bounded budget', async () => {
  const f = fixture(30)
  for (let i = 0; i < 7; i++) {
    f.sql.prepare("INSERT INTO boing_identities VALUES(?,?,'active')").run(`user_Alt${i}`, `alt${i}@example.com`)
    f.sql.prepare("INSERT INTO boing_memberships VALUES('org1',?,'owner','active','now')").run(`user_Alt${i}`)
  }
  let totalChecks = 0
  const resolveContext = async (_env, actor, organizationId) => {
    totalChecks++
    return actor.id === 'user_Alt6' ? { status: 'allowed', role: 'owner', organizationId } : { status: 'denied' }
  }
  let completed = 0
  for (let minute = 0; minute < 80 && !completed; minute++) {
    const before = totalChecks
    const result = await runCollectionTick(f.env, { now: now + minute * 600_000, resolveContext, runJob: f.runJob })
    assert.equal(result.status, 'ok')
    assert.ok(totalChecks - before <= 20)
    completed += result.processed
  }
  assert.ok(completed > 0)
  assert.equal(f.sql.prepare("SELECT count(*) AS n FROM boing_collection_jobs WHERE actor_id<>'user_Alt6'").get().n, 0)
})

test('rotating candidate scan reaches projects behind revoked owners', async () => {
  const f = fixture(30)
  for (let i = 0; i < 30; i++) {
    const org = `o${String(i).padStart(2, '0')}`, user = `user_X${i}`, project = `p${i}`
    f.sql.prepare("INSERT INTO boing_organizations VALUES(?,?,?,'active',0,'now')").run(org, org, `org_X${i}`)
    f.sql.prepare("INSERT INTO boing_identities VALUES(?,?,'active')").run(user, `${i}@example.com`)
    f.sql.prepare("INSERT INTO boing_memberships VALUES(?,?,'owner','active','now')").run(org, user)
    f.sql.prepare("INSERT INTO boing_projects VALUES(?,?,?,NULL,'https://example.org/','active','now')").run(project, org, project)
    f.sql.prepare("INSERT INTO boing_source_versions VALUES(?,'website',1)").run(project)
  }
  let checks = 0, completed = 0
  const resolveContext = async (_env, _actor, org) => { checks++; return org === 'o29' ? { status: 'allowed', role: 'owner', organizationId: org } : { status: 'denied' } }
  for (let minute = 0; minute < 80 && !completed; minute++) {
    const before = checks
    const result = await runCollectionTick(f.env, { now: now + minute * 600_000, resolveContext, runJob: f.runJob })
    assert.ok(checks - before <= 20)
    completed += result.processed
  }
  assert.equal(completed, 1)
  assert.equal(f.sql.prepare('SELECT organization_id FROM boing_collection_jobs').get().organization_id, 'o29')
})
