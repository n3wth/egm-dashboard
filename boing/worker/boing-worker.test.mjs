import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { createBoingWorker } from './boing-worker.mjs'
import { BOING_AUTH_SCHEMA, handleBoingAuth } from './boing-auth.mjs'
import { resolveBoingContext } from './boing-context.mjs'

const user = { id: 'user_123', status: 'active', verified: 1 }
const token = 'a'.repeat(43)
const env = { APP_URL: 'https://app.test' }
const req = (path, headers = {}) => {
  const request = new Request(`https://app.test${path}`, { headers: { 'cf-connecting-ip': '192.0.2.1', ...headers } })
  Object.defineProperty(request, 'cf', { value: { colo: 'SJC' } })
  return request
}
const cookie = `__Host-boing_session=${token}`

test('scheduled events delegate to the bounded collector', async () => {
  let called = 0
  const worker = createBoingWorker({ collectionTick: async input => { assert.equal(input, env); called++ } })
  await worker.scheduled({}, env)
  assert.equal(called, 1)
})

test('worker passes its execution context to authenticated routes', async () => {
  let forwarded = false
  const executionContext = { waitUntil(promise) { forwarded = promise instanceof Promise } }
  const worker = createBoingWorker({
    authenticate: async () => ({ status: 'active', user }),
    route: async (_request, _env, _user, _selector, options) => {
      options.waitUntil(Promise.resolve())
      return new Response(null, { status: 202 })
    },
  })
  const request = new Request('https://app.test/api/boing/projects/p/collect', {
    method: 'POST', headers: { cookie, origin: 'https://app.test', 'x-boing-organization': 'org-a' },
  })
  assert.equal((await worker.fetch(request, env, executionContext)).status, 202)
  assert.equal(forwarded, true)
})

test('platform provisioning is authenticated and disabled without staging gates', async () => {
  const worker = createBoingWorker({ authenticate: async () => ({ status: 'active', user }) })
  const request = headers => new Request('https://app.test/api/boing/platform/workspaces', { method: 'POST', headers: { origin: 'https://app.test', ...headers } })
  assert.equal((await worker.fetch(request({}), env)).status, 401)
  assert.equal((await worker.fetch(request({ cookie }), env)).status, 503)
})

test('GitHub webhook is dispatched without a user session and fails closed without configuration', async () => {
  const worker = createBoingWorker()
  const request = new Request('https://app.test/webhooks/github', { method: 'POST' })
  assert.equal((await worker.fetch(request, env)).status, 503)
  assert.equal((await worker.fetch(req('/webhooks/github'), env)).status, 405)
})

test('GitHub setup and callback use session-bound server state without an organization header', async () => {
  let calls = 0
  const worker = createBoingWorker({ authenticate: async () => ({ status: 'active', user }), githubOAuth: async (_req, _env, identity, selector) => {
    calls++
    assert.equal(identity.id, user.id)
    assert.equal(selector, null)
    return new Response(null, { status: 204 })
  } })
  assert.equal((await worker.fetch(req('/api/boing/github/callback'), env)).status, 401)
  assert.equal((await worker.fetch(req('/api/boing/github/callback', { cookie }), env)).status, 204)
  assert.equal((await worker.fetch(req('/api/boing/github/setup', { cookie }), env)).status, 204)
  assert.equal((await worker.fetch(req('/api/boing/github/repositories', { cookie }), env)).status, 400)
  assert.equal(calls, 2)
})

test('routes only a verified Boing session and passes organization as a selector', async () => {
  let calls = 0
  const worker = createBoingWorker({
    authenticate: async (_env, input) => { assert.equal(input, token); return { status: 'active', user } },
    route: async (_request, _env, identity, selector) => { calls++; assert.equal(identity.id, user.id); assert.equal(selector, 'org-a'); return Response.json({ ok: true }) }
  })
  const response = await worker.fetch(req('/api/boing/projects', { cookie, 'x-boing-organization': 'org-a' }), env)
  assert.equal(response.status, 200)
  assert.equal(calls, 1)
})

