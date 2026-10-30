import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { BOING_AUTH_FLOW_CAP, BOING_AUTH_SCHEMA, BOING_LOGIN_LIMIT, BOING_LOGIN_CLIENT_CAP, handleBoingAuth } from './boing-auth.mjs'
import { INVITES_SCHEMA } from './boing-invites.mjs'
import { openInviteToken, sealInviteToken } from './boing-invite-auth.mjs'

const now = Date.now()
function setup() {
  const sql = new DatabaseSync(':memory:')
  sql.exec(BOING_AUTH_SCHEMA)
  const DB = { prepare(query) { return { bind(...args) { return {
    async first() { return sql.prepare(query).get(...args) ?? null },
    async run() { return { meta: { changes: Number(sql.prepare(query).run(...args).changes) } } }
  } } } } }
  return { env: { DB, APP_URL: 'https://app.test', WORKOS_CLIENT_ID: 'client_123', WORKOS_API_KEY: 'secret', BOING_AUTH_SECRET: 's'.repeat(64) }, sql }
}
const req = (path, headers = {}) => {
  const request = new Request(`https://app.test${path}`, { headers: { 'cf-connecting-ip': '192.0.2.1', ...headers } })
  Object.defineProperty(request, 'cf', { value: { colo: 'SJC' } })
  return request
}
async function login(env, nowTime = now) {
  const response = await handleBoingAuth(req('/auth/boing/login'), env, { now: nowTime })
  const redirect = new URL(response.headers.get('location'))
  const state = redirect.searchParams.get('state')
  return { response, redirect, state, cookie: `__Host-boing_flow=${state}` }
}
const callback = (state, cookie) => req(`/auth/boing/callback?state=${encodeURIComponent(state)}&code=code123`, { cookie })

test('encrypted invitation cookie cannot be copied to another OAuth state', async () => {
  const secret = 's'.repeat(64), token = 'provider_token_123456'
  const sealed = await sealInviteToken(token, 'first-state', secret)
  assert.doesNotMatch(sealed, new RegExp(token))
  assert.equal(await openInviteToken(sealed, 'first-state', secret), token)
  assert.equal(await openInviteToken(sealed, 'other-state', secret), null)
  assert.equal(await openInviteToken(sealed, 'first-state', 'x'.repeat(64)), null)
})

test('PKCE and signed browser-bound state are single-use; session cookie is host-only', async () => {
  const { env, sql } = setup(), flow = await login(env)
  assert.equal(flow.response.status, 302)
  assert.equal(flow.redirect.searchParams.get('redirect_uri'), 'https://app.test/auth/boing/callback')
  assert.equal(flow.redirect.searchParams.get('code_challenge_method'), 'S256')
  let exchanged = 0
  const requestWorkos = async (url, options) => {
    exchanged++
    assert.equal(url, 'https://api.workos.com/user_management/authenticate')
    assert.equal(options.redirect, 'manual')
    const body = JSON.parse(options.body)
    const challenge = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body.code_verifier))).toString('base64url')
    assert.equal(challenge, flow.redirect.searchParams.get('code_challenge'))
    return Response.json({ user: { id: 'user_123', email_verified: true }, access_token: 'signed-access' })
  }
  const createSession = async (_env, user, access) => { assert.equal(user, 'user_123'); assert.equal(access, 'signed-access'); return { status: 'created', token: 'x'.repeat(43), expiresAt: Math.floor(now / 1000) + 1800 } }
  const response = await handleBoingAuth(callback(flow.state, flow.cookie), env, { requestWorkos, createSession, now })
  assert.equal(response.status, 302)
  const cookies = response.headers.getSetCookie()
  assert.ok(cookies.some(value => /^__Host-boing_session=/.test(value) && value.includes('Secure') && value.includes('HttpOnly') && value.includes('SameSite=Lax') && !value.includes('Domain=')))
  assert.equal((await handleBoingAuth(callback(flow.state, flow.cookie), env, { requestWorkos, createSession, now })).status, 400)
  assert.equal(exchanged, 1)
  assert.equal(sql.prepare('SELECT count(*) AS count FROM boing_auth_flows').get().count, 0)
})

