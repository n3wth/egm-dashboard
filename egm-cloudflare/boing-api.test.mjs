import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { handleBoingApi as handleScopedApi } from './boing-api.mjs'
import { JOBS_SCHEMA } from './boing-jobs.mjs'
import { GITHUB_APP_SCHEMA } from './boing-github-app.mjs'
import { AUDIT_SCHEMA } from './boing-audit.mjs'

// In production the caller must verify this scope against WorkOS first.
const handleBoingApi = (request, env, user) => handleScopedApi(request, env, user, 'org_a')

function setup() {
  const sql = new DatabaseSync(':memory:')
  sql.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'))
  sql.exec(readFileSync(new URL('./boing-tenancy-schema.sql', import.meta.url), 'utf8'))
  sql.exec(JOBS_SCHEMA)
  sql.exec(GITHUB_APP_SCHEMA)
  sql.exec(AUDIT_SCHEMA)
  sql.exec(`INSERT INTO users(id,email,name,verified,status,created_at) VALUES
    ('owner','owner@example.com','Owner',1,'approved','now'),
    ('member','member@example.com','Member',1,'approved','now'),
    ('admin','admin@example.com','Admin',1,'approved','now'),
    ('outsider','outsider@example.com','Outsider',1,'approved','now');
    INSERT INTO boing_identities SELECT id,email,'active' FROM users WHERE status='approved' AND verified=1;
    INSERT INTO boing_organizations VALUES('org_a','A','org_a','active',0,'now'),('org_b','B','org_b','active',0,'now');
    INSERT INTO boing_projects VALUES('project_a','org_a','A','a/a','https://a.example','active','now'),('project_b','org_b','B','b/b','https://b.example','active','now'),('project_private','org_a','Private','a/private',NULL,'active','now');
    INSERT INTO boing_memberships VALUES('org_a','owner','owner','active','now'),('org_a','member','member','active','now'),('org_a','admin','admin','active','now'),('org_b','outsider','owner','active','now');
    INSERT INTO boing_project_memberships VALUES('org_a','project_a','member','now'),('org_a','project_a','admin','now');
    INSERT INTO boing_snapshots VALUES('project_a','{"value":"a"}','now'),('project_b','{"value":"secret"}','now'),('project_private','{"value":"private"}','now');
    INSERT INTO boing_presentations VALUES('project_a','{"title":"A"}',0),('project_b','{"title":"secret"}',0),('project_private','{"title":"private"}',0);
    INSERT INTO boing_source_versions VALUES('project_a','github',1),('project_a','website',1),('project_b','website',1);
    INSERT INTO boing_github_installations VALUES(1,'org_a',1,'a','active');
    INSERT INTO boing_github_repositories VALUES('org_a','project_a',1,1,'a/a');`)
  const DB = { prepare(query) { return { bind(...args) { return {
    async first() { return sql.prepare(query).get(...args) ?? null },
    async all() { return { results: sql.prepare(query).all(...args) } },
    async run() { return { meta: { changes: Number(sql.prepare(query).run(...args).changes) } } },
  } } } }, async batch(statements) {
    sql.exec('BEGIN')
    try { const result = []; for (const statement of statements) result.push(await statement.run()); sql.exec('COMMIT'); return result }
    catch (error) { sql.exec('ROLLBACK'); throw error }
  } }
  return { sql, env: { DB, APP_URL: 'https://app.boing.run' } }
}

const user = id => ({ id, status: 'active', verified: 1 })
const req = (path, options = {}) => new Request('https://app.boing.run' + path, options)
const put = (project, body, origin = 'https://app.boing.run') => req(`/api/boing/projects/${project}/presentation`, {
  method: 'PUT', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body),
})
const rename = (project, body, origin = 'https://app.boing.run') => req(`/api/boing/projects/${project}/name`, {
  method: 'PUT', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body),
})