test('account details require a verified session and do not require an organization selector', async () => {
  const worker = createBoingWorker({ authenticate: async () => ({ status: 'active', user: { ...user, email: 'owner@example.com' } }) })
  assert.equal((await worker.fetch(req('/api/boing/account'), env)).status, 401)
  const response = await worker.fetch(req('/api/boing/account', { cookie }), env)
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { email: 'owner@example.com' })
  assert.equal(response.headers.get('cache-control'), 'private, no-store')
  assert.equal((await worker.fetch(req('/account.html'), env)).status, 302)
})

test('rejects missing, malformed, duplicate and legacy EGM cookies', async () => {
  let calls = 0
  const worker = createBoingWorker({ authenticate: async () => { calls++; return { status: 'active', user } } })
  const headers = { 'x-boing-organization': 'org-a' }
  for (const value of ['', '__Host-boing_session=forged', `${cookie}; ${cookie}`, `__Host-egm_session=${token}`]) {
    assert.equal((await worker.fetch(req('/api/boing/projects', { ...headers, cookie: value }), env)).status, 401)
  }
  assert.equal(calls, 0)
})

test('rejects a forged session using the actual identity store', async () => {
  const noSessionDb = { prepare() { return { bind() { return { async first() { return null } } } } } }
  const configured = { ...env, DB: noSessionDb, WORKOS_API_KEY: 'test', WORKOS_CLIENT_ID: 'client_123', WORKOS_RBAC_ISSUER: 'https://issuer.test' }
  const response = await createBoingWorker().fetch(req('/api/boing/projects', { cookie, 'x-boing-organization': 'org-a' }), configured)
  assert.equal(response.status, 401)
})

test('fails closed for revoked sessions, provider errors, missing selector and wrong origin', async () => {
  const request = req('/api/boing/projects', { cookie, 'x-boing-organization': 'org-a' })
  assert.equal((await createBoingWorker().fetch(request, env)).status, 503)
  assert.equal((await createBoingWorker({ authenticate: async () => ({ status: 'denied' }) }).fetch(request, env)).status, 401)
  const worker = createBoingWorker({ authenticate: async () => ({ status: 'active', user }) })
  assert.equal((await worker.fetch(req('/api/boing/projects', { cookie }), env)).status, 400)
  assert.equal((await worker.fetch(req('/api/boing/projects', { cookie, origin: 'https://evil.test' }), env)).status, 403)
})

test('never serves legacy routes, including authenticated requests', async () => {
  let calls = 0
  const worker = createBoingWorker({ authenticate: async () => ({ status: 'active', user }), route: async () => { calls++; return new Response() } })
  for (const path of ['/api/snapshot', '/api/presentation', '/auth/login', '/app.test.mjs', '/README.md']) {
    assert.equal((await worker.fetch(req(path, { cookie, 'x-boing-organization': 'org-a' }), env)).status, 404)
  }
  assert.equal(calls, 0)
})

