import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { rbacConfigured, storeWorkosSession, workosAdminPermission } from './workos-session.mjs'
import { handle, seal } from './worker.mjs'

const now = 1793184000000
const envBase = { WORKOS_RBAC_ENABLED: 'true', WORKOS_CLIENT_ID: 'client_123', WORKOS_RBAC_ORGANIZATION_ID: 'org_123', WORKOS_RBAC_ISSUER: 'https://api.workos.com', WORKOS_API_KEY: 'fixture-key', WORKOS_OWNER_USER_ID: 'user_owner', SESSION_SECRET: 'x'.repeat(64) }
const b64 = value => Buffer.from(value).toString('base64url')
async function signing() {
  const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'])
  const jwk = { ...await crypto.subtle.exportKey('jwk', pair.publicKey), kid: 'test', alg: 'RS256', use: 'sig' }
  return { jwk, async token(extra = {}) {
    const head = b64(JSON.stringify({ alg: 'RS256', kid: 'test' }))
    const body = b64(JSON.stringify({ iss: envBase.WORKOS_RBAC_ISSUER, client_id: envBase.WORKOS_CLIENT_ID, sub: 'user_a', org_id: envBase.WORKOS_RBAC_ORGANIZATION_ID, permissions: ['egm:dashboard:admin'], exp: now / 1000 + 300, ...extra }))
    const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(`${head}.${body}`))
    return `${head}.${body}.${b64(signature)}`
  } }
}
function fixture() {
  const db = new DatabaseSync(':memory:')
  db.exec('CREATE TABLE sessions(id TEXT PRIMARY KEY); INSERT INTO sessions VALUES(\'s1\');')
  db.exec(readFileSync(new URL('./workos-session-schema.sql', import.meta.url), 'utf8'))
  const DB = { prepare(sql) { return { bind(...args) { return { async run() { const result = db.prepare(sql).run(...args); return { meta: { changes: Number(result.changes) } } }, async first() { return db.prepare(sql).get(...args) ?? null } } } } } }
  return { db, env: { ...envBase, DB } }
}

test('admin access requires organization-scoped signed permission and persists only encrypted tokens', async () => {
  const { env, db } = fixture(), signer = await signing()
  const accessToken = await signer.token()
  const requests = []
  const request = async (url, init) => {
    requests.push(url)
    if (url.includes('/sso/jwks/')) return Response.json({ keys: [signer.jwk] })
    assert.equal(JSON.parse(init.body).organization_id, env.WORKOS_RBAC_ORGANIZATION_ID)
    return Response.json({ access_token: accessToken, refresh_token: 'rotated-secret', organization_id: env.WORKOS_RBAC_ORGANIZATION_ID, user: { id: 'user_a' } })
  }
  assert.equal(await storeWorkosSession(env, 's1', 'user_a', 'unscoped-access', 'refresh-secret'), true)
  const saved = db.prepare('SELECT tokens FROM workos_sessions').get().tokens
  assert.equal(saved.includes('refresh-secret'), false)
  assert.equal((await workosAdminPermission(env, 's1', 'user_a', { request, now: () => now })).status, 'allowed')
  assert.equal((await workosAdminPermission(env, 's1', 'user_a', { request, now: () => now })).status, 'allowed')
  assert.equal(requests.filter(url => url.includes('/authenticate')).length, 1)
  assert.equal(db.prepare('SELECT version FROM workos_sessions').get().version, 1)
  assert.equal((await workosAdminPermission(env, 's1', 'other-user', { request, now: () => now })).status, 'reauthenticate')
})

test('expired or invalid permissions fail closed, and concurrent refresh never reuses a token', async () => {
  const { env, db } = fixture(), signer = await signing()
  let release, started
  const blocked = new Promise(resolve => { release = resolve })
  const begun = new Promise(resolve => { started = resolve })
  const request = async url => {
    if (url.includes('/sso/jwks/')) return Response.json({ keys: [signer.jwk] })
    started(); await blocked
    return Response.json({ access_token: await signer.token({ permissions: [] }), refresh_token: 'next', organization_id: env.WORKOS_RBAC_ORGANIZATION_ID, user: { id: 'user_a' } })
  }
  await storeWorkosSession(env, 's1', 'user_a', 'before', 'refresh')
  const first = workosAdminPermission(env, 's1', 'user_a', { request, now: () => now })
  await begun
  assert.equal((await workosAdminPermission(env, 's1', 'user_a', { request, now: () => now })).status, 'retryable')
  release()
  assert.equal((await first).status, 'denied')
  assert.equal((await workosAdminPermission(env, 's1', 'user_a', { request, now: () => now })).status, 'denied')
  assert.equal(db.prepare('SELECT version FROM workos_sessions').get().version, 1)
  assert.equal(rbacConfigured({ ...env, WORKOS_RBAC_ORGANIZATION_ID: '' }), false)
})