test('rename requires an active owner and atomically records the scoped audit', async () => {
  const { env, sql } = setup()
  assert.equal((await handleScopedApi(rename('project_a', { name: ' X ' }, 'https://evil.example'), env, user('owner'), 'org_a')).status, 403)
  assert.equal((await handleScopedApi(rename('project_a', { name: '' }), env, user('owner'), 'org_a')).status, 400)
  assert.equal((await handleScopedApi(rename('project_a', { name: 'x', organizationId: 'org_b' }), env, user('owner'), 'org_a')).status, 400)
  assert.equal((await handleScopedApi(rename('project_b', { name: 'x' }), env, user('owner'), 'org_a')).status, 404)
  assert.equal((await handleScopedApi(rename('project_a', { name: 'x' }), env, user('admin'), 'org_a')).status, 404)
  const response = await handleScopedApi(rename('project_a', { name: '  Renamed  ' }), env, user('owner'), 'org_a')
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { project: { id: 'project_a', name: 'Renamed' } })
  assert.equal(sql.prepare("SELECT name FROM boing_projects WHERE id='project_a'").get().name, 'Renamed')
  assert.equal(sql.prepare("SELECT COUNT(*) n FROM boing_audit_events WHERE organization_id='org_a' AND project_id='project_a' AND action='project.renamed'").get().n, 1)
  sql.exec("UPDATE boing_organizations SET status='suspended' WHERE id='org_a'")
  assert.equal((await handleScopedApi(rename('project_a', { name: 'No' }), env, user('owner'), 'org_a')).status, 404)
  sql.exec("UPDATE boing_organizations SET status='active' WHERE id='org_a'; CREATE TRIGGER fail_rename_audit BEFORE INSERT ON boing_audit_events BEGIN SELECT RAISE(ABORT, 'audit failed'); END")
  assert.equal((await handleScopedApi(rename('project_a', { name: 'No' }), env, user('owner'), 'org_a')).status, 503)
  assert.equal(sql.prepare("SELECT name FROM boing_projects WHERE id='project_a'").get().name, 'Renamed')
})

test('rename rejects a changed WorkOS membership binding before the atomic write', async () => {
  const { env, sql } = setup()
  sql.exec(readFileSync(new URL('./boing-membership-binding-migration.sql', import.meta.url), 'utf8'))
  sql.exec("INSERT INTO boing_identities VALUES('user_1','owner1@example.com','active'); INSERT INTO boing_memberships VALUES('org_a','user_1','owner','active','now'); INSERT INTO boing_workos_membership_bindings VALUES('org_a','user_1','om_1','2026-01-01T00:00:00Z')")
  env.BOING_MEMBERSHIP_BINDING_REQUIRED = 'true'
  env.WORKOS_API_KEY = 'test'
  const context = { status: 'allowed', userId: 'user_1', organizationId: 'org_a', role: 'owner', membershipId: 'om_1', membershipUpdatedAt: '2026-01-01T00:00:00Z' }
  const requestWorkos = async () => Response.json({ object: 'list', list_metadata: { after: null }, data: [{ id: 'om_1', updated_at: context.membershipUpdatedAt, status: 'active', user_id: 'user_1', organization_id: 'org_a' }] })
  const batch = env.DB.batch
  env.DB.batch = async statements => { sql.exec("DELETE FROM boing_workos_membership_bindings WHERE user_id='user_1'"); return batch(statements) }
  const response = await handleScopedApi(rename('project_a', { name: 'No' }), env, user('user_1'), 'org_a', { context, requestWorkos })
  assert.equal(response.status, 404)
  assert.equal(sql.prepare("SELECT name FROM boing_projects WHERE id='project_a'").get().name, 'A')
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM boing_audit_events').get().n, 0)
})

