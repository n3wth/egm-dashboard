import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { BOING_IDENTITY_SCHEMA } from './boing-identity.mjs'
import { GITHUB_APP_SCHEMA } from './boing-github-app.mjs'
import { GITHUB_OAUTH_SCHEMA, handleGithubOAuth } from './boing-github-oauth.mjs'

const user = { id: 'user_Owner', verified: 1, status: 'active' }
function fixture() {
  const sql = new DatabaseSync(':memory:')
  sql.exec('PRAGMA foreign_keys=ON')
  sql.exec(BOING_IDENTITY_SCHEMA)
  sql.exec(readFileSync(new URL('./boing-tenancy-schema.sql', import.meta.url), 'utf8'))
  sql.exec(GITHUB_APP_SCHEMA)
  sql.exec(GITHUB_OAUTH_SCHEMA)
  sql.exec('CREATE TABLE boing_source_versions(project_id TEXT NOT NULL,kind TEXT NOT NULL,revision INTEGER NOT NULL,PRIMARY KEY(project_id,kind))')
  sql.exec(`INSERT INTO boing_identities VALUES('user_Owner','owner@example.com','active'),('user_Other','other@example.com','active');
    INSERT INTO boing_organizations VALUES('one','One','org_One','active',0,'now'),('two','Two','org_Two','active',0,'now');
    INSERT INTO boing_memberships VALUES('one','user_Owner','owner','active','now'),('two','user_Other','owner','active','now');
    INSERT INTO boing_projects VALUES('p1','one','One',NULL,NULL,'active','now'),('p2','two','Two',NULL,NULL,'active','now');`)
  let queue = Promise.resolve()
  const DB = { prepare(query) { return { bind(...args) { return {
    async first() { return sql.prepare(query).get(...args) ?? null },
    async run() { return { meta: { changes: Number(sql.prepare(query).run(...args).changes) } } }
  } } } }, batch(stmts) { const operation = queue.then(async () => { sql.exec('BEGIN'); try { const out = []; for (const stmt of stmts) out.push(await stmt.run()); sql.exec('COMMIT'); return out } catch (e) { sql.exec('ROLLBACK'); throw e } }); queue = operation.catch(() => {}); return operation } }
  const env = { DB, APP_URL: 'https://app.test', WORKOS_API_KEY: 'secret', GITHUB_APP_SLUG: 'boing-test', GITHUB_CLIENT_ID: 'client_123', GITHUB_CLIENT_SECRET: 's'.repeat(32), BOING_GITHUB_OAUTH_SECRET: 'k'.repeat(64), GITHUB_APP_ID: '55' }
  const workos = async url => { const q = new URL(url).searchParams; return Response.json({ object: 'list', data: [{ user_id: q.get('user_id'), organization_id: q.get('organization_id'), status: 'active' }], list_metadata: { after: null } }) }
  const github = async (url, options) => {
    assert.equal(options.redirect, 'manual')
    if (url === 'https://github.com/login/oauth/access_token') {
      assert.match(JSON.parse(options.body).code_verifier, /^[A-Za-z0-9_-]{43}$/)
      return Response.json({ access_token: 'ghu_testingtoken', expires_in: 3600 })
    }
    assert.equal(options.headers.authorization, 'Bearer ghu_testingtoken')
    if (new URL(url).pathname === '/user/installations') return Response.json({ installations: [{ id: 10, app_id: 55, account: { id: 9, login: 'org' } }] })
    return Response.json({ repositories: [{ id: 42, full_name: 'org/repo', private: true }] })
  }
  const call = (path, init = {}, org = 'one', actor = user, opts = {}) => {
    const headers = new Headers(init.headers)
    if (!headers.get('cookie')?.includes('__Host-boing_session=')) headers.set('cookie', `${headers.get('cookie') ?? ''}; __Host-boing_session=${'x'.repeat(43)}`)
    return handleGithubOAuth(new Request(`https://app.test${path}`, { ...init, headers }), env, actor, org, { now: 1000, requestWorkos: workos, requestGithub: github, ...opts })
  }
  return { sql, call, env }
}
const json = body => ({ method: 'POST', headers: { origin: 'https://app.test', 'content-type': 'application/json' }, body: JSON.stringify(body) })
test('membership-bound GitHub handoff and authorization admissions succeed with a current binding', async () => {
  const { sql, call, env } = fixture()
  env.BOING_MEMBERSHIP_BINDING_REQUIRED = 'true'
  sql.exec(`CREATE TABLE boing_workos_membership_bindings(organization_id TEXT,user_id TEXT,workos_membership_id TEXT,workos_updated_at TEXT);
    INSERT INTO boing_workos_membership_bindings VALUES('one','user_Owner','om_One','2026-01-01T00:00:00Z')`)
  const requestWorkos = async url => { const q = new URL(url).searchParams; return Response.json({ object: 'list', data: [{ id: 'om_One', updated_at: '2026-01-01T00:00:00Z', user_id: q.get('user_id'), organization_id: q.get('organization_id'), status: 'active' }], list_metadata: { after: null } }) }
  assert.equal((await call('/api/boing/github/install', json({ projectId: 'p1' }), 'one', user, { requestWorkos })).status, 200)
  assert.equal((await call('/api/boing/github/authorize', json({ projectId: 'p1', installationId: 10 }), 'one', user, { requestWorkos })).status, 200)
})
async function start(call) {
  const response = await call('/api/boing/github/authorize', json({ projectId: 'p1', installationId: 10 }))
  assert.equal(response.status, 200)
  const url = new URL((await response.json()).url)
  const state = url.searchParams.get('state')
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256')
  const flowCookie = response.headers.get('set-cookie').split(';')[0]
  return { state, flowCookie }
}
test('installation handoff preserves session and workspace through verified OAuth and selection', async () => {
  const { call, sql } = fixture()
  const start = await call('/api/boing/github/install', json({ projectId: 'p1' }))
  assert.equal(start.status, 200)
  const url = new URL((await start.json()).url)
  assert.equal(url.origin + url.pathname, 'https://github.com/apps/boing-test/installations/new')
  const state = url.searchParams.get('state')
  const installCookie = start.headers.get('set-cookie').split(';')[0]
  const setupPath = `/api/boing/github/setup?state=${state}&installation_id=10`
  assert.equal((await call(setupPath, { headers: { cookie: `${installCookie}; __Host-boing_session=${'y'.repeat(43)}` } })).status, 403)
  const setup = await call(setupPath, { headers: { cookie: installCookie } })
  assert.equal(setup.status, 303)
  assert.equal((await call(setupPath, { headers: { cookie: installCookie } })).status, 403)
  const oauth = new URL(setup.headers.get('location'))
  assert.equal(oauth.origin, 'https://github.com')
  const flowCookie = setup.headers.getSetCookie().find(value => value.startsWith('__Host-boing_github_flow=')).split(';')[0]
  const callback = await call(`/api/boing/github/callback?state=${oauth.searchParams.get('state')}&code=code123`, { headers: { cookie: flowCookie } })
  assert.equal(callback.status, 303)
  const selectionCookie = callback.headers.getSetCookie().find(value => value.startsWith('__Host-boing_github_selection=')).split(';')[0]
  const select = json({ repositoryId: 42 }); select.headers.cookie = selectionCookie
  assert.equal((await call('/api/boing/github/select', select)).status, 200)
  assert.equal(sql.prepare('SELECT repository_id FROM boing_github_repositories').get().repository_id, 42)
})