test('encrypted tokens cannot be moved to another session or user', async () => {
  const { env, db } = fixture()
  db.exec("INSERT INTO sessions VALUES('s2')")
  await storeWorkosSession(env, 's1', 'user_a', 'access', 'refresh')
  db.prepare("INSERT INTO workos_sessions(session_id,user_id,tokens) SELECT 's2','user_b',tokens FROM workos_sessions WHERE session_id='s1'").run()
  const result = await workosAdminPermission(env, 's2', 'user_b', { request: async () => assert.fail('must not call WorkOS') })
  assert.equal(result.status, 'reauthenticate')
})

test('verified organization admin can manage, edit and refresh; owner without permission cannot', async () => {
  const db = new DatabaseSync(':memory:')
  db.exec("CREATE TABLE sessions(id TEXT PRIMARY KEY,user_id TEXT,expires_at INTEGER); CREATE TABLE users(id TEXT PRIMARY KEY,email TEXT,name TEXT,status TEXT,verified INTEGER,created_at TEXT,decided_at TEXT); CREATE TABLE presentation(id INTEGER PRIMARY KEY,body TEXT,revision INTEGER); INSERT INTO sessions VALUES('s1','user_a',9999999999),('s2','user_owner',9999999999); INSERT INTO users VALUES('user_a','admin@example.com','Admin','approved',1,'2026-01-01',NULL),('user_owner','owner@example.com','Owner','approved',1,'2026-01-01',NULL); INSERT INTO presentation VALUES(1,'{}',0)")
  db.exec(readFileSync(new URL('./workos-session-schema.sql', import.meta.url), 'utf8'))
  const DB = { prepare(sql) { return { bind(...args) { return { async run() { const result = db.prepare(sql).run(...args); return { meta: { changes: Number(result.changes) } } }, async first() { return db.prepare(sql).get(...args) ?? null }, async all() { return { results: db.prepare(sql).all(...args) } } } }, async first() { return db.prepare(sql).get() ?? null }, async all() { return { results: db.prepare(sql).all() } } } } }
  const env = { ...envBase, DB, APP_URL: 'https://egm.example', OWNER_EMAIL: 'owner@example.com' }
  const signer = await signing()
  const jwt = await signer.token({ exp: Math.floor(Date.now() / 1000) + 300 })
  await storeWorkosSession(env, 's1', 'user_a', 'unscoped', 'refresh')
  const previousFetch = globalThis.fetch
  globalThis.fetch = async url => String(url).includes('/sso/jwks/') ? Response.json({ keys: [signer.jwk] }) : Response.json({ access_token: jwt, refresh_token: 'next', organization_id: env.WORKOS_RBAC_ORGANIZATION_ID, user: { id: 'user_a' } })
  try {
    const token = await seal({ sid: 's1' }, env.SESSION_SECRET, 'session')
    const headers = { cookie: `__Host-egm_session=${token}` }
    assert.equal((await handle(new Request(`${env.APP_URL}/api/access`, { headers }), env)).status, 200)
    const presentation = await (await handle(new Request(`${env.APP_URL}/api/presentation`, { headers }), env)).json()
    assert.equal(presentation.canManageAccess, true)
    assert.equal(presentation.canEdit, true)
    const editHeaders = { ...headers, origin: env.APP_URL, 'content-type': 'application/json' }
    const edit = await handle(new Request(`${env.APP_URL}/api/presentation`, { method: 'PUT', headers: editHeaders, body: JSON.stringify({ revision: 0, presentation: {} }) }), env)
    assert.equal(edit.status, 200)
    const refresh = await handle(new Request(`${env.APP_URL}/api/refresh`, { method: 'POST', headers: editHeaders }), env)
    assert.equal(refresh.status, 200)
    assert.equal((await refresh.json()).status, 'expired')
    const foreignHeaders = { ...editHeaders, origin: 'https://evil.example' }
    assert.equal((await handle(new Request(`${env.APP_URL}/api/presentation`, { method: 'PUT', headers: foreignHeaders, body: JSON.stringify({ revision: 1, presentation: {} }) }), env)).status, 403)
    assert.equal((await handle(new Request(`${env.APP_URL}/api/refresh`, { method: 'POST', headers: foreignHeaders }), env)).status, 403)
    const ownerToken = await seal({ sid: 's2' }, env.SESSION_SECRET, 'session')
    const ownerHeaders = { cookie: `__Host-egm_session=${ownerToken}`, origin: env.APP_URL, 'content-type': 'application/json' }
    const ownerPresentation = await (await handle(new Request(`${env.APP_URL}/api/presentation`, { headers: ownerHeaders }), env)).json()
    assert.equal(ownerPresentation.canEdit, false)
    assert.equal(ownerPresentation.canManageAccess, false)
    assert.equal((await handle(new Request(`${env.APP_URL}/api/presentation`, { method: 'PUT', headers: ownerHeaders, body: JSON.stringify({ revision: 1, presentation: {} }) }), env)).status, 403)
    assert.equal((await handle(new Request(`${env.APP_URL}/api/refresh`, { method: 'POST', headers: ownerHeaders }), env)).status, 403)
    assert.equal((await handle(new Request(`${env.APP_URL}/api/access`, { headers: ownerHeaders }), env)).status, 403)
    const oldSession = await seal({ sid: 'missing' }, env.SESSION_SECRET, 'session')
    assert.equal((await handle(new Request(`${env.APP_URL}/api/access`, { headers: { cookie: `__Host-egm_session=${oldSession}` } }), env)).status, 401)
  } finally { globalThis.fetch = previousFetch }
})