test('serves only allowlisted app assets after verifying a Boing session', async () => {
  let calls = 0
  const ASSETS = { async fetch(request) {
    calls++
    assert.equal(request.headers.get('cookie'), null)
    assert.equal(request.headers.get('x-boing-organization'), null)
    assert.ok(['/index.html', '/style.css', '/app.mjs', '/api.mjs', '/logo/boing-approved.png'].includes(new URL(request.url).pathname))
    return new Response(request.method === 'HEAD' ? null : 'asset', { headers: { 'content-type': 'text/plain', 'cache-control': 'public, max-age=3600' } })
  } }
  const worker = createBoingWorker({ authenticate: async () => ({ status: 'active', user }) })
  const anonymous = await worker.fetch(req('/'), { ...env, ASSETS })
  assert.equal(anonymous.status, 302)
  assert.equal(anonymous.headers.get('location'), 'https://app.test/auth/boing/login')
  assert.equal((await worker.fetch(req('/app.mjs'), { ...env, ASSETS })).status, 401)
  assert.equal(calls, 0)
  for (const path of ['/', '/index.html', '/style.css', '/app.mjs', '/api.mjs', '/logo/boing-approved.png']) {
    const response = await worker.fetch(req(path, { cookie, 'x-boing-organization': 'org-a' }), { ...env, ASSETS })
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('cache-control'), 'private, no-store')
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
    assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/)
  }
  assert.equal(calls, 6)
  assert.equal((await worker.fetch(req('/app.test.mjs', { cookie }), { ...env, ASSETS })).status, 404)
  assert.equal((await worker.fetch(req('/README.md', { cookie }), { ...env, ASSETS })).status, 404)
  assert.equal((await worker.fetch(new Request('https://app.test/', { method: 'POST', headers: { cookie } }), { ...env, ASSETS })).status, 405)
  assert.equal((await worker.fetch(req('/', { cookie }), env)).status, 503)
  assert.equal((await createBoingWorker({ authenticate: async () => ({ status: 'denied' }) }).fetch(req('/', { cookie }), { ...env, ASSETS })).status, 302)
  assert.equal((await createBoingWorker({ authenticate: async () => ({ status: 'unavailable' }) }).fetch(req('/', { cookie }), { ...env, ASSETS })).status, 503)
  assert.equal((await createBoingWorker({ authenticate: async () => ({ status: 'denied' }) }).fetch(req('/app.mjs', { cookie }), { ...env, ASSETS })).status, 401)
  assert.equal(calls, 6)
})

test('sign out revokes the local session before redirecting to WorkOS', async () => {
  const sql = new DatabaseSync(':memory:')
  sql.exec(`CREATE TABLE boing_sessions(token_hash TEXT PRIMARY KEY, revoked_at INTEGER, workos_session_id TEXT);
    CREATE TABLE sessions(id TEXT PRIMARY KEY); INSERT INTO sessions VALUES('legacy');`)
  const tokenHash = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))).toString('base64url')
  sql.prepare('INSERT INTO boing_sessions(token_hash, workos_session_id) VALUES(?,?)').run(tokenHash, 'session_123')
  const DB = { prepare(query) { return { bind(...args) { return { async first() { return sql.prepare(query).get(...args) ?? null } } } } } }
  const worker = createBoingWorker()
  const post = headers => new Request('https://app.test/auth/logout', { method: 'POST', headers })
  for (const origin of [undefined, 'https://evil.test']) {
    const headers = { cookie }
    if (origin) headers.origin = origin
    assert.equal((await worker.fetch(post(headers), { ...env, DB })).status, 403)
  }
  assert.equal(sql.prepare('SELECT revoked_at FROM boing_sessions').get().revoked_at, null)
  assert.equal((await worker.fetch(post({ cookie: `${cookie}; ${cookie}`, origin: env.APP_URL }), { ...env, DB })).status, 400)
  assert.equal((await worker.fetch(req('/auth/logout', { cookie, origin: env.APP_URL }), { ...env, DB })).status, 405)
  const response = await worker.fetch(post({ cookie, origin: env.APP_URL }), { ...env, DB })
  assert.equal(response.status, 303)
  assert.equal(response.headers.get('location'), 'https://api.workos.com/user_management/sessions/logout?session_id=session_123')
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer')
  assert.match(response.headers.get('set-cookie'), /^__Host-boing_session=; Path=\/; Secure; HttpOnly; SameSite=Lax; Max-Age=0$/)
  assert.equal(response.headers.get('cache-control'), 'private, no-store')
  assert.ok(sql.prepare('SELECT revoked_at FROM boing_sessions').get().revoked_at > 0)
  assert.equal(sql.prepare('SELECT count(*) AS n FROM sessions').get().n, 1)
  assert.equal((await worker.fetch(post({ cookie, origin: env.APP_URL }), { ...env, DB })).status, 200)
  assert.equal((await worker.fetch(post({ cookie, origin: env.APP_URL }), { ...env, DB: { prepare() { throw Error('down') } } })).status, 503)
})