test('project creation requires a current owner, same origin and server tenant scope', async () => {
  const { env, sql } = setup()
  const create = (body, origin = 'https://app.boing.run') => req('/api/boing/projects', {
    method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body),
  })
  assert.equal((await handleScopedApi(create({ name: 'X' }, 'https://evil.test'), env, user('owner'), 'org_a')).status, 403)
  assert.equal((await handleScopedApi(create({ name: 'X', organizationId: 'org_b' }), env, user('owner'), 'org_a')).status, 400)
  assert.equal((await handleScopedApi(create({ name: '   ' }), env, user('owner'), 'org_a')).status, 400)
  assert.equal((await handleScopedApi(create({ name: 'X' }), env, user('admin'), 'org_a')).status, 403)
  assert.equal((await handleScopedApi(create({ name: 'X' }), env, user('owner'), 'org_b')).status, 403)
  const result = await handleScopedApi(create({ name: '  New project  ' }), env, user('owner'), 'org_a')
  assert.equal(result.status, 201)
  const { project } = await result.json()
  assert.equal(project.name, 'New project')
  assert.deepEqual({ ...sql.prepare('SELECT organization_id,name,repository,website_url FROM boing_projects WHERE id=?').get(project.id) },
    { organization_id: 'org_a', name: 'New project', repository: null, website_url: null })
  sql.exec("UPDATE boing_memberships SET status='suspended' WHERE organization_id='org_a' AND user_id='owner'")
  assert.equal((await handleScopedApi(create({ name: 'X' }), env, user('owner'), 'org_a')).status, 403)
})

test('gated writes retain the originally verified membership through body reads and SQL', async () => {
  const { env, sql } = setup()
  sql.exec(readFileSync(new URL('./boing-membership-binding-migration.sql', import.meta.url), 'utf8'))
  sql.exec("INSERT INTO boing_identities VALUES('user_1','owner1@example.com','active'); INSERT INTO boing_memberships VALUES('org_a','user_1','owner','active','now'); INSERT INTO boing_workos_membership_bindings VALUES('org_a','user_1','om_1','2026-01-01T00:00:00Z')")
  env.BOING_MEMBERSHIP_BINDING_REQUIRED = 'true'
  env.WORKOS_API_KEY = 'test'
  const context = { status: 'allowed', userId: 'user_1', organizationId: 'org_a', role: 'owner', membershipId: 'om_1', membershipUpdatedAt: '2026-01-01T00:00:00Z' }
  let version = context.membershipUpdatedAt
  const requestWorkos = async () => Response.json({ object: 'list', list_metadata: { after: null }, data: [{ id: 'om_1', updated_at: version, status: 'active', user_id: 'user_1', organization_id: 'org_a' }] })
  const create = () => req('/api/boing/projects', { method: 'POST', headers: { origin: env.APP_URL, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'New' }) })
  const update = () => put('project_a', { revision: 0, presentation: { title: 'Changed' } })
  const call = request => handleScopedApi(request, env, user('user_1'), 'org_a', { context, requestWorkos })
  assert.equal((await handleScopedApi(create(), env, user('user_1'), 'org_a')).status, 403)
  assert.equal((await call(create())).status, 201)
  for (const [path, method, body] of [
    ['/api/boing/projects', 'POST', { name: 'Streamed' }],
    ['/api/boing/projects/project_a/presentation', 'PUT', { revision: 0, presentation: { title: 'Changed' } }],
  ]) {
    const stream = new ReadableStream({ pull(controller) {
      version = '2026-02-01T00:00:00Z'
      sql.prepare('UPDATE boing_workos_membership_bindings SET workos_updated_at=? WHERE user_id=?').run(version, 'user_1')
      controller.enqueue(new TextEncoder().encode(JSON.stringify(body)))
      controller.close()
    } })
    assert.equal((await call(req(path, { method, headers: { origin: env.APP_URL, 'content-type': 'application/json' }, body: stream, duplex: 'half' }))).status, 403)
    version = context.membershipUpdatedAt
    sql.prepare('UPDATE boing_workos_membership_bindings SET workos_updated_at=? WHERE user_id=?').run(version, 'user_1')
  }
  for (const makeRequest of [create, update]) {
    version = '2026-02-01T00:00:00Z'
    sql.prepare('UPDATE boing_workos_membership_bindings SET workos_updated_at=? WHERE user_id=?').run(version, 'user_1')
    assert.equal((await call(makeRequest())).status, 403)
  }
  version = context.membershipUpdatedAt
  sql.prepare('UPDATE boing_workos_membership_bindings SET workos_updated_at=? WHERE user_id=?').run(version, 'user_1')
  const originalPrepare = env.DB.prepare
  env.DB.prepare = query => {
    const statement = originalPrepare(query)
    if (!query.startsWith('INSERT INTO boing_projects') && !query.startsWith('UPDATE boing_presentations')) return statement
    return { bind(...args) { const bound = statement.bind(...args); return { async run() {
      sql.exec("DELETE FROM boing_workos_membership_bindings WHERE user_id='user_1'")
      return bound.run()
    } } } }
  }
  assert.equal((await call(create())).status, 403)
  sql.prepare('INSERT INTO boing_workos_membership_bindings VALUES(?,?,?,?)').run('org_a', 'user_1', context.membershipId, version)
  assert.equal((await call(update())).status, 409)
  assert.equal(sql.prepare("SELECT revision FROM boing_presentations WHERE project_id='project_a'").get().revision, 0)
})