test('bound invitation survives AuthKit login without persisting its plaintext token', async () => {
  const { env, sql } = setup()
  env.BOING_INVITATION_AUTH_ENABLED = 'true'
  env.BOING_INVITATION_RECIPIENT_CONTROLS_VERIFIED = 'true'
  sql.exec(readFileSync(new URL('./boing-tenancy-schema.sql', import.meta.url), 'utf8'))
  sql.exec(INVITES_SCHEMA)
  sql.exec(`INSERT INTO boing_identities VALUES('user_Owner','owner@example.com','active');
    INSERT INTO boing_organizations VALUES('orglocal','Workspace','org_123','active',0,'now');
    INSERT INTO boing_invitations VALUES('inv','orglocal','hash','guest@example.com','member','user_Owner','2026-01-01T00:00:00.000Z','2099-01-01T00:00:00.000Z',NULL,NULL,NULL,NULL);
    INSERT INTO boing_workos_invitation_bindings VALUES('inv','invitation_123');`)
  const invitation = { object: 'invitation', id: 'invitation_123', organization_id: 'org_123', email: 'guest@example.com', role_slug: 'member', state: 'pending', revoked_at: null, expires_at: '2099-01-01T00:00:00.000Z' }
  const providerToken = 'provider_token_123456'
  let exchanges = 0, accepted = 0, lookups = 0
  const requestWorkos = async (url, options) => {
    if (url.includes('/by_token/')) { lookups++; return Response.json(invitation) }
    exchanges++
    assert.equal(JSON.parse(options.body).invitation_token, providerToken)
    return Response.json({ user: { id: 'user_123', email: 'guest@example.com', email_verified: true }, access_token: 'signed-access' })
  }
  const options = { now, requestWorkos, createSession: async () => ({ status: 'created', token: 'x'.repeat(43), expiresAt: Math.floor(now / 1000) + 1800 }),
    acceptInvite: async (_env, token, identity) => { accepted++; assert.equal(token, providerToken); assert.equal(identity.email, 'guest@example.com'); return { status: 'accepted', organizationId: 'orglocal' } } }
  const start = await handleBoingAuth(req(`/auth/boing/login?invitation_token=${providerToken}`), env, options)
  assert.equal(start.status, 302)
  const authorization = new URL(start.headers.get('location'))
  assert.equal(authorization.searchParams.get('invitation_token'), providerToken)
  const state = authorization.searchParams.get('state')
  const cookies = start.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
  assert.doesNotMatch(cookies, new RegExp(providerToken))
  assert.doesNotMatch(JSON.stringify(sql.prepare('SELECT * FROM boing_auth_flows').get()), new RegExp(providerToken))
  env.BOING_INVITATION_RECIPIENT_CONTROLS_VERIFIED = 'false'
  assert.equal((await handleBoingAuth(callback(state, cookies), env, options)).status, 503)
  assert.equal(lookups, 1)
  assert.equal(exchanges, 0)
  env.BOING_INVITATION_RECIPIENT_CONTROLS_VERIFIED = 'true'
  const result = await handleBoingAuth(callback(state, cookies), env, options)
  assert.equal(result.status, 302)
  assert.equal(exchanges, 1)
  assert.equal(accepted, 1)
  assert.equal((await handleBoingAuth(callback(state, cookies), env, options)).status, 400)
})

test('invitation login denies a mismatched recipient before issuing a session', async () => {
  const { env, sql } = setup()
  env.BOING_INVITATION_AUTH_ENABLED = 'true'
  env.BOING_INVITATION_RECIPIENT_CONTROLS_VERIFIED = 'true'
  sql.exec(readFileSync(new URL('./boing-tenancy-schema.sql', import.meta.url), 'utf8'))
  sql.exec(INVITES_SCHEMA)
  sql.exec(`INSERT INTO boing_identities VALUES('user_Owner','owner@example.com','active'); INSERT INTO boing_organizations VALUES('orglocal','Workspace','org_123','active',0,'now');
    INSERT INTO boing_invitations VALUES('inv','orglocal','hash','guest@example.com','member','user_Owner','2026-01-01T00:00:00.000Z','2099-01-01T00:00:00.000Z',NULL,NULL,NULL,NULL);
    INSERT INTO boing_workos_invitation_bindings VALUES('inv','invitation_123');`)
  const providerToken = 'provider_token_123456'
  const requestWorkos = async url => url.includes('/by_token/') ? Response.json({ object: 'invitation', id: 'invitation_123', organization_id: 'org_123', email: 'guest@example.com', role_slug: 'member', state: 'pending', revoked_at: null, expires_at: '2099-01-01T00:00:00.000Z' }) : Response.json({ user: { id: 'user_wrong', email: 'wrong@example.com', email_verified: true }, access_token: 'signed-access' })
  let sessions = 0
  const options = { now, requestWorkos, createSession: async () => { sessions++ } }
  const start = await handleBoingAuth(req(`/auth/boing/login?invitation_token=${providerToken}`), env, options)
  const state = new URL(start.headers.get('location')).searchParams.get('state')
  const cookies = start.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
  const result = await handleBoingAuth(callback(state, cookies), env, options)
  assert.equal(result.status, 403)
  assert.equal(sessions, 0)
  assert.equal(result.headers.getSetCookie().some(value => value.startsWith('__Host-boing_session=')), false)
})