test('installation setup rejects forged IDs and expired or revoked handoffs', async () => {
  const { call, sql } = fixture()
  const start = await call('/api/boing/github/install', json({ projectId: 'p1' }))
  const state = new URL((await start.json()).url).searchParams.get('state')
  const installCookie = start.headers.get('set-cookie').split(';')[0]
  assert.equal((await call(`/api/boing/github/setup?state=${state}&installation_id=-1`, { headers: { cookie: installCookie } })).status, 400)
  assert.equal((await call(`/api/boing/github/setup?state=${state}&installation_id=10`, { headers: { cookie: installCookie } }, 'one', user, { now: 601001 })).status, 403)
  sql.exec("UPDATE boing_memberships SET status='suspended' WHERE organization_id='one'")
  assert.equal((await call(`/api/boing/github/setup?state=${state}&installation_id=10`, { headers: { cookie: installCookie } })).status, 403)
  assert.equal(sql.prepare('SELECT count(*) n FROM boing_github_installations').get().n, 0)
})

test('a spoofed setup installation is never bound without GitHub user verification', async () => {
  const { call, sql } = fixture()
  const start = await call('/api/boing/github/install', json({ projectId: 'p1' }))
  const state = new URL((await start.json()).url).searchParams.get('state')
  const installCookie = start.headers.get('set-cookie').split(';')[0]
  const setup = await call(`/api/boing/github/setup?state=${state}&installation_id=999`, { headers: { cookie: installCookie } })
  const oauthState = new URL(setup.headers.get('location')).searchParams.get('state')
  const flowCookie = setup.headers.getSetCookie().find(value => value.startsWith('__Host-boing_github_flow=')).split(';')[0]
  const callback = await call(`/api/boing/github/callback?state=${oauthState}&code=code123`, { headers: { cookie: flowCookie } })
  assert.equal(callback.status, 503)
  assert.equal(sql.prepare('SELECT count(*) AS n FROM boing_github_installations').get().n, 0)
})