test('requires server identity and exposes only active member projects', async () => {
  const { env, sql } = setup()
  assert.equal(await handleBoingApi(req('/api/unrelated'), env, user('owner')), null)
  assert.equal((await handleBoingApi(req('/api/boing/projects'), env, null)).status, 401)
  assert.equal((await handleBoingApi(req('/api/boing/projects?userId=owner'), env, { id: 'owner', status: 'active', verified: 0 })).status, 401)
  const result = await handleBoingApi(req('/api/boing/projects'), env, user('member'))
  assert.equal(result.headers.get('cache-control'), 'private, no-store')
  assert.deepEqual((await result.json()).projects.map(p => p.id), ['project_a'])
  sql.exec("UPDATE boing_memberships SET status='suspended' WHERE user_id='member'")
  assert.deepEqual((await (await handleBoingApi(req('/api/boing/projects'), env, user('member'))).json()).projects, [])
})

test('server-verified organization scope limits listing and resource access', async () => {
  const { env, sql } = setup()
  sql.exec("INSERT INTO boing_memberships VALUES('org_b','member','owner','active','now')")
  assert.equal((await handleScopedApi(req('/api/boing/projects'), env, user('member'))).status, 403)
  const scoped = await handleScopedApi(req('/api/boing/projects?organizationId=org_b'), env, user('member'), 'org_a')
  assert.deepEqual((await scoped.json()).projects.map(project => project.id), ['project_a'])
  assert.equal((await handleScopedApi(req('/api/boing/projects/project_b/snapshot'), env, user('member'), 'org_a')).status, 404)
  const other = await handleScopedApi(req('/api/boing/projects'), env, user('member'), 'org_b')
  assert.deepEqual((await other.json()).projects.map(project => project.id), ['project_b'])
})

test('cross-tenant reads do not expose data and missing snapshot has no seed fallback', async () => {
  const { env, sql } = setup()
  for (const suffix of ['snapshot', 'presentation']) {
    const result = await handleBoingApi(req(`/api/boing/projects/project_b/${suffix}`), env, user('member'))
    assert.equal(result.status, 404)
    assert.doesNotMatch(await result.text(), /secret/)
  }
  for (const suffix of ['snapshot', 'presentation']) {
    const result = await handleBoingApi(req(`/api/boing/projects/project_private/${suffix}`), env, user('member'))
    assert.equal(result.status, 404)
    assert.doesNotMatch(await result.text(), /private/)
  }
  assert.equal((await handleBoingApi(req('/api/boing/projects/project_private/snapshot'), env, user('owner'))).status, 200)
  sql.exec("DELETE FROM boing_snapshots WHERE project_id='project_a'")
  assert.equal((await handleBoingApi(req('/api/boing/projects/project_a/snapshot'), env, user('member'))).status, 404)
})