test('routes real Boing login and callback through the isolated auth flow', async () => {
  const db = new DatabaseSync(':memory:')
  db.exec(BOING_AUTH_SCHEMA)
  const DB = { prepare(query) { return { bind(...args) { return {
    async first() { return db.prepare(query).get(...args) ?? null },
    async run() { return { meta: { changes: Number(db.prepare(query).run(...args).changes) } } }
  } } } } }
  const now = Date.now()
  const authEnv = { ...env, DB, WORKOS_CLIENT_ID: 'client_123', WORKOS_API_KEY: 'test', BOING_AUTH_SECRET: 's'.repeat(64) }
  let exchanges = 0
  const auth = (request, bindings) => handleBoingAuth(request, bindings, {
    now, requestWorkos: async () => { exchanges++; return Response.json({ user: { id: user.id, email_verified: true }, access_token: 'test-token' }) },
    createSession: async () => ({ status: 'created', token, expiresAt: Math.floor(now / 1000) + 1800 })
  })
  const worker = createBoingWorker({ auth })
  const start = await worker.fetch(req('/auth/boing/login'), authEnv)
  assert.equal(start.status, 302)
  const state = new URL(start.headers.get('location')).searchParams.get('state')
  const response = await worker.fetch(req(`/auth/boing/callback?state=${encodeURIComponent(state)}&code=example`, { cookie: `__Host-boing_flow=${state}` }), authEnv)
  assert.equal(response.status, 302)
  assert.ok(response.headers.getSetCookie().some(value => value.startsWith('__Host-boing_session=')))
  assert.equal(exchanges, 1)
  const replay = await worker.fetch(req(`/auth/boing/callback?state=${encodeURIComponent(state)}&code=example`, { cookie: `__Host-boing_flow=${state}` }), authEnv)
  assert.equal(replay.status, 400)
  assert.equal(exchanges, 1)
  assert.equal((await worker.fetch(new Request('https://evil.test/auth/boing/login'), authEnv)).status, 404)
})

test('organization discovery verifies each WorkOS membership and fails closed on outage', async () => {
  const sql = new DatabaseSync(':memory:')
  sql.exec(readFileSync(new URL('./boing-tenancy-schema.sql', import.meta.url), 'utf8'))
  sql.exec(`INSERT INTO boing_identities VALUES('user_123','test@example.com','active');
    INSERT INTO boing_organizations VALUES('a','Allowed','org_A','active',0,'now'),('b','Revoked','org_B','active',0,'now');
    INSERT INTO boing_memberships VALUES('a','user_123','owner','active','now'),('b','user_123','member','active','now');`)
  const DB = { prepare(query) { return { bind(...args) { return {
    async first() { return sql.prepare(query).get(...args) ?? null },
    async all() { return { results: sql.prepare(query).all(...args) } }
  } } } } }
  const testEnv = { ...env, DB, WORKOS_API_KEY: 'test' }
  let unavailable = false
  const provider = async value => {
    const org = new URL(value).searchParams.get('organization_id')
    if (org === 'org_B' && unavailable) throw Error('offline')
    return Response.json({ object: 'list', data: [{ user_id: user.id, organization_id: org, status: org === 'org_A' ? 'active' : 'inactive' }], list_metadata: { after: null } })
  }
  const worker = createBoingWorker({ authenticate: async () => ({ status: 'active', user }), resolveContext: (bindings, identity, id) => resolveBoingContext(bindings, identity, id, provider) })
  const response = await worker.fetch(req('/api/boing/organizations', { cookie }), testEnv)
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { organizations: [{ id: 'a', name: 'Allowed', role: 'owner' }], truncated: false })
  unavailable = true
  const failure = await worker.fetch(req('/api/boing/organizations', { cookie }), testEnv)
  assert.equal(failure.status, 503)
  assert.equal((await failure.text()).includes('Allowed'), false)
})