test('WorkOS revocation deletes only the matching D1 session; outages fail closed without deletion', async () => {
  const db = new DatabaseSync(':memory:')
  db.exec("CREATE TABLE sessions(id TEXT PRIMARY KEY,user_id TEXT,expires_at INTEGER); CREATE TABLE users(id TEXT PRIMARY KEY,email TEXT UNIQUE,name TEXT,status TEXT,verified INTEGER); CREATE TABLE audit(id TEXT,user_id TEXT,action TEXT,actor TEXT,created_at TEXT); CREATE TABLE presentation(id INTEGER PRIMARY KEY,body TEXT,revision INTEGER); INSERT INTO sessions VALUES('s1','user_a',9999999999),('s2','user_a',9999999999); INSERT INTO users VALUES('user_a','admin@example.com','Admin','approved',1),('user_b','occupied@example.com','Other','denied',1); INSERT INTO presentation VALUES(1,'{}',0)")
  db.exec(readFileSync(new URL('./workos-session-schema.sql', import.meta.url), 'utf8'))
  const DB = { prepare(sql) { return { bind(...args) { return { sql, args, async run() { const result = db.prepare(sql).run(...args); return { meta: { changes: Number(result.changes) } } }, async first() { return db.prepare(sql).get(...args) ?? null } } }, async first() { return db.prepare(sql).get() ?? null } } }, async batch(statements) { return statements.map(({ sql, args }) => ({ meta: { changes: Number(db.prepare(sql).run(...args).changes) } })) } }
  const env = { ...envBase, WORKOS_RBAC_ENABLED: 'false', WORKOS_WIDGETS_ENABLED: 'true', DB, APP_URL: 'https://egm.example', OWNER_EMAIL: 'owner@example.com' }
  const signer = await signing(), expiry = Math.floor(Date.now() / 1000) + 300
  await storeWorkosSession(env, 's1', 'user_a', await signer.token({ sid: 'session_1', exp: expiry }), 'refresh')
  await storeWorkosSession(env, 's2', 'user_a', await signer.token({ sid: 'session_2', exp: expiry }), 'refresh-other')
  const cookie = await seal({ sid: 's1' }, env.SESSION_SECRET, 'session')
  const request = () => new Request(`${env.APP_URL}/api/presentation`, { headers: { cookie: `__Host-egm_session=${cookie}` } })
  const previousFetch = globalThis.fetch; let state = 'active', profileEmail = 'admin@example.com', emailVerified = true, expiredGrant = false
  globalThis.fetch = async url => {
    if (String(url).includes('/sso/jwks/')) return Response.json({ keys: [signer.jwk] })
    if (String(url).endsWith('/user_management/authenticate') && expiredGrant) return Response.json({ error: 'invalid_grant' }, { status: 400 })
    if (String(url).endsWith('/user_management/users/user_a')) return Response.json({ id: 'user_a', email: profileEmail, email_verified: emailVerified })
    if (String(url).endsWith('/widgets/token')) return Response.json({ token: 'widget-short-lived' })
    if (state === 'unavailable') throw Error('temporary network failure')
    const row = { id: 'session_1', user_id: 'user_a', status: 'active', expires_at: new Date(Date.now() + 60000).toISOString() }
    return Response.json({ data: state === 'active' ? [row] : [], list_metadata: { after: null } })
  }
  try {
    const active = await handle(request(), env)
    assert.equal(active.status, 200)
    const body = await active.text()
    assert.equal(body.includes('refresh'), false)
    assert.equal(body.includes('widget-short-lived'), false)
    assert.equal(JSON.parse(body).widgetsEnabled, true)
    assert.equal(JSON.parse(body).profileEnabled, true)
    const widget = await handle(new Request(`${env.APP_URL}/api/workos-widget-token`, { method: 'POST', headers: { cookie: `__Host-egm_session=${cookie}`, origin: env.APP_URL } }), env)
    assert.equal(widget.status, 200)
    assert.equal((await widget.json()).token, 'widget-short-lived')
    profileEmail = 'new@example.com'
    assert.equal((await (await handle(request(), env)).json()).viewer.email, 'new@example.com')
    assert.equal(db.prepare("SELECT status FROM users WHERE id='user_a'").get().status, 'approved')
    assert.equal(db.prepare("SELECT count(*) AS n FROM audit WHERE action='email_updated'").get().n, 1)
    emailVerified = false
    assert.equal((await handle(request(), env)).status, 503)
    assert.equal(db.prepare("SELECT email FROM users WHERE id='user_a'").get().email, 'new@example.com')
    emailVerified = true; profileEmail = 'occupied@example.com'
    assert.equal((await handle(request(), env)).status, 403)
    assert.equal(db.prepare("SELECT email FROM users WHERE id='user_a'").get().email, 'new@example.com')
    profileEmail = 'new@example.com'
    state = 'unavailable'
    assert.equal((await handle(request(), env)).status, 503)
    const unavailablePage = await handle(new Request(`${env.APP_URL}/overview`, { headers: { cookie: `__Host-egm_session=${cookie}` } }), env)
    assert.equal(unavailablePage.status, 503)
    assert.match(unavailablePage.headers.get('content-type'), /^text\/html/)
    assert.match(await unavailablePage.text(), /Temporarily unavailable/)
    const unavailableApi = await handle(request(), env)
    assert.equal(unavailableApi.headers.get('content-type'), 'application/json')
    assert.deepEqual(await unavailableApi.json(), { error: 'session_verification_unavailable' })
    assert.equal(db.prepare("SELECT count(*) AS count FROM sessions WHERE id='s1'").get().count, 1)
    state = 'revoked'
    assert.equal((await handle(request(), env)).status, 401)
    assert.equal(db.prepare("SELECT count(*) AS count FROM sessions WHERE id='s1'").get().count, 0)
    assert.equal(db.prepare("SELECT count(*) AS count FROM sessions WHERE id='s2'").get().count, 1)
    assert.equal(db.prepare("SELECT count(*) AS count FROM workos_sessions WHERE session_id='s1'").get().count, 0)
    assert.equal(db.prepare("SELECT count(*) AS count FROM workos_sessions WHERE session_id='s2'").get().count, 1)
    db.prepare("DELETE FROM workos_sessions WHERE session_id='s2'").run()
    await storeWorkosSession(env, 's2', 'user_a', await signer.token({ sid: 'session_2', exp: Math.floor(Date.now() / 1000) - 1 }), 'revoked-refresh')
    expiredGrant = true
    const secondCookie = await seal({ sid: 's2' }, env.SESSION_SECRET, 'session')
    assert.equal((await handle(new Request(`${env.APP_URL}/api/presentation`, { headers: { cookie: `__Host-egm_session=${secondCookie}` } }), env)).status, 401)
    assert.equal(db.prepare("SELECT count(*) AS count FROM sessions WHERE id='s2'").get().count, 0)
  } finally { globalThis.fetch = previousFetch }
})

