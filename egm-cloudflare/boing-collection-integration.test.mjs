import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { BOING_IDENTITY_SCHEMA } from './boing-identity.mjs'
import { GITHUB_APP_SCHEMA } from './boing-github-app.mjs'
import { JOBS_SCHEMA, enqueueCollectionJob, claimCollectionJob, publishCollectionSnapshot } from './boing-jobs.mjs'
import { runCollectionTick } from './boing-scheduler.mjs'
import { createBoingWorker } from './boing-worker.mjs'
import { handleBoingRoute } from './boing-router.mjs'
import { readMetricHistory } from './boing-history.mjs'

function fixture({ revokeDuringCollection = false, failProvider = false } = {}) {
  const sql = new DatabaseSync(':memory:')
  sql.exec('PRAGMA foreign_keys=ON')
  sql.exec(BOING_IDENTITY_SCHEMA)
  sql.exec(readFileSync(new URL('./boing-tenancy-schema.sql', import.meta.url), 'utf8'))
  sql.exec(GITHUB_APP_SCHEMA)
  sql.exec(JOBS_SCHEMA)
  sql.exec(readFileSync(new URL('./boing-provider-budget.sql', import.meta.url), 'utf8'))
  sql.exec(readFileSync(new URL('./boing-execution-fence-migration.sql', import.meta.url), 'utf8'))
  for (const suffix of ['A', 'B']) {
    sql.prepare("INSERT INTO boing_identities VALUES(?,?,'active')").run(`user_${suffix}`, `${suffix.toLowerCase()}@example.com`)
    sql.prepare("INSERT INTO boing_organizations VALUES(?,?,?,'active',0,'now')").run(`org-${suffix}`, `Workspace ${suffix}`, `org_${suffix}`)
    sql.prepare("INSERT INTO boing_memberships VALUES(?,?,'owner','active','now')").run(`org-${suffix}`, `user_${suffix}`)
    sql.prepare("INSERT INTO boing_projects VALUES(?,?,?,NULL,?,'active','now')").run(`project-${suffix}`, `org-${suffix}`, `Project ${suffix}`, `https://${suffix.toLowerCase()}.example.org/`)
    sql.prepare("INSERT INTO boing_source_versions VALUES(?,'website',1)").run(`project-${suffix}`)
  }
  const DB = { prepare(query) { return { bind(...args) { return {
    async first() { return sql.prepare(query).get(...args) ?? null },
    async all() { return { results: sql.prepare(query).all(...args) } },
    async run() { return { meta: { changes: Number(sql.prepare(query).run(...args).changes) } } },
  } } } }, async batch(statements) {
    sql.exec('BEGIN')
    try { const rows = []; for (const statement of statements) rows.push(await statement.run()); sql.exec('COMMIT'); return rows } catch (error) { sql.exec('ROLLBACK'); throw error }
  } }
  const env = { DB, APP_URL: 'https://app.test', WORKOS_API_KEY: 'mock-workos', BOING_COLLECTION_ENABLED: 'true', BOING_PAGESPEED_BUDGET_APPROVED: 'true', PAGESPEED_API_KEY: 'mock-pagespeed', BOING_PAGESPEED_DAILY_CALL_LIMIT: '100', BOING_PAGESPEED_WORKSPACE_DAILY_CALL_LIMIT: '10' }
  let revoked = false, pageCalls = 0
  const request = async url => {
    const parsed = new URL(url)
    if (parsed.hostname === 'api.workos.com') {
      const userId = parsed.searchParams.get('user_id'), organizationId = parsed.searchParams.get('organization_id')
      const status = revoked && userId === 'user_B' ? 'inactive' : 'active'
      return Response.json({ object: 'list', data: [{ user_id: userId, organization_id: organizationId, status }], list_metadata: { after: null } })
    }
    if (parsed.hostname === 'www.googleapis.com') {
      pageCalls++
      const website = new URL(parsed.searchParams.get('url'))
      if (website.hostname === 'b.example.org' && revokeDuringCollection) revoked = true
      if (website.hostname === 'b.example.org' && failProvider) return new Response(null, { status: 503 })
      return Response.json({ lighthouseResult: { categories: { performance: { score: website.hostname === 'a.example.org' ? 0.81 : 0.64 } } } })
    }
    throw new Error('unexpected network request')
  }
  const worker = createBoingWorker({
    authenticate: async (_env, token) => ({ status: 'active', user: { id: token === 'a'.repeat(43) ? 'user_A' : 'user_B', verified: 1, status: 'active' } }),
    collectionTick: e => runCollectionTick(e, { request }),
    route: (req, e, user, org) => handleBoingRoute(req, e, user, org, { requestWorkos: request }),
  })
  const sourceRequest = (project, organization, token) => new Request(`https://app.test/api/boing/projects/${project}/sources`, { headers: { cookie: `__Host-boing_session=${token.repeat(43)}`, 'x-boing-organization': organization } })
  return { sql, env, worker, sourceRequest, request, calls: () => pageCalls }
}