test('failed invitation acceptance revokes the newly created local session', async () => {
  for (const failure of ['denied', 'unavailable', 'throw']) {
    const { env, sql } = setup()
    Object.assign(env, { BOING_INVITATION_AUTH_ENABLED: 'true', BOING_INVITATION_RECIPIENT_CONTROLS_VERIFIED: 'true' })
    sql.exec(readFileSync(new URL('./boing-tenancy-schema.sql', import.meta.url), 'utf8'))
    sql.exec(INVITES_SCHEMA)
    sql.exec(`INSERT INTO boing_identities VALUES('user_Owner','owner@example.com','active');
      INSERT INTO boing_organizations VALUES('orglocal','Workspace','org_123','active',0,'now');
      INSERT INTO boing_invitations VALUES('inv','orglocal','hash','guest@example.com','member','user_Owner','2026-01-01T00:00:00.000Z','2099-01-01T00:00:00.000Z',NULL,NULL,NULL,NULL);
      INSERT INTO boing_workos_invitation_bindings VALUES('inv','invitation_123');`)
    const requestWorkos = async url => url.includes('/by_token/')
      ? Response.json({ object: 'invitation', id: 'invitation_123', organization_id: 'org_123', email: 'guest@example.com', role_slug: 'member', state: 'pending', revoked_at: null, expires_at: '2099-01-01T00:00:00.000Z' })
      : Response.json({ user: { id: 'user_123', email: 'guest@example.com', email_verified: true }, access_token: 'signed-access' })
    let ended = 0
    const options = { now, requestWorkos,
      createSession: async () => ({ status: 'created', token: 'x'.repeat(43), expiresAt: Math.floor(now / 1000) + 1800 }),
      endSession: async (_env, token) => { assert.equal(token, 'x'.repeat(43)); ended++; return { status: 'ended' } },
      acceptInvite: async () => { if (failure === 'throw') throw new Error('provider error'); return { status: failure } } }
    const start = await handleBoingAuth(req('/auth/boing/login?invitation_token=provider_token_123456'), env, options)
    const state = new URL(start.headers.get('location')).searchParams.get('state')
    const cookies = start.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
    const response = await handleBoingAuth(callback(state, cookies), env, options)
    assert.equal(response.status, failure === 'denied' ? 403 : 503)
    assert.equal(ended, 1)
    assert.equal(response.headers.getSetCookie().some(value => value.startsWith('__Host-boing_session=')), false)
  }
})

test('invitation sign-in is disabled until both deployment gates are configured', async () => {
  for (const flags of [{}, { BOING_INVITATION_AUTH_ENABLED: 'true' }, { BOING_INVITATION_RECIPIENT_CONTROLS_VERIFIED: 'true' }]) {
    const { env } = setup()
    Object.assign(env, flags)
    let calls = 0
    const options = { now, requestWorkos: async () => { calls++; throw new Error('unexpected provider call') } }
    const result = await handleBoingAuth(req('/auth/boing/login?invitation_token=provider_token_123456'), env, options)
    assert.equal(result.status, 503)
    assert.equal(calls, 0)
    assert.equal((await handleBoingAuth(req('/auth/boing/login'), env, options)).status, 302)
  }
})