test('expired access token plus WorkOS invalid_grant is classified as revoked', async () => {
  const { env, db } = fixture()
  env.WORKOS_WIDGETS_ENABLED = 'true'
  const signer = await signing()
  await storeWorkosSession(env, 's1', 'user_a', await signer.token({ sid: 'session_1', exp: Math.floor(Date.now() / 1000) - 1 }), 'refresh')
  const { validatedWorkosSession } = await import('./workos-session.mjs')
  const result = await validatedWorkosSession(env, 's1', 'user_a', { request: async url => String(url).includes('/sso/jwks/') ? Response.json({ keys: [signer.jwk] }) : Response.json({ error: 'invalid_grant' }, { status: 400 }) })
  assert.deepEqual(result, { status: 'revoked' })
  assert.equal(db.prepare("SELECT count(*) AS count FROM workos_sessions WHERE session_id='s1'").get().count, 1)
})

test('token rotation cannot change the bound WorkOS session', async () => {
  const { env, db } = fixture()
  env.WORKOS_WIDGETS_ENABLED = 'true'
  const signer = await signing(), now = Date.now(), expired = Math.floor(now / 1000) - 1
  await storeWorkosSession(env, 's1', 'user_a', await signer.token({ sid: 'session_1', exp: expired }), 'old-refresh')
  const { validatedWorkosSession } = await import('./workos-session.mjs')
  const request = async url => String(url).includes('/sso/jwks/') ? Response.json({ keys: [signer.jwk] }) : Response.json({ access_token: await signer.token({ sid: 'session_2', exp: expired + 600 }), refresh_token: 'rotated', user: { id: 'user_a' } })
  assert.deepEqual(await validatedWorkosSession(env, 's1', 'user_a', { request }), { status: 'unavailable' })
  assert.equal(db.prepare("SELECT version FROM workos_sessions WHERE session_id='s1'").get().version, 0)
})