test('source results keep independent freshness, failures, and tenant boundaries', async () => {
  const { env, sql } = setup()
  sql.exec(`INSERT INTO boing_collection_results VALUES
    ('project_a','github',1,'{"stars":7}','2026-01-01T00:00:00Z'),
    ('project_b','website',1,'{"secret":99}','2026-01-02T00:00:00Z');
    INSERT INTO boing_collection_jobs(id,organization_id,project_id,actor_id,kind,source_revision,status,created_at,expires_at,finished_at)
    VALUES('job1','org_a','project_a','owner','github',1,'failed','2026-01-03',10,'2026-01-03');`)
  const response = await handleBoingApi(req('/api/boing/projects/project_a/sources'), env, user('member'))
  assert.equal(response.status, 200)
  assert.deepEqual((await response.json()).sources, [
    { kind: 'github', collectionConfigured: false, available: true, data: { stars: 7 }, generatedAt: '2026-01-01T00:00:00Z', lastCollection: { status: 'failed', finishedAt: '2026-01-03' }, error: 'collection_failed' },
    { kind: 'website', collectionConfigured: false, available: false, data: null, generatedAt: null, lastCollection: null, error: null },
  ])
  const denied = await handleBoingApi(req('/api/boing/projects/project_b/sources'), env, user('member'))
  assert.equal(denied.status, 404)
  assert.doesNotMatch(await denied.text(), /secret/)
  assert.equal((await handleBoingApi(req('/api/boing/projects/project_private/sources'), env, user('member'))).status, 404)
  assert.deepEqual((await (await handleBoingApi(req('/api/boing/projects/project_a/snapshot'), env, user('member'))).json()).snapshot, { value: 'a' })
})

test('source reads fail closed on missing schema and corrupt results', async () => {
  const { env, sql } = setup()
  sql.exec("INSERT INTO boing_collection_results VALUES('project_a','github',1,'not-json','now')")
  assert.equal((await handleBoingApi(req('/api/boing/projects/project_a/sources'), env, user('owner'))).status, 503)
  sql.exec('DROP TABLE boing_collection_results')
  assert.equal((await handleBoingApi(req('/api/boing/projects/project_a/sources'), env, user('owner'))).status, 503)
  assert.equal((await handleBoingApi(req('/api/boing/projects/project_a/snapshot'), env, user('owner'))).status, 200)
})

test('provider unavailable is not presented as successful metrics or a provider error', async () => {
  const { env, sql } = setup()
  sql.exec(`INSERT INTO boing_collection_results VALUES
    ('project_a','website',1,'{"source":"PageSpeed Insights","status":"unavailable","reason":"secret-provider-detail","collectedAt":"2026-01-01"}','2026-01-01');`)
  const response = await handleBoingApi(req('/api/boing/projects/project_a/sources'), env, user('member'))
  const text = await response.text()
  const website = JSON.parse(text).sources.find(source => source.kind === 'website')
  assert.deepEqual(website, { kind: 'website', collectionConfigured: false, available: false, data: null, generatedAt: null, lastCollection: null, error: 'source_unavailable' })
  assert.doesNotMatch(text, /secret-provider-detail/)
})

test('source availability requires the collection tracking tables', async () => {
  const { env, sql } = setup()
  Object.assign(env, { BOING_COLLECTION_ENABLED: 'true', BOING_PAGESPEED_BUDGET_APPROVED: 'true', PAGESPEED_API_KEY: 'test', BOING_PAGESPEED_DAILY_CALL_LIMIT: '100', BOING_PAGESPEED_WORKSPACE_DAILY_CALL_LIMIT: '10' })
  const configured = async () => (await (await handleBoingApi(req('/api/boing/projects/project_a/sources'), env, user('owner'))).json()).sources.find(source => source.kind === 'website').collectionConfigured
  assert.equal(await configured(), false)
  sql.exec(readFileSync(new URL('./boing-provider-budget.sql', import.meta.url), 'utf8'))
  sql.exec(readFileSync(new URL('./boing-execution-fence-migration.sql', import.meta.url), 'utf8'))
  assert.equal(await configured(), true)
  sql.exec('DROP TABLE boing_collection_executions')
  assert.equal(await configured(), false)
})