test('rejects modified, missing, mismatched, duplicated and expired state before provider call', async () => {
  const { env } = setup(), flow = await login(env)
  const forged = `${flow.state.slice(0, -1)}${flow.state.endsWith('A') ? 'B' : 'A'}`
  let calls = 0
  const options = { now, requestWorkos: async () => { calls++; throw Error('unexpected') } }
  assert.equal((await handleBoingAuth(callback(forged, `__Host-boing_flow=${forged}`), env, options)).status, 400)
  assert.equal((await handleBoingAuth(callback(flow.state, ''), env, options)).status, 400)
  assert.equal((await handleBoingAuth(callback(flow.state, `${flow.cookie}; ${flow.cookie}`), env, options)).status, 400)
  assert.equal((await handleBoingAuth(callback(flow.state, flow.cookie), env, { ...options, now: now + 601000 })).status, 400)
  assert.equal(calls, 0)
})

test('rejects wrong host and provider failure without issuing session', async () => {
  const { env } = setup()
  assert.equal((await handleBoingAuth(new Request('https://evil.test/auth/boing/login'), env, { now })).status, 404)
  const flow = await login(env)
  let created = 0
  const result = await handleBoingAuth(callback(flow.state, flow.cookie), env, { now, requestWorkos: async () => new Response('expired code', { status: 400 }), createSession: async () => { created++ } })
  assert.equal(result.status, 401)
  assert.equal(created, 0)
  assert.equal(result.headers.getSetCookie().some(value => value.startsWith('__Host-boing_session=')), false)
  assert.equal((await handleBoingAuth(callback(flow.state, flow.cookie), env, { now })).status, 400)
})

test('rejects provider redirects without creating a session', async () => {
  const { env } = setup(), flow = await login(env)
  let calls = 0, created = false
  const response = await handleBoingAuth(callback(flow.state, flow.cookie), env, {
    now,
    requestWorkos: async (_url, options) => {
      calls++
      assert.equal(options.redirect, 'manual')
      return new Response(null, { status: 302, headers: { location: 'https://evil.test/' } })
    },
    createSession: async () => { created = true }
  })
  assert.equal(response.status, 401)
  assert.equal(calls, 1)
  assert.equal(created, false)
})

test('fails closed on provider outage, missing configuration and unverified email', async () => {
  const { env } = setup()
  assert.equal((await handleBoingAuth(req('/auth/boing/login'), { ...env, BOING_AUTH_SECRET: '' }, { now })).status, 503)
  let flow = await login(env)
  assert.equal((await handleBoingAuth(callback(flow.state, flow.cookie), env, { now, requestWorkos: async () => { throw Error('offline') } })).status, 503)
  flow = await login(env)
  let called = false
  const result = await handleBoingAuth(callback(flow.state, flow.cookie), env, { now, requestWorkos: async () => Response.json({ user: { id: 'user_123', email_verified: false }, access_token: 'token' }), createSession: async () => { called = true } })
  assert.equal(result.status, 401)
  assert.equal(called, false)
})

test('admission is capped without removing valid existing flows', async () => {
  const { env, sql } = setup()
  const flow = await login(env)
  const expiry = Math.floor(now / 1000) + 600
  const insert = sql.prepare('INSERT INTO boing_auth_flows VALUES(?,?,?)')
  for (let i = 1; i < BOING_AUTH_FLOW_CAP; i++) insert.run(`valid-${i}`, 'verifier', expiry)
  const denied = await handleBoingAuth(req('/auth/boing/login', { cookie: flow.cookie }), env, { now })
  assert.equal(denied.status, 429)
  assert.equal(denied.headers.get('set-cookie'), null)
  assert.equal(sql.prepare('SELECT count(*) AS n FROM boing_auth_flows').get().n, BOING_AUTH_FLOW_CAP)
  // The original flow remains usable even when another login is denied.
  const response = await handleBoingAuth(callback(flow.state, flow.cookie), env, { now, requestWorkos: async () => new Response(null, { status: 400 }) })
  assert.equal(response.status, 401)
})