test('widgets and RBAC work together only if scoped refresh keeps the same WorkOS session', async () => {
  for (const nextSessionId of ['session_1', 'session_other']) {
    const db = new DatabaseSync(':memory:')
    db.exec("CREATE TABLE sessions(id TEXT PRIMARY KEY,user_id TEXT,expires_at INTEGER); CREATE TABLE users(id TEXT PRIMARY KEY,email TEXT,name TEXT,status TEXT,verified INTEGER); CREATE TABLE presentation(id INTEGER PRIMARY KEY,body TEXT,revision INTEGER); INSERT INTO sessions VALUES('s1','user_a',9999999999); INSERT INTO users VALUES('user_a','admin@example.com','Admin','approved',1); INSERT INTO presentation VALUES(1,'{}',0)")
    db.exec(readFileSync(new URL('./workos-session-schema.sql', import.meta.url), 'utf8'))
    const DB = { prepare(sql) { return { bind(...args) { return { async run() { const result = db.prepare(sql).run(...args); return { meta: { changes: Number(result.changes) } } }, async first() { return db.prepare(sql).get(...args) ?? null } } }, async first() { return db.prepare(sql).get() ?? null } } } }
    const env = { ...envBase, WORKOS_WIDGETS_ENABLED: 'true', DB, APP_URL: 'https://egm.example', OWNER_EMAIL: 'owner@example.com' }
    const signer = await signing(), exp = Math.floor(Date.now() / 1000) + 300
    await storeWorkosSession(env, 's1', 'user_a', await signer.token({ sid: 'session_1', exp, org_id: null, permissions: [] }), 'refresh')
    const previousFetch = globalThis.fetch
    globalThis.fetch = async url => {
      if (String(url).includes('/sso/jwks/')) return Response.json({ keys: [signer.jwk] })
      if (String(url).endsWith('/user_management/users/user_a')) return Response.json({ id: 'user_a', email: 'admin@example.com', email_verified: true })
      if (String(url).includes('/sessions')) return Response.json({ data: [{ id: 'session_1', user_id: 'user_a', status: 'active', expires_at: new Date(Date.now() + 60000).toISOString() }], list_metadata: { after: null } })
      return Response.json({ access_token: await signer.token({ sid: nextSessionId, exp }), refresh_token: 'rotated', organization_id: env.WORKOS_RBAC_ORGANIZATION_ID, user: { id: 'user_a' } })
    }
    try {
      const cookie = await seal({ sid: 's1' }, env.SESSION_SECRET, 'session')
      const response = await handle(new Request(`${env.APP_URL}/api/presentation`, { headers: { cookie: `__Host-egm_session=${cookie}` } }), env)
      assert.equal(response.status, 200)
      const body = await response.json()
      assert.equal(body.widgetsEnabled, true)
      assert.equal(body.canManageAccess, nextSessionId === 'session_1')
      assert.equal(body.canEdit, nextSessionId === 'session_1')
      assert.equal(db.prepare("SELECT version FROM workos_sessions WHERE session_id='s1'").get().version, nextSessionId === 'session_1' ? 1 : 0)
    } finally { globalThis.fetch = previousFetch }
  }
})
