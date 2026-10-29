import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { workosSigningKey } from './workos-jwks.mjs'
import { revokeWorkosSession, sessionSecrets, storeWorkosSession, workosAdminPermission } from './workos-session.mjs'
import { workosSessionState } from './workos-widgets.mjs'
import { handle, open, seal } from './worker.mjs'

const now = 1793184000000
const b64 = value => Buffer.from(value).toString('base64url')
const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'])
const publicJwk = await crypto.subtle.exportKey('jwk', pair.publicKey)
const jwk = kid => ({ ...publicJwk, kid, alg: 'RS256', use: 'sig' })
async function token(extra = {}) {
  const head = b64(JSON.stringify({ alg: 'RS256', kid: 'k1' }))
  const body = b64(JSON.stringify({ iss: 'https://api.workos.com', client_id: 'client_123', sub: 'user_a', sid: 'session_1', exp: now / 1000 + 300, ...extra }))
  return `${head}.${body}.${b64(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(`${head}.${body}`)))}`
}
const secretA = 'a'.repeat(64), secretB = 'b'.repeat(64)
const envBase = { WORKOS_WIDGETS_ENABLED: 'true', WORKOS_CLIENT_ID: 'client_123', WORKOS_RBAC_ISSUER: 'https://api.workos.com', WORKOS_API_KEY: 'fixture-key', WORKOS_OWNER_USER_ID: 'user_owner', SESSION_SECRET: secretA, APP_URL: 'https://egm.example', OWNER_EMAIL: 'owner@example.com' }
function database() {
  const db = new DatabaseSync(':memory:')
  db.exec("CREATE TABLE sessions(id TEXT PRIMARY KEY,user_id TEXT,expires_at INTEGER); INSERT INTO sessions VALUES('s1','user_a',9999999999)")
  db.exec(readFileSync(new URL('./workos-session-schema.sql', import.meta.url), 'utf8'))
  const DB = { prepare(sql) { return { bind(...args) { return { async run() { const result = db.prepare(sql).run(...args); return { meta: { changes: Number(result.changes) } } }, async first() { return db.prepare(sql).get(...args) ?? null } } } } } }
  return { db, DB }
}

test('signing keys are cached, refetched once on an unknown kid, and survive a short outage', async () => {
  let calls = 0, keys = [jwk('k1')], down = false
  const request = async () => { calls++; return down ? new Response(null, { status: 503 }) : Response.json({ keys }) }
  assert.ok(await workosSigningKey('client_123', 'k1', request, now))
  assert.ok(await workosSigningKey('client_123', 'k1', request, now + 60000))
  assert.equal(calls, 1)
  // A forged kid cannot drive repeated fetches.
  assert.equal(await workosSigningKey('client_123', 'forged', request, now + 61000), null)
  assert.equal(await workosSigningKey('client_123', 'forged', request, now + 62000), null)
  assert.equal(calls, 2)
  // Rotation: the new kid is picked up once the retry window has passed.
  keys = [jwk('k1'), jwk('k2')]
  assert.equal(await workosSigningKey('client_123', 'k2', request, now + 70000), null)
  assert.equal(calls, 2)
  assert.ok(await workosSigningKey('client_123', 'k2', request, now + 100000))
  assert.equal(calls, 3)
  // Outage: stale keys still verify for an hour, then fail closed.
  down = true
  assert.ok(await workosSigningKey('client_123', 'k1', request, now + 100000 + 11 * 60000))
  assert.equal(await workosSigningKey('client_123', 'k1', request, now + 100000 + 2 * 3600000), null)
})

test('a duplicate or malformed key id never resolves', async () => {
  const request = async () => Response.json({ keys: [jwk('dup'), jwk('dup'), { ...jwk('rsa-only'), kty: 'EC' }] })
  assert.equal(await workosSigningKey('client_dup', 'dup', request, now), null)
  assert.equal(await workosSigningKey('client_dup', 'rsa-only', request, now + 31000), null)
})

test('the session scan reads newest sessions first so a current session is found on page one', async () => {
  let order
  const request = async url => { order = new URL(url).searchParams.get('order'); return Response.json({ data: [{ id: 'session_1', user_id: 'user_a', status: 'active', expires_at: new Date(now + 60000).toISOString() }], list_metadata: { after: null } }) }
  assert.equal(await workosSessionState({ apiKey: 'k', userId: 'user_a', sessionId: 'session_1', request, now }), 'active')
  assert.equal(order, 'desc')
})