test('source reads suppress stale revisions, missing revisions and disconnected sources', async () => {
  const { env, sql } = setup()
  sql.exec(`INSERT INTO boing_collection_results VALUES
    ('project_a','github',1,'{"secret":"old repository"}','old'),
    ('project_a','website',1,'{"secret":"old website"}','old');`)
  const read = async () => (await (await handleBoingApi(req('/api/boing/projects/project_a/sources'), env, user('owner'))).json()).sources
  assert.deepEqual((await read()).map(source => source.available), [true, true])
  sql.exec("UPDATE boing_source_versions SET revision=2 WHERE project_id='project_a' AND kind='github'; DELETE FROM boing_source_versions WHERE project_id='project_a' AND kind='website'")
  const after = await read()
  assert.deepEqual(after.map(source => source.available), [false, false])
  assert.doesNotMatch(JSON.stringify(after), /old repository|old website/)
  sql.exec("UPDATE boing_source_versions SET revision=1 WHERE project_id='project_a' AND kind='github'; INSERT INTO boing_source_versions VALUES('project_a','website',1); UPDATE boing_github_installations SET status='suspended'; UPDATE boing_projects SET website_url=NULL WHERE id='project_a'")
  assert.deepEqual((await read()).map(source => source.available), [false, false])
})

test('revoking a project grant before an update prevents the write', async () => {
  const { env, sql } = setup()
  const original = env.DB.prepare.bind(env.DB)
  env.DB.prepare = query => {
    const statement = original(query)
    if (!query.startsWith('UPDATE boing_presentations')) return statement
    return { bind(...args) {
      const bound = statement.bind(...args)
      return { ...bound, async run() {
        sql.exec("DELETE FROM boing_project_memberships WHERE project_id='project_a' AND user_id='admin'")
        return bound.run()
      } }
    } }
  }
  const response = await handleBoingApi(put('project_a', { revision: 0, presentation: { title: 'Changed' } }), env, user('admin'))
  assert.equal(response.status, 404)
  assert.equal(sql.prepare("SELECT revision FROM boing_presentations WHERE project_id='project_a'").get().revision, 0)
})

test('writes require same origin, owner role, valid content and current revision', async () => {
  const { env, sql } = setup()
  const body = { revision: 0, presentation: { title: 'Updated' } }
  assert.equal((await handleBoingApi(put('project_a', body, 'https://evil.example'), env, user('owner'))).status, 403)
  assert.equal((await handleBoingApi(put('project_b', body), env, user('owner'))).status, 404)
  assert.equal((await handleBoingApi(put('project_a', body), env, user('member'))).status, 403)
  assert.equal((await handleBoingApi(put('project_a', { revision: 0, presentation: { unknown: true } }), env, user('owner'))).status, 400)
  assert.equal((await handleBoingApi(put('project_a', { revision: 0, presentation: { notes: 'x'.repeat(130001) } }), env, user('owner'))).status, 413)
  let result = await handleBoingApi(put('project_a', body), env, user('owner'))
  assert.equal(result.status, 200)
  assert.equal((await result.json()).revision, 1)
  result = await handleBoingApi(put('project_a', body), env, user('owner'))
  assert.equal(result.status, 409)
  assert.equal((await result.json()).presentation.title, 'Updated')
  sql.exec("UPDATE boing_memberships SET status='suspended' WHERE user_id='owner'")
  assert.equal((await handleBoingApi(put('project_a', body), env, user('owner'))).status, 404)
})

test('unsupported methods and failures do not disclose internals', async () => {
  const { env, sql } = setup()
  const response = await handleBoingApi(req('/api/boing/projects', { method: 'DELETE' }), env, user('owner'))
  assert.equal(response.status, 405)
  assert.equal(response.headers.get('allow'), 'GET, POST')
  sql.exec("UPDATE boing_snapshots SET body='not-json' WHERE project_id='project_a'")
  const failure = await handleBoingApi(req('/api/boing/projects/project_a/snapshot'), env, user('owner'))
  assert.equal(failure.status, 503)
  assert.deepEqual(await failure.json(), { error: 'service_unavailable' })
})
