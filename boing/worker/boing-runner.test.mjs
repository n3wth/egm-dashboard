import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { BOING_IDENTITY_SCHEMA } from './boing-identity.mjs'
import { GITHUB_APP_SCHEMA } from './boing-github-app.mjs'
import { JOBS_SCHEMA, enqueueCollectionJob } from './boing-jobs.mjs'
import { runCollectionJob } from './boing-runner.mjs'

function setup() {
  const sql = new DatabaseSync(':memory:')
  sql.exec('PRAGMA foreign_keys=ON')
  sql.exec(BOING_IDENTITY_SCHEMA)
  sql.exec(readFileSync(new URL('./boing-tenancy-schema.sql', import.meta.url), 'utf8'))
  sql.exec(GITHUB_APP_SCHEMA)
  sql.exec(JOBS_SCHEMA)
  sql.exec(readFileSync(new URL('./boing-provider-budget.sql', import.meta.url), 'utf8'))
  sql.exec(readFileSync(new URL('./boing-execution-fence-migration.sql', import.meta.url), 'utf8'))
  sql.exec(`INSERT INTO boing_identities VALUES('user_123','owner@example.com','active');
    INSERT INTO boing_organizations VALUES('a','A','org_A','active',0,'now');
    INSERT INTO boing_projects VALUES('p','a','Project','one/repo','https://one.com','active','now');
    INSERT INTO boing_memberships VALUES('a','user_123','owner','active','now');
    INSERT INTO boing_source_versions VALUES('p','github',1),('p','website',1);
    INSERT INTO boing_github_installations VALUES(1,'a',1,'one','active');
    INSERT INTO boing_github_repositories VALUES('a','p',1,11,'one/repo');`)
  const db = {
    prepare(query) { return { bind(...args) { return {
      async first() { return sql.prepare(query).get(...args) ?? null },
      async run() { return { meta: { changes: Number(sql.prepare(query).run(...args).changes) } } },
    } } } },
    async batch(statements) {
      sql.exec('BEGIN')
      try { const result = []; for (const statement of statements) result.push(await statement.run()); sql.exec('COMMIT'); return result } catch (error) { sql.exec('ROLLBACK'); throw error }
    },
  }
  return { sql, db, env: { DB: db, WORKOS_API_KEY: 'secret-workos', GITHUB_APP_ID: '1', GITHUB_APP_PRIVATE_KEY: 'secret-key', PAGESPEED_API_KEY: 'secret-pagespeed', BOING_PAGESPEED_BUDGET_APPROVED: 'true', BOING_GITHUB_DAILY_CALL_LIMIT: '100', BOING_GITHUB_WORKSPACE_DAILY_CALL_LIMIT: '10', BOING_PAGESPEED_DAILY_CALL_LIMIT: '100', BOING_PAGESPEED_WORKSPACE_DAILY_CALL_LIMIT: '10' } }
}
const actor = { id: 'user_123', verified: 1 }
const now = 1_800_000_000_000
const workos = async () => Response.json({ object: 'list', data: [{ user_id: 'user_123', organization_id: 'org_A', status: 'active' }], list_metadata: { after: null } })
const githubResult = () => ({ repository: { id: 11, private: true, accessToken: 'never-save' }, metrics: { stars: 0, forks: 4 }, traffic: { views: { count: 8, uniques: 3, status: 'available' } }, secret: 'never-save' })

test('collects a verified scoped GitHub job and stores only allowed metrics', async () => {
  const { db, env, sql } = setup()
  const id = await enqueueCollectionJob(db, actor, 'a', 'p', 'github', now)
  let checks = 0
  const result = await runCollectionJob(env, id, { clock: () => now + 1, request: async (...args) => { checks++; return workos(...args) }, githubCollector: async config => { assert.equal(config.repositoryId, 11); return githubResult() } })
  assert.deepEqual(result, { status: 'completed' })
  assert.equal(checks, 2)
  assert.equal(sql.prepare('SELECT state FROM boing_collection_executions').get().state, 'settled')
  const body = sql.prepare('SELECT body FROM boing_collection_results').get().body
  assert.equal(JSON.parse(body).metrics.stars, 0)
  assert.doesNotMatch(body, /never-save|secret/)
  assert.equal((await runCollectionJob(env, id, { clock: () => now + 2, request: workos })).status, 'unavailable')
})

test('missing execution table prevents all network calls', async () => {
  const { db, env, sql } = setup()
  sql.exec('DROP TABLE boing_collection_executions')
  const id = await enqueueCollectionJob(db, actor, 'a', 'p', 'github', now)
  let calls = 0
  const result = await runCollectionJob(env, id, { clock: () => now + 1, request: async () => { calls++; return workos() } })
  assert.equal(result.status, 'unavailable')
  assert.equal(calls, 0)
})

test('suspension and ambiguous provider failures leave durable unsettled execution records', async () => {
  for (const mode of ['suspension', 'timeout']) {
    const { db, env, sql } = setup()
    const id = await enqueueCollectionJob(db, actor, 'a', 'p', 'github', now)
    const request = async url => {
      if (new URL(url).hostname === 'api.workos.com') return workos()
      throw new Error('provider timeout')
    }
    const result = await runCollectionJob(env, id, { clock: () => now + 1, request, githubCollector: async (_config, providerRequest) => {
      if (mode === 'suspension') {
        sql.exec("UPDATE boing_organizations SET status='suspended' WHERE id='a'; UPDATE boing_collection_jobs SET status='cancelled',claim_id=NULL,lease_expires_at=NULL WHERE id='" + id + "'")
        return githubResult()
      }
      await providerRequest('https://api.github.com/test')
      return githubResult()
    } })
    assert.ok(['denied', 'unavailable'].includes(result.status))
    assert.equal(sql.prepare('SELECT state FROM boing_collection_executions').get().state, 'uncertain')
  }
})