test('expired flows are pruned in bounded batches and concurrent admission cannot exceed the cap', async () => {
  const { env, sql } = setup()
  const expiry = Math.floor(now / 1000)
  const insert = sql.prepare('INSERT INTO boing_auth_flows VALUES(?,?,?)')
  for (let i = 0; i < 130; i++) insert.run(`expired-${i}`, 'verifier', expiry)
  const response = await handleBoingAuth(req('/auth/boing/login'), env, { now })
  assert.equal(response.status, 302)
  assert.equal(sql.prepare('SELECT count(*) AS n FROM boing_auth_flows WHERE expires_at<=?').get(expiry).n, 2)
  sql.exec('DELETE FROM boing_auth_flows')
  for (let i = 0; i < BOING_AUTH_FLOW_CAP - 1; i++) insert.run(`valid-${i}`, 'verifier', expiry + 600)
  const responses = await Promise.all(Array.from({ length: 12 }, () => handleBoingAuth(req('/auth/boing/login'), env, { now })))
  assert.equal(responses.filter(item => item.status === 302).length, 1)
  assert.equal(responses.filter(item => item.status === 429).length, 11)
  assert.equal(sql.prepare('SELECT count(*) AS n FROM boing_auth_flows').get().n, BOING_AUTH_FLOW_CAP)
})

test('login admission is per client, atomic, expires, and stores only keyed hashes', async () => {
  const { env, sql } = setup()
  const attempts = await Promise.all(Array.from({ length: BOING_LOGIN_LIMIT + 4 }, () => handleBoingAuth(req('/auth/boing/login'), env, { now })))
  assert.equal(attempts.filter(response => response.status === 302).length, BOING_LOGIN_LIMIT)
  assert.equal(attempts.filter(response => response.status === 429).length, 4)
  const stored = sql.prepare('SELECT client_hash, count FROM boing_auth_rate_limits').get()
  assert.match(stored.client_hash, /^[A-Za-z0-9_-]{43}$/)
  assert.equal(stored.count, BOING_LOGIN_LIMIT)
  assert.notEqual(stored.client_hash, '192.0.2.1')
  assert.equal((await handleBoingAuth(req('/auth/boing/login', { 'cf-connecting-ip': '192.0.2.2' }), env, { now })).status, 302)
  assert.equal((await handleBoingAuth(req('/auth/boing/login'), env, { now: now + 61000 })).status, 302)
})

test('login fails closed without trusted edge metadata, a valid address, or working storage', async () => {
  const { env, sql } = setup()
  const untrusted = new Request('https://app.test/auth/boing/login', { headers: { 'cf-connecting-ip': '192.0.2.1' } })
  assert.equal((await handleBoingAuth(untrusted, env, { now })).status, 503)
  assert.equal((await handleBoingAuth(req('/auth/boing/login', { 'cf-connecting-ip': '192.0.2.999' }), env, { now })).status, 503)
  sql.exec('DROP TABLE boing_auth_rate_limits')
  assert.equal((await handleBoingAuth(req('/auth/boing/login'), env, { now })).status, 503)
})

test('equivalent IPv6 spellings share one client limit', async () => {
  const { env, sql } = setup()
  assert.equal((await handleBoingAuth(req('/auth/boing/login', { 'cf-connecting-ip': '2001:db8::1' }), env, { now })).status, 302)
  assert.equal((await handleBoingAuth(req('/auth/boing/login', { 'cf-connecting-ip': '2001:0db8:0:0:0:0:0:1' }), env, { now })).status, 302)
  const result = sql.prepare('SELECT count(*) AS clients, sum(count) AS requests FROM boing_auth_rate_limits').get()
  assert.equal(result.clients, 1)
  assert.equal(result.requests, 2)
})

test('rate-limit storage bounds distinct clients and prunes only expired entries in batches', async () => {
  const { env, sql } = setup()
  const at = Math.floor(now / 1000)
  const insert = sql.prepare('INSERT INTO boing_auth_rate_limits VALUES (?,?,?)')
  for (let i = 0; i < BOING_LOGIN_CLIENT_CAP; i++) insert.run(`client-${i}`, 1, at + 60)
  assert.equal((await handleBoingAuth(req('/auth/boing/login'), env, { now })).status, 429)
  sql.prepare('UPDATE boing_auth_rate_limits SET expires_at=? WHERE rowid<=130').run(at)
  assert.equal((await handleBoingAuth(req('/auth/boing/login'), env, { now })).status, 302)
  assert.equal(sql.prepare('SELECT count(*) AS n FROM boing_auth_rate_limits WHERE expires_at<=?').get(at).n, 2)
})