test('organization discovery bounds the number of provider checks', async () => {
  const sql = new DatabaseSync(':memory:')
  sql.exec(readFileSync(new URL('./boing-tenancy-schema.sql', import.meta.url), 'utf8'))
  sql.exec("INSERT INTO boing_identities VALUES('user_123','test@example.com','active')")
  for (let i = 0; i < 25; i++) {
    const id = String(i).padStart(2, '0')
    sql.prepare('INSERT INTO boing_organizations VALUES(?,?,?,?,?,?)').run(id, id, `org_${id}`, 'active', 0, 'now')
    sql.prepare('INSERT INTO boing_memberships VALUES(?,?,?,?,?)').run(id, user.id, 'member', 'active', 'now')
  }
  const DB = { prepare(query) { return { bind(...args) { return { async all() { return { results: sql.prepare(query).all(...args) } } } } } } }
  let count = 0
  const worker = createBoingWorker({ authenticate: async () => ({ status: 'active', user }), resolveContext: async () => { count++; return { status: 'allowed', role: 'member' } } })
  const response = await worker.fetch(req('/api/boing/organizations', { cookie }), { ...env, DB })
  const result = await response.json()
  assert.equal(result.organizations.length, 20)
  assert.equal(result.truncated, true)
  assert.equal(count, 20)
})

test('tenant hosts select only a mapped organization and verify membership on every request', async () => {
  const sql = new DatabaseSync(':memory:')
  sql.exec(readFileSync(new URL('./boing-tenancy-schema.sql', import.meta.url), 'utf8'))
  sql.exec(`INSERT INTO boing_organizations VALUES('a','Acme','org_A','active',0,'now'),('b','Other','org_B','active',0,'now');
    INSERT INTO boing_organization_subdomains VALUES('acme','a','now'),('other','b','now');`)
  const DB = { prepare(query) { return { bind(...args) { return {
    async first() { return sql.prepare(query).get(...args) ?? null }
  } } } } }
  const configured = { APP_URL: 'https://app.boing.test', BOING_TENANT_BASE_URL: 'https://boing.test', DB }
  let allowed = true, checks = 0, routes = 0
  const worker = createBoingWorker({
    authenticate: async () => ({ status: 'active', user }),
    resolveContext: async (_env, identity, id) => {
      checks++
      return allowed && id === 'a' ? { status: 'allowed', organizationId: id, userId: identity.id, role: 'member' } : { status: 'denied' }
    },
    route: async (_request, bindings, _user, id) => {
      routes++
      assert.equal(bindings.APP_URL, 'https://acme.boing.test')
      assert.equal(id, 'a')
      return Response.json({ ok: true })
    }
  })
  const request = (host, path, headers = {}) => new Request(`https://${host}${path}`, { headers: { cookie, ...headers } })
  const response = await worker.fetch(request('acme.boing.test', '/api/boing/projects'), configured)
  assert.equal(response.status, 200)
  assert.equal(checks, 2)
  assert.equal(routes, 1)
  const orgs = await worker.fetch(request('acme.boing.test', '/api/boing/organizations'), configured)
  assert.deepEqual(await orgs.json(), { organizations: [{ id: 'a', name: 'Acme', role: 'member' }], truncated: false })
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const mutation = new Request('https://acme.boing.test/api/boing/projects', { method, headers: { cookie, origin: 'https://acme.boing.test' } })
    const blocked = await worker.fetch(mutation, configured)
    assert.equal(blocked.status, 403)
    assert.equal((await blocked.json()).error, 'tenant_writes_unavailable')
  }
  assert.equal((await worker.fetch(request('acme.boing.test', '/api/boing/projects', { 'x-boing-organization': 'b' }), configured)).status, 403)
  assert.equal(routes, 1)
  allowed = false
  assert.equal((await worker.fetch(request('acme.boing.test', '/api/boing/projects'), configured)).status, 403)
  allowed = true
  for (const host of ['unknown.boing.test', 'app2.acme.boing.test', 'www.boing.test', 'acme.boing.test.evil.test']) {
    assert.equal((await worker.fetch(request(host, '/api/boing/projects'), configured)).status, 404)
  }
  assert.equal((await worker.fetch(request('acme.boing.test', '/api/boing/projects', { origin: 'https://other.boing.test' }), configured)).status, 403)
  assert.equal((await worker.fetch(request('acme.boing.test', '/api/boing/projects'), { ...configured, BOING_TENANT_BASE_URL: undefined })).status, 404)
  sql.close()
})