test('scheduled collection reaches authenticated, tenant-scoped source reads', async () => {
  const f = fixture()
  await f.worker.scheduled({}, f.env)
  assert.equal(f.calls(), 2)
  const anonymous = new Request('https://app.test/api/boing/projects/project-A/sources', { headers: { 'x-boing-organization': 'org-A' } })
  assert.equal((await f.worker.fetch(anonymous, f.env)).status, 401)
  const response = await f.worker.fetch(f.sourceRequest('project-A', 'org-A', 'a'), f.env)
  assert.equal(response.status, 200)
  const website = (await response.json()).sources.find(source => source.kind === 'website')
  assert.equal(website.data.performanceScore, 81)
  assert.ok(website.generatedAt)
  assert.equal((await f.worker.fetch(f.sourceRequest('project-B', 'org-A', 'a'), f.env)).status, 404)
  const other = await f.worker.fetch(f.sourceRequest('project-B', 'org-B', 'b'), f.env)
  assert.equal((await other.json()).sources.find(source => source.kind === 'website').data.performanceScore, 64)
})

test('provider outage and WorkOS revocation during collection never publish a result', async () => {
  for (const mode of ['outage', 'revoked']) {
    const f = fixture({ failProvider: mode === 'outage', revokeDuringCollection: mode === 'revoked' })
    await f.worker.scheduled({}, f.env)
    assert.equal(f.sql.prepare("SELECT count(*) AS n FROM boing_collection_results WHERE project_id='project-B'").get().n, 0)
    assert.equal(f.sql.prepare("SELECT count(*) AS n FROM boing_metric_history WHERE project_id='project-B'").get().n, 0)
    assert.equal(f.sql.prepare("SELECT status FROM boing_collection_jobs WHERE project_id='project-B'").get().status, 'failed')
    assert.equal(f.sql.prepare("SELECT count(*) AS n FROM boing_collection_results WHERE project_id='project-A'").get().n, 1)
    if (mode === 'revoked') assert.equal((await f.worker.fetch(f.sourceRequest('project-B', 'org-B', 'b'), f.env)).status, 403)
  }
})

test('history stores allowlisted metrics and rejects cross-tenant and obsolete source reads', async () => {
  const f = fixture()
  await f.worker.scheduled({}, f.env)
  const user = { id: 'user_A', verified: 1, status: 'active' }
  const options = { requestWorkos: f.request, requestGithub: f.request }
  const history = await readMetricHistory(f.env, user, 'org-A', 'project-A', options)
  assert.equal(history.status, 'allowed')
  assert.deepEqual(history.history[0].metrics, { performanceScore: 81 })
  assert.equal((await readMetricHistory(f.env, user, 'org-A', 'project-B', options)).status, 'denied')
  f.sql.exec("UPDATE boing_source_versions SET revision=2 WHERE project_id='project-A' AND kind='website'")
  assert.deepEqual((await readMetricHistory(f.env, user, 'org-A', 'project-A', options)).history, [])
  f.sql.exec("UPDATE boing_memberships SET status='suspended' WHERE organization_id='org-A'")
  assert.equal((await readMetricHistory(f.env, user, 'org-A', 'project-A', options)).status, 'denied')
})