test('revocation and provider outage fail closed before collection', async () => {
  for (const request of [async () => Response.json({ object: 'list', data: [], list_metadata: { after: null } }), async () => { throw Error('offline') }]) {
    const { db, env, sql } = setup()
    const id = await enqueueCollectionJob(db, actor, 'a', 'p', 'github', now)
    let called = 0
    const outcome = await runCollectionJob(env, id, { clock: () => now + 1, request, githubCollector: async () => { called++; return githubResult() } })
    assert.ok(['denied', 'unavailable'].includes(outcome.status))
    assert.equal(called, 0)
    assert.equal(sql.prepare('SELECT count(*) n FROM boing_collection_results').get().n, 0)
  }
})

test('revocation or source changes during collection prevent publication', async () => {
  for (const mutation of ["UPDATE boing_source_versions SET revision=2 WHERE project_id='p' AND kind='github'", "UPDATE boing_memberships SET status='suspended' WHERE organization_id='a'"]) {
    const { db, env, sql } = setup()
    const id = await enqueueCollectionJob(db, actor, 'a', 'p', 'github', now)
    const outcome = await runCollectionJob(env, id, { clock: () => now + 1, request: workos, githubCollector: async () => { sql.exec(mutation); return githubResult() } })
    assert.equal(outcome.status, 'denied')
    assert.equal(sql.prepare('SELECT count(*) n FROM boing_collection_results').get().n, 0)
  }
})

test('reapproved membership or changed role during collection cannot publish old work', async () => {
  for (const mode of ['rebind', 'role']) {
    const { db, env, sql } = setup()
    sql.exec(readFileSync(new URL('./boing-membership-binding-migration.sql', import.meta.url), 'utf8'))
    sql.exec("INSERT INTO boing_workos_membership_bindings VALUES('a','user_123','om_1','2026-01-01T00:00:00.000Z')")
    env.BOING_MEMBERSHIP_BINDING_REQUIRED = 'true'
    let version = '2026-01-01T00:00:00.000Z'
    const request = async () => Response.json({ object: 'list', data: [{ id: 'om_1', user_id: 'user_123', organization_id: 'org_A', status: 'active', updated_at: version }], list_metadata: { after: null } })
    const id = await enqueueCollectionJob(db, actor, 'a', 'p', 'github', now)
    const result = await runCollectionJob(env, id, { clock: () => now + 1, request, githubCollector: async () => {
      if (mode === 'rebind') { version = '2026-01-02T00:00:00.000Z'; sql.prepare('UPDATE boing_workos_membership_bindings SET workos_updated_at=?').run(version) }
      else sql.exec("UPDATE boing_memberships SET role='member' WHERE organization_id='a'; INSERT INTO boing_project_memberships VALUES('a','p','user_123','now')")
      return githubResult()
    } })
    assert.equal(result.status, 'denied')
    assert.equal(sql.prepare('SELECT count(*) n FROM boing_collection_results').get().n, 0)
  }
})

test('website collection requires budget approval and unavailable output is not published', async () => {
  const { db, env, sql } = setup()
  let called = 0
  env.BOING_PAGESPEED_BUDGET_APPROVED = 'false'
  let id = await enqueueCollectionJob(db, actor, 'a', 'p', 'website', now)
  let outcome = await runCollectionJob(env, id, { clock: () => now + 1, request: workos, websiteCollector: async () => { called++; return { status: 'available', performanceScore: 88 } } })
  assert.equal(outcome.status, 'unavailable')
  assert.equal(called, 0)
  env.BOING_PAGESPEED_BUDGET_APPROVED = 'true'
  id = await enqueueCollectionJob(db, actor, 'a', 'p', 'website', now + 2)
  outcome = await runCollectionJob(env, id, { clock: () => now + 3, request: workos, websiteCollector: async () => ({ status: 'unavailable', reason: 'secret' }) })
  assert.equal(outcome.status, 'unavailable')
  assert.equal(sql.prepare('SELECT count(*) n FROM boing_collection_results').get().n, 0)
  id = await enqueueCollectionJob(db, actor, 'a', 'p', 'website', now + 4)
  outcome = await runCollectionJob(env, id, { clock: () => now + 5, request: workos, websiteCollector: async () => ({ status: 'available', performanceScore: 88, key: 'secret' }) })
  assert.equal(outcome.status, 'completed')
  assert.deepEqual(JSON.parse(sql.prepare('SELECT body FROM boing_collection_results').get().body), { source: 'PageSpeed Insights', status: 'available', performanceScore: 88 })
})

test('suspension before a provider request prevents dispatch and consumes no call budget', async () => {
  const { db, env, sql } = setup()
  const id = await enqueueCollectionJob(db, actor, 'a', 'p', 'website', now)
  let providerCalls = 0
  const request = async url => {
    if (new URL(url).hostname === 'api.workos.com') return workos()
    providerCalls++
    return Response.json({})
  }
  const result = await runCollectionJob(env, id, { clock: () => now + 1, request, websiteCollector: async (_url, _key, providerRequest) => {
    sql.exec("UPDATE boing_organizations SET status='suspended' WHERE id='a'")
    await providerRequest('https://www.googleapis.com/test')
    return { status: 'available', performanceScore: 80 }
  } })
  assert.equal(result.status, 'unavailable')
  assert.equal(providerCalls, 0)
  assert.equal(sql.prepare('SELECT count(*) n FROM boing_provider_call_budget').get().n, 0)
})
