import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { BOING_IDENTITY_SCHEMA, createBoingSession, authenticateBoingSession, revokeBoingSession } from './boing-identity.mjs'

const enc = new TextEncoder()
const b64 = value => Buffer.from(value).toString('base64url')
const now = Date.now()

async function setup() {
  const sql = new DatabaseSync(':memory:')
  sql.exec(BOING_IDENTITY_SCHEMA)
  sql.exec('CREATE TABLE users (id TEXT, status TEXT); CREATE TABLE sessions (id TEXT, user_id TEXT);')
  const DB = { prepare(query) { return { bind(...args) { return {
    async first() { return sql.prepare(query).get(...args) ?? null },
    async run() { return { meta: { changes: Number(sql.prepare(query).run(...args).changes) } } }
  } } } }, async batch(queries) { sql.exec('BEGIN'); try { const result = []; for (const query of queries) result.push(await query.run()); sql.exec('COMMIT'); return result } catch (error) { sql.exec('ROLLBACK'); throw error } } }
  const keys = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'])
  const jwk = { ...await crypto.subtle.exportKey('jwk', keys.publicKey), kid: 'key1', alg: 'RS256', use: 'sig' }
  const claims = { iss: 'https://issuer.test', client_id: 'client_123', sub: 'user_123', sid: 'session_123', exp: Math.floor(now / 1000) + 600 }
  async function access(overrides = {}) {
    const unsigned = `${b64(JSON.stringify({ alg: 'RS256', kid: 'key1' }))}.${b64(JSON.stringify({ ...claims, ...overrides }))}`
    return `${unsigned}.${b64(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keys.privateKey, enc.encode(unsigned)))}`
  }
  let active = true
  const request = async url => {
    if (url.includes('/sso/jwks/')) return Response.json({ keys: [jwk] })
    if (url.endsWith('/sessions?limit=100&order=desc')) return Response.json({ data: active ? [{ id: 'session_123', user_id: 'user_123', status: 'active', expires_at: new Date(now + 3600000).toISOString() }] : [], list_metadata: { after: null } })
    if (url.endsWith('/user_management/users/user_123')) return Response.json({ id: 'user_123', email: 'a@example.com', email_verified: true })
    throw Error('unexpected request')
  }
  return { sql, env: { DB, WORKOS_API_KEY: 'key', WORKOS_CLIENT_ID: 'client_123', WORKOS_RBAC_ISSUER: claims.iss }, request, access, disable() { active = false } }
}

test('creates an opaque session only from a verified WorkOS session without touching legacy tables', async () => {
  const { env, request, access, sql } = await setup()
  const result = await createBoingSession(env, 'user_123', await access(), { request, now })
  assert.equal(result.status, 'created')
  assert.equal((await authenticateBoingSession(env, result.token, { request, now })).status, 'active')
  assert.equal(sql.prepare('SELECT count(*) AS count FROM users').get().count, 0)
  assert.equal(sql.prepare('SELECT count(*) AS count FROM sessions').get().count, 0)
  assert.notEqual(sql.prepare('SELECT token_hash FROM boing_sessions').get().token_hash, result.token)
})

test('forged, wrong-user and expired provider tokens cannot create sessions', async () => {
  const { env, request, access, sql } = await setup()
  for (const token of ['forged', await access({ sub: 'user_999' }), await access({ exp: Math.floor(now / 1000) - 1 })]) {
    assert.equal((await createBoingSession(env, 'user_123', token, { request, now })).status, 'denied')
  }
  assert.equal(sql.prepare('SELECT count(*) AS count FROM boing_sessions').get().count, 0)
})

test('expired, forged, locally revoked and provider-revoked sessions cannot authenticate', async () => {
  const { env, request, access, disable } = await setup()
  const result = await createBoingSession(env, 'user_123', await access(), { request, now })
  assert.equal((await authenticateBoingSession(env, 'forged', { request, now })).status, 'denied')
  assert.equal((await authenticateBoingSession(env, result.token, { request, now: now + 1801000 })).status, 'denied')
  disable()
  assert.equal((await authenticateBoingSession(env, result.token, { request, now })).status, 'denied')
  assert.equal(await revokeBoingSession(env, result.token, now), true)
  assert.equal((await authenticateBoingSession(env, result.token, { request, now })).status, 'denied')
})

test('provider outage fails closed', async () => {
  const { env, request, access } = await setup()
  const result = await createBoingSession(env, 'user_123', await access(), { request, now })
  assert.equal((await authenticateBoingSession(env, result.token, { request: async () => { throw Error('offline') }, now })).status, 'unavailable')
})