test('concurrent installation handoffs are bounded per user and workspace', async () => {
  const { call, sql } = fixture()
  const results = await Promise.all(Array.from({ length: 8 }, () => call('/api/boing/github/install', json({ projectId: 'p1' }))))
  assert.equal(results.filter(result => result.status === 200).length, 3)
  assert.equal(results.filter(result => result.status === 429).length, 5)
  assert.equal(sql.prepare('SELECT count(*) AS n FROM boing_github_install_handoffs').get().n, 3)
})
test('authorization is PKCE and browser-bound, and selection uses only encrypted short-lived credentials', async () => {
  const { call, sql } = fixture(), { state, flowCookie } = await start(call)
  const callback = `/api/boing/github/callback?state=${state}&code=code123`
  assert.equal((await call(callback)).status, 400)
  const response = await call(callback, { headers: { cookie: flowCookie } })
  assert.equal(response.status, 303)
  const selectionCookie = response.headers.getSetCookie().find(value => value.startsWith('__Host-boing_github_selection=')).split(';')[0]
  assert.ok(!selectionCookie.includes('ghu_testingtoken'))
  assert.equal((await call('/api/boing/github/repositories', { headers: { cookie: `${selectionCookie}; __Host-boing_session=${'y'.repeat(43)}` } })).status, 403)
  assert.equal((await call(callback, { headers: { cookie: flowCookie } })).status, 403)
  const listing = await call('/api/boing/github/repositories', { headers: { cookie: selectionCookie } })
  assert.deepEqual((await listing.json()).repositories, [{ id: 42, fullName: 'org/repo', private: true }])
  assert.equal((await call('/api/boing/github/repositories', { headers: { cookie: selectionCookie } }, 'two')).status, 403)
  const select = json({ repositoryId: 42 }); select.headers.cookie = selectionCookie
  assert.equal((await call('/api/boing/github/select', select)).status, 200)
  assert.equal(sql.prepare('SELECT repository_id FROM boing_github_repositories').get().repository_id, 42)
})
test('rejects cross-tenant access, altered state, redirects, and expired authorization', async () => {
  const { call } = fixture()
  assert.equal((await call('/api/boing/github/authorize', json({ projectId: 'p2', installationId: 10 }))).status, 403)
  assert.equal((await call('/api/boing/github/authorize', { ...json({ projectId: 'p1', installationId: 10 }), headers: { origin: 'https://evil.test', 'content-type': 'application/json' } })).status, 403)
  const { state, flowCookie } = await start(call)
  assert.equal((await call(`/api/boing/github/callback?state=${state}&code=x`, { headers: { cookie: flowCookie } }, 'one', user, { now: 601001 })).status, 403)
  const second = await start(call)
  const response = await call(`/api/boing/github/callback?state=${second.state}&code=x`, { headers: { cookie: second.flowCookie } }, 'one', user, { requestGithub: async () => new Response(null, { status: 302, headers: { location: 'https://evil.test/' } }) })
  assert.equal(response.status, 502)
})

test('callback cannot cross sessions and provider revocation blocks installation', async () => {
  const { call, sql } = fixture(), { state, flowCookie } = await start(call)
  const callback = `/api/boing/github/callback?state=${state}&code=code123`
  assert.equal((await call(callback, { headers: { cookie: `${flowCookie}; __Host-boing_session=${'y'.repeat(43)}` } })).status, 403)
  let checks = 0
  const revoked = async url => {
    const q = new URL(url).searchParams
    return Response.json({ object: 'list', data: [{ user_id: q.get('user_id'), organization_id: q.get('organization_id'), status: ++checks >= 2 ? 'inactive' : 'active' }], list_metadata: { after: null } })
  }
  assert.equal((await call(callback, { headers: { cookie: flowCookie } }, 'one', user, { requestWorkos: revoked })).status, 503)
  assert.equal(sql.prepare('SELECT count(*) n FROM boing_github_installations').get().n, 0)
})

test('revoked provider membership prevents repository binding during a GitHub read', async () => {
  const { call, sql } = fixture(), { state, flowCookie } = await start(call)
  const callback = await call(`/api/boing/github/callback?state=${state}&code=code123`, { headers: { cookie: flowCookie } })
  const selection = callback.headers.getSetCookie().find(value => value.startsWith('__Host-boing_github_selection=')).split(';')[0]
  let checks = 0
  const revoked = async url => {
    const q = new URL(url).searchParams
    return Response.json({ object: 'list', data: [{ user_id: q.get('user_id'), organization_id: q.get('organization_id'), status: ++checks >= 2 ? 'inactive' : 'active' }], list_metadata: { after: null } })
  }
  const request = json({ repositoryId: 42 }); request.headers.cookie = selection
  assert.equal((await call('/api/boing/github/select', request, 'one', user, { requestWorkos: revoked })).status, 503)
  assert.equal(sql.prepare('SELECT count(*) n FROM boing_github_repositories').get().n, 0)
})

test('concurrent admission is bounded per member and leaves no orphan installation state', async () => {
  const { call, sql } = fixture()
  const responses = await Promise.all(Array.from({ length: 12 }, () => call('/api/boing/github/authorize', json({ projectId: 'p1', installationId: 10 }))))
  assert.equal(responses.filter(response => response.status === 200).length, 3)
  assert.equal(responses.filter(response => response.status === 429).length, 9)
  assert.equal(sql.prepare('SELECT count(*) n FROM boing_github_oauth_flows').get().n, 3)
  assert.equal(sql.prepare('SELECT count(*) n FROM boing_github_install_states').get().n, 3)
  assert.equal((await call('/api/boing/github/authorize', json({ projectId: 'p2', installationId: 10 }), 'two', { id: 'user_Other', verified: 1, status: 'active' })).status, 200)
})
