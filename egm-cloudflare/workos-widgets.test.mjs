import test from 'node:test'
import assert from 'node:assert/strict'
import { issueUserSessionsWidgetToken, verifyWorkosSessionToken, workosSessionState } from './workos-widgets.mjs'

const clientId = 'client_123', userId = 'user_123', sessionId = 'session_123', issuer = 'https://api.workos.com'
const now = Date.now(), encoder = new TextEncoder()
const b64 = input => Buffer.from(input).toString('base64url')
const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'])
const jwk = { ...await crypto.subtle.exportKey('jwk', pair.publicKey), kid: 'test', use: 'sig', alg: 'RS256' }
async function makeToken(extra = {}) {
  const header = b64(JSON.stringify({ alg: 'RS256', kid: 'test' })), body = b64(JSON.stringify({ iss: issuer, client_id: clientId, sub: userId, sid: sessionId, exp: Math.floor(now / 1000) + 300, ...extra }))
  return `${header}.${body}.${b64(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, encoder.encode(`${header}.${body}`)))}`
}
const token = await makeToken()
const jwks = async () => Response.json({ keys: [jwk] })
const options = { clientId, issuer, userId, request: jwks, now }
const active = { id: sessionId, user_id: userId, status: 'active', expires_at: new Date(now + 60000).toISOString() }

test('only a signed, unexpired WorkOS token for this user and application supplies a session ID', async () => {
  assert.deepEqual(await verifyWorkosSessionToken(token, options), { sessionId })
  for (const extra of [{ sub: 'user_other' }, { client_id: 'client_other' }, { iss: 'https://evil.example' }, { sid: 'invalid' }, { exp: Math.floor(now / 1000) - 1 }]) assert.equal(await verifyWorkosSessionToken(await makeToken(extra), options), null)
  assert.equal(await verifyWorkosSessionToken(token.slice(0, -3) + 'abc', options), null)
  const expired = await makeToken({ exp: Math.floor(now / 1000) - 1 })
  assert.deepEqual(await verifyWorkosSessionToken(expired, { ...options, allowExpiredForBinding: true }), { sessionId })
  assert.equal(await verifyWorkosSessionToken(expired.slice(0, -3) + 'abc', { ...options, allowExpiredForBinding: true }), null)
})

test('checks active WorkOS state, handles pagination, and fails closed on truncated or failed scans', async () => {
  assert.equal(await workosSessionState({ apiKey: 'secret', userId, sessionId, now, request: async () => Response.json({ data: [active], list_metadata: { after: null } }) }), 'active')
  assert.equal(await workosSessionState({ apiKey: 'secret', userId, sessionId, now, request: async () => Response.json({ data: [{ ...active, status: 'revoked' }], list_metadata: { after: null } }) }), 'inactive')
  assert.equal(await workosSessionState({ apiKey: 'secret', userId, sessionId, now, request: async () => Response.json({ data: [{ ...active, user_id: 'user_other' }], list_metadata: { after: null } }) }), 'unavailable')
  assert.equal(await workosSessionState({ apiKey: 'secret', userId, sessionId, now, request: async () => Response.json({ data: [{ ...active, expires_at: 'invalid' }], list_metadata: { after: null } }) }), 'unavailable')
  assert.equal(await workosSessionState({ apiKey: 'secret', userId, sessionId, now, request: async () => Response.json({ data: [{ ...active, status: 'unexpected' }], list_metadata: { after: null } }) }), 'unavailable')
  assert.equal(await workosSessionState({ apiKey: 'secret', userId, sessionId, now, request: async () => new Response(null, { status: 503 }) }), 'unavailable')
  const rows = [{ ...active, id: 'session_other' }]
  let calls = 0
  assert.equal(await workosSessionState({ apiKey: 'secret', userId, sessionId, now, request: async url => { calls++; if (calls === 2) assert.equal(new URL(url).searchParams.get('after'), 'session_other'); return Response.json({ data: calls === 1 ? rows : [active], list_metadata: { after: calls === 1 ? 'session_other' : null } }) } }), 'active')
  assert.equal(calls, 2)
  assert.equal(await workosSessionState({ apiKey: 'secret', userId, sessionId, now, request: async () => Response.json({ data: rows, list_metadata: { after: 'session_other' } }) }), 'unavailable')
  assert.equal(await workosSessionState({ apiKey: 'secret', userId, sessionId, now, request: async () => Response.json({ data: rows }) }), 'unavailable')
  assert.equal(await workosSessionState({ apiKey: 'secret', userId, sessionId, now, request: async () => Response.json({ data: [{ ...rows[0], user_id: 'user_other' }], list_metadata: { after: null } }) }), 'unavailable')
  assert.equal(await workosSessionState({ apiKey: 'secret', userId, sessionId, now, request: async () => Response.json({ data: [{ ...rows[0], id: '' }], list_metadata: { after: null } }) }), 'unavailable')
})

test('mints only a user-scoped widget token after authenticating and verifying active session', async () => {
  const env = { APP_URL: 'https://dashboard.example', WORKOS_API_KEY: 'server-secret', WORKOS_CLIENT_ID: clientId, WORKOS_RBAC_ISSUER: issuer, WORKOS_WIDGETS_ENABLED: 'true' }
  const user = { id: userId, status: 'approved', verified: 1 }
  const req = origin => new Request(`${env.APP_URL}/api/workos-widget-token`, { method: 'POST', headers: { origin } })
  let calls = 0
  const fetcher = async (url, init) => {
    calls++
    if (url.includes('/sso/jwks/')) return jwks()
    if (url.includes('/sessions')) return Response.json({ data: [active], list_metadata: { after: null } })
    assert.equal(url, 'https://api.workos.com/widgets/token')
    assert.deepEqual(JSON.parse(init.body), { user_id: userId, scopes: [] })
    assert.equal(init.redirect, 'manual')
    return Response.json({ token: 'widget-token' })
  }
  assert.equal((await issueUserSessionsWidgetToken(req('https://evil.example'), env, user, token, fetcher)).status, 403)
  assert.equal((await issueUserSessionsWidgetToken(req(env.APP_URL), env, { ...user, status: 'denied' }, token, fetcher)).status, 401)
  assert.equal(calls, 0)
  const response = await issueUserSessionsWidgetToken(req(env.APP_URL), env, user, token, fetcher)
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('cache-control'), 'private, no-store')
  assert.deepEqual(await response.json(), { token: 'widget-token', currentSessionId: sessionId })
  assert.equal(calls, 3)
  assert.equal((await issueUserSessionsWidgetToken(req(env.APP_URL), { ...env, WORKOS_WIDGETS_ENABLED: 'false' }, user, token, fetcher)).status, 503)
})