test('disconnected website and GitHub bindings and suspended installations never reveal history', async () => {
  const f = fixture(), user = { id: 'user_A', verified: 1, status: 'active' }
  const options = { requestWorkos: f.request, requestGithub: f.request }
  await f.worker.scheduled({}, f.env)
  f.sql.exec(`INSERT INTO boing_source_versions VALUES('project-A','github',1);
    INSERT INTO boing_metric_history VALUES('org-A','project-A','github',1,date('now'),datetime('now'),' {"stars":12345}');`)
  let result = await readMetricHistory(f.env, user, 'org-A', 'project-A', options)
  assert.equal(result.status, 'allowed')
  assert.deepEqual(result.history.map(row => row.kind), ['website'])
  f.sql.exec("UPDATE boing_projects SET website_url=NULL WHERE id='project-A'")
  result = await readMetricHistory(f.env, user, 'org-A', 'project-A', options)
  assert.equal(result.status, 'allowed')
  assert.deepEqual(result.history, [])
  f.sql.exec(`INSERT INTO boing_github_installations VALUES(1,'org-A',1,'owner','active');
    INSERT INTO boing_github_repositories VALUES('org-A','project-A',1,11,'owner/repo');
    UPDATE boing_github_installations SET status='suspended' WHERE installation_id=1;`)
  result = await readMetricHistory(f.env, user, 'org-A', 'project-A', options)
  assert.notEqual(result.status, 'allowed')
  assert.doesNotMatch(JSON.stringify(result), /12345/)
  f.sql.exec("DELETE FROM boing_github_repositories WHERE project_id='project-A'")
  result = await readMetricHistory(f.env, user, 'org-A', 'project-A', options)
  assert.equal(result.status, 'allowed')
  assert.deepEqual(result.history, [])
  assert.notEqual((await readMetricHistory(f.env, user, 'org-A', 'project-B', options)).status, 'allowed')
})

test('history is daily, bounded, and atomic with source publication', async () => {
  const f = fixture(), actor = { id: 'user_A', verified: 1 }, now = Date.parse('2026-10-28T12:00:00Z')
  f.sql.exec("INSERT INTO boing_metric_history VALUES('org-A','project-A','website',1,'2020-01-01','2020-01-01T00:00:00Z','{}')")
  async function publish(time, score) {
    const id = await enqueueCollectionJob(f.env.DB, actor, 'org-A', 'project-A', 'website', time)
    const claim = await claimCollectionJob(f.env.DB, id, time)
    return publishCollectionSnapshot(f.env.DB, { organizationId: 'org-A', projectId: 'project-A', jobId: id, claimId: claim.claimId, snapshot: JSON.stringify({ performanceScore: score, secret: 'private' }), now: time })
  }
  assert.equal(await publish(now, 70), true)
  assert.equal(await publish(now + 1000, 75), true)
  const rows = f.sql.prepare('SELECT * FROM boing_metric_history').all()
  assert.equal(rows.length, 1)
  assert.deepEqual(JSON.parse(rows[0].metrics), { performanceScore: 75 })
  f.sql.exec("CREATE TRIGGER reject_history BEFORE INSERT ON boing_metric_history BEGIN SELECT RAISE(ABORT, 'history failure'); END")
  await assert.rejects(publish(now + 2000, 80))
  assert.equal(JSON.parse(f.sql.prepare("SELECT body FROM boing_collection_results WHERE project_id='project-A'").get().body).performanceScore, 75)
  assert.equal(JSON.parse(f.sql.prepare('SELECT metrics FROM boing_metric_history').get().metrics).performanceScore, 75)
})