test('tenant base may be the primary app host without treating it as a tenant', async () => {
  const sql = new DatabaseSync(':memory:')
  sql.exec(readFileSync(new URL('./boing-tenancy-schema.sql', import.meta.url), 'utf8'))
  sql.exec("INSERT INTO boing_organizations VALUES('a','Acme','org_A','active',0,'now'); INSERT INTO boing_organization_subdomains VALUES('acme','a','now');")
  const DB = { prepare(query) { return { bind(...args) { return { async first() { return sql.prepare(query).get(...args) ?? null } } } } } }
  const configured = { APP_URL: 'https://staging.boing.test', BOING_TENANT_BASE_URL: 'https://staging.boing.test', DB }
  const worker = createBoingWorker({
    authenticate: async () => ({ status: 'active', user }),
    resolveContext: async (_env, identity, id) => ({ status: 'allowed', organizationId: id, userId: identity.id, role: 'owner' }),
    route: async (_request, env, _user, selector) => Response.json({ origin: env.APP_URL, selector })
  })
  const get = (host, headers = {}) => new Request(`https://${host}/api/boing/projects`, { headers: { cookie, ...headers } })
  const tenant = await worker.fetch(get('acme.staging.boing.test'), configured)
  assert.equal(tenant.status, 200)
  assert.deepEqual(await tenant.json(), { origin: 'https://acme.staging.boing.test', selector: 'a' })
  const app = await worker.fetch(get('staging.boing.test', { 'x-boing-organization': 'a' }), configured)
  assert.equal(app.status, 200)
  assert.deepEqual(await app.json(), { origin: 'https://staging.boing.test', selector: 'a' })
  assert.equal((await worker.fetch(get('other.acme.staging.boing.test'), configured)).status, 404)
  assert.equal((await worker.fetch(get('acme.staging.boing.test.evil.test'), configured)).status, 404)
  assert.equal((await worker.fetch(get('acme.staging.boing.test', { 'x-boing-organization': 'b' }), configured)).status, 403)
  const write = new Request('https://acme.staging.boing.test/api/boing/projects', { method: 'POST', headers: { cookie, origin: 'https://acme.staging.boing.test' } })
  assert.equal((await worker.fetch(write, configured)).status, 403)
  sql.close()
})

test('tenant host fails closed when the mapping changes during verification', async () => {
  let reads = 0
  const DB = { prepare() { return { bind() { return { async first() {
    reads++
    return reads === 1 ? { id: 'a', name: 'Acme' } : { id: 'b', name: 'Other' }
  } } } } } }
  let routes = 0
  const worker = createBoingWorker({
    authenticate: async () => ({ status: 'active', user }),
    resolveContext: async () => ({ status: 'allowed', organizationId: 'a', userId: user.id, role: 'owner' }),
    route: async () => { routes++; return new Response('unexpected') }
  })
  const response = await worker.fetch(new Request('https://acme.boing.test/api/boing/projects', { headers: { cookie } }), {
    APP_URL: 'https://app.boing.test', BOING_TENANT_BASE_URL: 'https://boing.test', DB
  })
  assert.equal(response.status, 403)
  assert.equal(routes, 0)
})