test('SESSION_SECRET rotation: previous secret still reads cookies and stored tokens', async () => {
  assert.deepEqual(sessionSecrets({ SESSION_SECRET: secretB, SESSION_SECRET_PREVIOUS: secretA }), [secretB, secretA])
  assert.deepEqual(sessionSecrets({ SESSION_SECRET: secretB, SESSION_SECRET_PREVIOUS: 'short' }), [secretB])
  assert.deepEqual(sessionSecrets({ SESSION_SECRET: secretB, SESSION_SECRET_PREVIOUS: secretB }), [secretB])
  const cookie = await seal({ sid: 's1' }, secretA, 'session')
  assert.equal((await open(cookie, sessionSecrets({ SESSION_SECRET: secretB }), 'session')), null)
  assert.equal((await open(cookie, sessionSecrets({ SESSION_SECRET: secretB, SESSION_SECRET_PREVIOUS: secretA }), 'session')).sid, 's1')

  const { DB } = database()
  const rbac = { ...envBase, WORKOS_RBAC_ENABLED: 'true', WORKOS_RBAC_ORGANIZATION_ID: 'org_123', DB }
  assert.equal(await storeWorkosSession(rbac, 's1', 'user_a', await token(), 'refresh'), true)
  const rotated = { ...rbac, SESSION_SECRET: secretB }
  const request = async () => assert.fail('must not reach WorkOS when decryption fails')
  assert.equal((await workosAdminPermission(rotated, 's1', 'user_a', { request, now: () => now })).status, 'reauthenticate')
  let reached = false
  const refresh = async url => { if (String(url).includes('/sso/jwks/')) return Response.json({ keys: [jwk('k1')] }); if (String(url).includes('/authenticate')) reached = true; return new Response(null, { status: 503 }) }
  assert.equal((await workosAdminPermission({ ...rotated, SESSION_SECRET_PREVIOUS: secretA }, 's1', 'user_a', { request: refresh, now: () => now })).status, 'retryable')
  assert.equal(reached, true)
})

test('revokeWorkosSession revokes the verified provider session id and never throws', async () => {
  const { DB } = database()
  const env = { ...envBase, DB }
  const access = await token()
  await storeWorkosSession(env, 's1', 'user_a', access, 'refresh')
  const calls = []
  const request = async (url, init) => {
    if (String(url).includes('/sso/jwks/')) return Response.json({ keys: [jwk('k1')] })
    calls.push({ url: String(url), body: JSON.parse(init.body), auth: init.headers.authorization })
    return Response.json({})
  }
  assert.equal(await revokeWorkosSession(env, 's1', { request, now: () => now }), true)
  assert.deepEqual(calls, [{ url: 'https://api.workos.com/user_management/sessions/revoke', body: { session_id: 'session_1' }, auth: 'Bearer fixture-key' }])
  assert.equal(await revokeWorkosSession(env, 'missing', { request, now: () => now }), false)
  assert.equal(await revokeWorkosSession(env, 's1', { request: async () => { throw Error('network') }, now: () => now }), false)
  assert.equal(await revokeWorkosSession({ ...env, WORKOS_WIDGETS_ENABLED: 'false' }, 's1', { request, now: () => now }), false)
})

test('logout asks WorkOS to revoke the session, then clears local state even if WorkOS fails', async () => {
  for (const workosOk of [true, false]) {
    const { db, DB } = database()
    const env = { ...envBase, DB }
    const access = await token({ exp: Math.floor(Date.now() / 1000) + 300 })
    await storeWorkosSession(env, 's1', 'user_a', access, 'refresh')
    const revoked = []
    const previous = globalThis.fetch
    globalThis.fetch = async (url, init) => {
      if (String(url).includes('/sso/jwks/')) return Response.json({ keys: [jwk('k1')] })
      revoked.push(JSON.parse(init.body).session_id)
      return workosOk ? Response.json({}) : new Response(null, { status: 500 })
    }
    try {
      const cookie = await seal({ sid: 's1' }, secretA, 'session')
      const response = await handle(new Request(`${env.APP_URL}/auth/logout`, { method: 'POST', headers: { cookie: `__Host-egm_session=${cookie}`, origin: env.APP_URL } }), env)
      assert.equal(response.status, 303)
      assert.deepEqual(revoked, ['session_1'])
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 0)
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM workos_sessions').get().n, 0)
      assert.match(response.headers.get('set-cookie'), /__Host-egm_session=;.*Max-Age=0/)
    } finally { globalThis.fetch = previous }
  }
})

test('a failed sign-in callback clears the single-use flow cookie', async () => {
  const { DB } = database()
  const env = { ...envBase, DB }
  const flow = await seal({ verifier: 'v', state: 'abc' }, secretA, 'login', 600)
  const previous = globalThis.fetch
  globalThis.fetch = async () => new Response(null, { status: 400 })
  try {
    const response = await handle(new Request(`${env.APP_URL}/auth/callback?state=abc&code=bad`, { headers: { cookie: `__Host-egm_flow=${flow}` } }), env)
    assert.notEqual(response.status, 302)
    assert.match(response.headers.get('set-cookie'), /__Host-egm_flow=;.*Max-Age=0/)
  } finally { globalThis.fetch = previous }
})
