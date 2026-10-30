import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { handleBoingWorkspaceExport } from './boing-workspace-export.mjs'
import { GITHUB_APP_SCHEMA } from './boing-github-app.mjs'
import { JOBS_SCHEMA } from './boing-jobs.mjs'

function setup() {
  const sql = new DatabaseSync(':memory:')
  sql.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'))
  sql.exec(readFileSync(new URL('./boing-tenancy-schema.sql', import.meta.url), 'utf8'))
  sql.exec(`INSERT INTO boing_identities VALUES('user_1','test@example.invalid','active');
    INSERT INTO boing_organizations VALUES('a','A','org_A','active',0,'now'),('b','B','org_B','active',0,'now');
    INSERT INTO boing_memberships VALUES('a','user_1','owner','active','now'),('b','user_1','owner','active','now');
    INSERT INTO boing_projects VALUES('p1','a','One',NULL,NULL,'active','now'),('p2','a','Old',NULL,NULL,'archived','now'),('secret','b','Other',NULL,NULL,'active','now');`)
  const DB = { prepare(query) { return { bind(...args) { return { async all() { return { results: sql.prepare(query).all(...args) } } } } } } }
  const context = { status: 'allowed', role: 'owner', userId: 'user_1', organizationId: 'a', membershipId: 'om_1', membershipUpdatedAt: 'v1' }
  const options = { resolve: async () => context,
    authorize: async (_env, _user, _org, id) => ({ status: 'allowed', proof: { projectId: id } }),
    recheck: async () => true,
    exportProject: async request => Response.json({ project: { id: new URL(request.url).pathname.split('/')[4] }, snapshot: null }),
    history: async () => ({ status: 'allowed', history: [{ kind: 'website', day: '2026-01-01', metrics: {} }] }) }
  return { sql, env: { DB }, user: { id: 'user_1', status: 'active', verified: 1 }, context, options }
}
const req = () => new Request('https://app.test/api/boing/workspace/export')
const run = (s, options = s.options) => handleBoingWorkspaceExport(req(), s.env, s.user, 'a', options)

test('exports authorized active projects with bounded history and explicit omissions', async () => {
  const s = setup(), response = await run(s)
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('cache-control'), 'private, no-store')
  const result = await response.json()
  assert.equal(result.scope, 'partial_workspace_export')
  assert.deepEqual(result.projects.map(p => p.project.id), ['p1'])
  assert.equal(result.projects[0].history.length, 1)
  assert.equal(result.omissions.archivedProjects, 1)
  assert.doesNotMatch(JSON.stringify(result), /secret/)
})

test('denies nonowners, provider denial, membership changes and source changes without disclosing data', async () => {
  const s = setup()
  assert.equal((await run(s, { ...s.options, resolve: async () => ({ ...s.context, role: 'admin' }) })).status, 404)
  assert.equal((await run(s, { ...s.options, authorize: async () => ({ status: 'denied' }) })).status, 403)
  assert.equal((await run(s, { ...s.options, authorize: async () => ({ status: 'unavailable' }) })).status, 503)
  assert.equal((await run(s, { ...s.options, recheck: async () => false })).status, 403)
  let resolves = 0
  assert.equal((await run(s, { ...s.options, resolve: async () => ++resolves === 1 ? s.context : { ...s.context, membershipUpdatedAt: 'v2' } })).status, 403)
  assert.equal((await run(s, { ...s.options, history: async () => ({ status: 'denied' }) })).status, 403)
})

test('rejects oversized exports and changes to the project set', async () => {
  const s = setup()
  assert.equal((await run(s, { ...s.options, exportProject: async () => Response.json({ data: 'x'.repeat(1024 * 1024) }) })).status, 413)
  assert.equal((await run(s, { ...s.options, recheck: async () => { s.sql.exec("UPDATE boing_projects SET status='archived' WHERE id='p1'"); return true } })).status, 403)
  s.sql.exec("UPDATE boing_projects SET status='active' WHERE id='p1'")
  for (let n = 0; n < 9; n++) s.sql.prepare('INSERT INTO boing_projects VALUES(?,?,?,?,?,?,?)').run(`more${n}`, 'a', 'Extra', null, null, 'active', 'now')
  assert.equal((await run(s)).status, 413)
})

test('denies data if provider access is revoked or source proof changes after reading', async () => {
  const s = setup()
  let calls = 0
  const revoked = await run(s, { ...s.options, authorize: async (_env, _user, _org, id) =>
    ++calls === 1 ? { status: 'allowed', proof: { projectId: id, revision: 1 } } : { status: 'denied' } })
  assert.equal(revoked.status, 403)
  assert.doesNotMatch(await revoked.text(), /p1/)
  calls = 0
  const changed = await run(s, { ...s.options, authorize: async (_env, _user, _org, id) =>
    ({ status: 'allowed', proof: { projectId: id, revision: ++calls } }) })
  assert.equal(changed.status, 403)
})

test('real guards export unbound projects and reject legacy snapshots and cross-tenant data', async () => {
  const s = setup()
  s.sql.exec(GITHUB_APP_SCHEMA)
  s.sql.exec(JOBS_SCHEMA)
  s.sql.exec(readFileSync(new URL('./boing-metric-history-migration.sql', import.meta.url), 'utf8'))
  s.env.DB = { prepare(query) { return { bind(...args) { return {
    async first() { return s.sql.prepare(query).get(...args) ?? null },
    async all() { return { results: s.sql.prepare(query).all(...args) } }
  } } } } }
  s.env.WORKOS_API_KEY = 'test'
  const requestWorkos = async url => Response.json({ object: 'list', data: [{ user_id: 'user_1', organization_id: new URL(url).searchParams.get('organization_id'), status: 'active' }], list_metadata: { after: null } })
  const response = await run(s, { requestWorkos })
  assert.equal(response.status, 200)
  assert.deepEqual((await response.json()).projects.map(project => project.project.id), ['p1'])
  s.sql.exec("INSERT INTO boing_snapshots VALUES('p1','{\"private\":true}','now')")
  const denied = await run(s, { requestWorkos })
  assert.equal(denied.status, 403)
  assert.doesNotMatch(await denied.text(), /private/)
})