test('tenant login uses a host-specific callback and cannot replay its flow on another host', async () => {
  const sql = new DatabaseSync(':memory:')
  sql.exec(readFileSync(new URL('./boing-tenancy-schema.sql', import.meta.url), 'utf8'))
  sql.exec(BOING_AUTH_SCHEMA)
  sql.exec(`INSERT INTO boing_organizations VALUES('a','Acme','org_A','active',0,'now'),('b','Other','org_B','active',0,'now');
    INSERT INTO boing_organization_subdomains VALUES('acme','a','now'),('other','b','now');`)
  const DB = { prepare(query) { return { bind(...args) { return {
    async first() { return sql.prepare(query).get(...args) ?? null },
    async run() { return { meta: { changes: Number(sql.prepare(query).run(...args).changes) } } }
  } } } } }
  const configured = { APP_URL: 'https://app.boing.test', BOING_TENANT_BASE_URL: 'https://boing.test', DB,
    WORKOS_CLIENT_ID: 'client_123', WORKOS_API_KEY: 'test', BOING_AUTH_SECRET: 's'.repeat(64) }
  const auth = (request, bindings) => handleBoingAuth(request, bindings, {
    requestWorkos: async () => Response.json({ user: { id: user.id, email_verified: true }, access_token: 'test-token' }),
    createSession: async () => ({ status: 'created', token, expiresAt: Math.floor(Date.now() / 1000) + 1800 })
  })
  const worker = createBoingWorker({ auth })
  const tenantLogin = new Request('https://acme.boing.test/auth/boing/login', { headers: { 'cf-connecting-ip': '192.0.2.1' } })
  Object.defineProperty(tenantLogin, 'cf', { value: { colo: 'SJC' } })
  const start = await worker.fetch(tenantLogin, configured)
  assert.equal(start.status, 302)
  const authorization = new URL(start.headers.get('location'))
  assert.equal(authorization.searchParams.get('redirect_uri'), 'https://acme.boing.test/auth/boing/callback')
  const state = authorization.searchParams.get('state')
  // Even if a flow cookie is replayed manually, state is bound to its origin.
  const other = await worker.fetch(new Request(`https://other.boing.test/auth/boing/callback?state=${encodeURIComponent(state)}&code=example`, {
    headers: { cookie: `__Host-boing_flow=${state}` }
  }), configured)
  assert.equal(other.status, 400)
  const callback = await worker.fetch(new Request(`https://acme.boing.test/auth/boing/callback?state=${encodeURIComponent(state)}&code=example`, {
    headers: { cookie: `__Host-boing_flow=${state}` }
  }), configured)
  assert.equal(callback.status, 302)
  assert.ok(callback.headers.getSetCookie().some(value => value.startsWith('__Host-boing_session=')))
  sql.close()
})

test('tenant access requires active local and WorkOS membership, including provider outages', async () => {
  const sql = new DatabaseSync(':memory:')
  sql.exec(readFileSync(new URL('./boing-tenancy-schema.sql', import.meta.url), 'utf8'))
  sql.exec(`INSERT INTO boing_identities VALUES('user_123','test@example.com','active');
    INSERT INTO boing_organizations VALUES('a','Acme','org_A','active',0,'now');
    INSERT INTO boing_organization_subdomains VALUES('acme','a','now');
    INSERT INTO boing_memberships VALUES('a','user_123','owner','active','now');`)
  const DB = { prepare(query) { return { bind(...args) { return {
    async first() { return sql.prepare(query).get(...args) ?? null }
  } } } } }
  const configured = { APP_URL: 'https://app.boing.test', BOING_TENANT_BASE_URL: 'https://boing.test', DB, WORKOS_API_KEY: 'test' }
  let providerState = 'active'
  const provider = async () => {
    if (providerState === 'offline') throw Error('offline')
    return Response.json({ object: 'list', data: [{ user_id: user.id, organization_id: 'org_A', status: providerState }], list_metadata: { after: null } })
  }
  const worker = createBoingWorker({
    authenticate: async () => ({ status: 'active', user }),
    resolveContext: (bindings, identity, id) => resolveBoingContext(bindings, identity, id, provider),
    route: async () => Response.json({ ok: true })
  })
  const request = () => new Request('https://acme.boing.test/api/boing/projects', { headers: { cookie } })
  assert.equal((await worker.fetch(request(), configured)).status, 200)
  providerState = 'inactive'
  assert.equal((await worker.fetch(request(), configured)).status, 403)
  providerState = 'offline'
  assert.equal((await worker.fetch(request(), configured)).status, 503)
  providerState = 'active'
  sql.exec("UPDATE boing_memberships SET status='suspended' WHERE organization_id='a'")
  assert.equal((await worker.fetch(request(), configured)).status, 403)
  sql.close()
})
