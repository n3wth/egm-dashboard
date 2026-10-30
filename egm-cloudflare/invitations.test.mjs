import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { invitationHash, manageInvitations, redeemInvitation } from './invitations.mjs'
import { handle, open } from './worker.mjs'

const owner = { id: 'owner', email: 'owner@example.org', verified: 1, status: 'approved' }
function setup() {
  const db = new DatabaseSync(':memory:')
  db.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'))
  db.exec(readFileSync(new URL('./invitations-schema.sql', import.meta.url), 'utf8'))
  db.prepare('INSERT INTO users(id,email,name,verified,status,created_at) VALUES(?,?,?,1,?,?)').run(owner.id, owner.email, 'Owner', 'approved', new Date().toISOString())
  const DB = { prepare(sql) { const statement = { sql, args: [], bind(...args) { return { ...this, args } }, async run() { const result = db.prepare(sql).run(...this.args); return { meta: { changes: Number(result.changes) } } }, async all() { return { results: db.prepare(sql).all(...this.args) } }, async first() { return db.prepare(sql).get(...this.args) ?? null } }; return statement }, async batch(statements) { db.exec('BEGIN'); try { const out = []; for (const statement of statements) out.push(await statement.run()); db.exec('COMMIT'); return out } catch (error) { db.exec('ROLLBACK'); throw error } } }
  return { db, env: { DB, APP_URL: 'https://dashboard.example', OWNER_EMAIL: owner.email, SESSION_SECRET: 'a'.repeat(64), WORKOS_CLIENT_ID: 'client_test' } }
}
const post = (path, data, origin = 'https://dashboard.example') => new Request('https://dashboard.example'+path, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(data) })
const person = (id = 'guest', email = 'guest@example.org') => ({ id, email, email_verified: true, first_name: 'Guest' })
test('oversized invitation requests do not create records', async () => {
  const { db, env } = setup()
  const body = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(2049)); controller.close() } })
  const req = new Request(env.APP_URL+'/api/invitations', { method: 'POST', headers: { origin: env.APP_URL, 'content-type': 'application/json' }, body, duplex: 'half' })
  assert.equal((await manageInvitations(req, env, owner)).status, 413)
  assert.equal(db.prepare('SELECT count(*) AS n FROM invitations').get().n, 0)
})
async function create(env, extra = {}) {
  const response = await manageInvitations(post('/api/invitations', { kind: 'link', expiresInDays: 7, ...extra }), env, owner)
  assert.equal(response.status, 201)
  const data = await response.json()
  return { ...data, token: new URL(data.url).searchParams.get('invitation_token') }
}
async function startInvitation(env, invitationUrl) {
  const initial = await handle(new Request(invitationUrl), env)
  assert.equal(initial.status, 303)
  const inviteCookie = initial.headers.get('set-cookie').match(/__Host-egm_invite=([^;]+)/)[1]
  const landing = await handle(new Request(env.APP_URL+'/auth/invite', { headers: { cookie: `__Host-egm_invite=${inviteCookie}` } }), env)
  assert.equal(landing.status, 200)
  const continued = await handle(new Request(env.APP_URL+'/auth/invite/continue', { method: 'POST', headers: { origin: env.APP_URL, cookie: `__Host-egm_invite=${inviteCookie}` } }), env)
  assert.equal(continued.status, 302)
  const flowCookie = continued.headers.get('set-cookie').match(/__Host-egm_flow=([^;]+)/)[1]
  return { initial, landing, continued, inviteCookie, flowCookie }
}
test('only owner can create links and token is not stored in plaintext or list responses', async () => {
  const { db, env } = setup()
  assert.equal((await manageInvitations(post('/api/invitations', { kind: 'link', expiresInDays: 7 }), env, person())).status, 403)
  assert.equal((await manageInvitations(post('/api/invitations', { kind: 'link', expiresInDays: 7 }, 'https://evil.example'), env, owner)).status, 403)
  const invitation = await create(env)
  const stored = db.prepare('SELECT * FROM invitations').get()
  assert.notEqual(stored.token_hash, invitation.token)
  const list = await (await manageInvitations(new Request(env.APP_URL+'/api/invitations'), env, owner)).text()
  assert.equal(list.includes(invitation.token), false)
  assert.equal(list.includes(stored.token_hash), false)
})
test('verified redemption is single-use and pending users are approved and audited', async () => {
  const { db, env } = setup(), invitation = await create(env)
  db.prepare('INSERT INTO users(id,email,name,verified,status,created_at) VALUES(?,?,?,1,?,?)').run('guest','guest@example.org','Guest','pending',new Date().toISOString())
  assert.equal(await redeemInvitation(env, invitation.token, { ...person(), email_verified: false }), false)
  const attempts = await Promise.all([redeemInvitation(env, invitation.token, person()), redeemInvitation(env, invitation.token, person('other','other@example.org'))])
  assert.equal(attempts.filter(Boolean).length, 1)
  const winner = attempts[0] ? 'guest' : 'other'
  assert.equal(db.prepare('SELECT status FROM users WHERE id=?').get(winner).status, 'approved')
  if (winner === 'other') assert.equal(db.prepare("SELECT status FROM users WHERE id='guest'").get().status, 'pending')
  assert.equal(db.prepare('SELECT redeemed_by FROM invitations WHERE id=?').get(invitation.id).redeemed_by, winner)
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM audit WHERE action='invitation_approved'").get().n, 1)
  assert.equal(await redeemInvitation(env, invitation.token, person()), false)
})
test('redeeming an invitation approves an existing pending user', async () => {
  const { db, env } = setup(), invitation = await create(env)
  db.prepare('INSERT INTO users(id,email,name,verified,status,created_at) VALUES(?,?,?,1,?,?)').run('guest', 'guest@example.org', 'Guest', 'pending', new Date().toISOString())
  assert.equal(await redeemInvitation(env, invitation.token, person()), true)
  assert.equal(db.prepare("SELECT status FROM users WHERE id='guest'").get().status, 'approved')
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM audit WHERE action='invitation_approved' AND user_id='guest'").get().n, 1)
})
test('expired, revoked, altered and denied-user invitations never grant access', async () => {
  const { db, env } = setup()
  const denied = await create(env)
  db.prepare('INSERT INTO users(id,email,name,verified,status,created_at) VALUES(?,?,?,1,?,?)').run('guest','guest@example.org','Guest','denied',new Date().toISOString())
  assert.equal(await redeemInvitation(env, denied.token, person()), false)
  assert.equal(await redeemInvitation(env, denied.token+'x', person('other','other@example.org')), false)
  const revoked = await create(env)
  assert.equal((await manageInvitations(post('/api/invitations/revoke', { id: revoked.id }), env, owner)).status, 200)
  assert.equal(await redeemInvitation(env, revoked.token, person('other','other@example.org')), false)
  const expired = await create(env)
  db.prepare('UPDATE invitations SET expires_at=? WHERE id=?').run(Date.now()-1, expired.id)
  assert.equal(await redeemInvitation(env, expired.token, person('other','other@example.org')), false)
})
test('email mode fails closed without verified routing and rejects other emails', async () => {
  const { db, env } = setup()
  const request = post('/api/invitations', { kind: 'email', email: 'guest@example.org', expiresInDays: 7 })
  const unavailable = await manageInvitations(request, env, owner, () => assert.fail('must not send'))
  assert.equal(unavailable.status, 503)
  assert.equal((await unavailable.json()).error, 'email_not_configured')
  const token = 'a'.repeat(32)
  db.prepare('INSERT INTO invitations(id,token_hash,email,kind,created_by,created_at,expires_at) VALUES(?,?,?,?,?,?,?)').run(crypto.randomUUID(), await invitationHash(token), 'guest@example.org', 'email', owner.id, Date.now(), Date.now()+86400000)
  assert.equal(await redeemInvitation(env, token, person('other','other@example.org')), false)
  assert.equal(await redeemInvitation(env, token, person()), true)
  assert.equal(db.prepare('SELECT email FROM invitations').get().email, 'guest@example.org')
})
const emailEnv = env => ({ ...env, RESEND_API_KEY: 'test-secret', INVITATION_EMAIL_ENABLED: 'true' })
const emailRequest = () => post('/api/invitations', { kind: 'email', email: 'guest@example.org', expiresInDays: 7 })
test('email sends once after durable reservation and binds invitation to verified recipient', async () => {
  const { db, env: base } = setup(), env = emailEnv(base)
  let token
  const result = await manageInvitations(emailRequest(), env, owner, async (url, init) => {
    assert.equal(db.prepare('SELECT delivery_state FROM invitations').get().delivery_state, 'sending')
    assert.equal(url, 'https://api.resend.com/emails')
    assert.match(init.headers['idempotency-key'], /^egm-invitation\//)
    const body = JSON.parse(init.body)
    assert.deepEqual(body.to, ['guest@example.org'])
    assert.match(body.from, /@n3wth\.com>/)
    assert.doesNotMatch(body.html, /background/i)
    assert.match(body.text, /Sign in with the Google account/)
    const link = body.text.match(/https:\/\/[^\s]+/)[0]
    token = new URL(link).searchParams.get('invitation_token')
    assert.equal(db.prepare('SELECT token_hash FROM invitations').get().token_hash, await invitationHash(token))
    return Response.json({ id: 'email_123' })
  })
  assert.equal(result.status, 201)
  assert.equal((await result.json()).deliveryState, 'sent')
  assert.equal(db.prepare('SELECT delivery_state FROM invitations').get().delivery_state, 'sent')
  assert.equal(await redeemInvitation(env, token, person('other','other@example.org')), false)
  assert.equal(await redeemInvitation(env, token, person()), true)
  assert.equal(await redeemInvitation(env, token, person()), false)
})
test('ambiguous email delivery is not retried and the delivered link only grants its intended recipient', async () => {
  const { db, env: base } = setup(), env = emailEnv(base)
  let sent = 0, token
  const result = await manageInvitations(emailRequest(), env, owner, async (url, init) => { sent++; token = new URL(JSON.parse(init.body).text.match(/https:\/\/[^\s]+/)[0]).searchParams.get('invitation_token'); throw Error('provider timed out') })
  assert.equal(result.status, 202)
  assert.equal((await result.json()).error, 'email_delivery_unknown')
  assert.equal(db.prepare('SELECT delivery_state FROM invitations').get().delivery_state, 'unknown')
  assert.equal((await manageInvitations(emailRequest(), env, owner, () => assert.fail('must not resend'))).status, 409)
  assert.equal(sent, 1)
  assert.equal(await redeemInvitation(env, token, person('other','other@example.org')), false)
  assert.equal(await redeemInvitation(env, token, person()), true)
  assert.equal(await redeemInvitation(env, token, person()), false)
})
test('email requires explicit configuration and exposes explicit delivery state', async () => {
  const { env: base } = setup(), env = emailEnv(base)
  assert.equal((await manageInvitations(emailRequest(), { ...env, INVITATION_EMAIL_ENABLED: 'false' }, owner, () => assert.fail('not configured'))).status, 503)
  assert.equal((await manageInvitations(emailRequest(), env, owner, async () => new Response(null, { status: 400 }))).status, 502)
  const listed = await (await manageInvitations(new Request(env.APP_URL+'/api/invitations'), env, owner)).json()
  assert.equal(listed.emailAvailable, true)
  assert.equal(listed.invitations[0].deliveryState, 'failed')
})
test('email revocation blocks the delivered link', async () => {
  const { env: base } = setup(), env = emailEnv(base)
  let token
  const created = await manageInvitations(emailRequest(), env, owner, async (url, init) => { token = new URL(JSON.parse(init.body).text.match(/https:\/\/[^\s]+/)[0]).searchParams.get('invitation_token'); return Response.json({ id: 'email_123' }) })
  const { id } = await created.json()
  const revoked = await manageInvitations(post('/api/invitations/revoke', { id }), env, owner, () => assert.fail('must not call provider'))
  assert.equal(revoked.status, 200)
  assert.equal(await redeemInvitation(env, token, person()), false)
})
test('email invitation completes WorkOS sign-in only for the specified email', async () => {
  const { db, env: base } = setup(), env = emailEnv(base)
  let invitationUrl
  const result = await manageInvitations(emailRequest(), env, owner, async (url, init) => { invitationUrl = JSON.parse(init.body).text.match(/https:\/\/[^\s]+/)[0]; return Response.json({ id: 'email_123' }) })
  assert.equal(result.status, 201)
  const priorFetch = globalThis.fetch
  try {
    const callback = async user => {
      const { flowCookie } = await startInvitation(env, invitationUrl)
      const flow = await open(flowCookie, env.SESSION_SECRET, 'login')
      globalThis.fetch = async () => Response.json({ user })
      return handle(new Request(`${env.APP_URL}/auth/callback?state=${encodeURIComponent(flow.state)}&code=test`, { headers: { cookie: `__Host-egm_flow=${flowCookie}` } }), env)
    }
    assert.notEqual((await callback(person('other','other@example.org'))).status, 302)
    assert.equal((await callback(person())).status, 302)
    assert.equal(db.prepare("SELECT status FROM users WHERE id='guest'").get().status, 'approved')
    assert.equal((await handle(new Request(invitationUrl), env)).status, 403)
  } finally { globalThis.fetch = priorFetch }
})
test('RBAC mode rejects email-owner fallback and accepts explicit manage permission', async () => {
  const { env: base } = setup(), env = { ...base, WORKOS_RBAC_ENABLED: 'true' }
  assert.equal((await manageInvitations(post('/api/invitations', { kind: 'link', expiresInDays: 1 }), env, owner)).status, 403)
  assert.equal((await manageInvitations(post('/api/invitations', { kind: 'link', expiresInDays: 1 }), env, { ...owner, canManageAccess: true })).status, 201)
})
test('stable owner subject is required after the owner pin is configured', async () => {
  const { env: base } = setup(), env = { ...base, WORKOS_OWNER_USER_ID: 'user_owner' }
  const request = () => post('/api/invitations', { kind: 'link', expiresInDays: 1 })
  assert.equal((await manageInvitations(request(), env, { ...owner, id: 'user_other' })).status, 403)
  assert.equal((await manageInvitations(request(), env, { ...owner, id: 'user_owner', email: 'new@example.org' })).status, 201)
})
test('invite landing hides token and requires explicit same-origin continuation', async () => {
  const { env } = setup(), invite = await create(env)
  const { initial, landing, continued, flowCookie } = await startInvitation(env, invite.url)
  assert.equal(initial.headers.get('location'), '/auth/invite')
  assert.match(initial.headers.get('set-cookie'), /HttpOnly/)
  assert.equal(initial.headers.get('referrer-policy'), 'no-referrer')
  const html = await landing.text()
  assert.match(html, /You’re invited/)
  assert.match(html, /Continue with Google/)
  assert.doesNotMatch(html, new RegExp(invite.token))
  assert.equal(continued.headers.get('location').includes(invite.token), false)
  assert.equal((await open(flowCookie, env.SESSION_SECRET, 'login')).invitationToken, invite.token)
  assert.equal((await handle(new Request(env.APP_URL+'/auth/invite/continue', { method:'POST', headers:{ origin:'https://evil.example' } }), env)).status,403)
  const invalid = await handle(new Request(env.APP_URL+'/auth/invite?invitation_token=bad'), env)
  assert.equal(invalid.status, 403)
  assert.equal(invalid.headers.get('referrer-policy'), 'same-origin')
  assert.match(await invalid.text(), /This invitation is unavailable/)
})
test('callback redeems only after verified sign-in and replay does not grant another account', async () => {
  const { db, env } = setup(), invite = await create(env)
  const { flowCookie } = await startInvitation(env, invite.url)
  const flow = await open(flowCookie, env.SESSION_SECRET, 'login')
  const priorFetch = globalThis.fetch
  try {
    globalThis.fetch = async () => Response.json({ user: person() })
    const callback = () => new Request(`${env.APP_URL}/auth/callback?state=${encodeURIComponent(flow.state)}&code=test`, { headers: { cookie: `__Host-egm_flow=${flowCookie}` } })
    assert.equal((await handle(callback(), env)).status, 302)
    assert.equal(db.prepare("SELECT status FROM users WHERE id='guest'").get().status, 'approved')
    globalThis.fetch = async () => Response.json({ user: person('other', 'other@example.org') })
    assert.notEqual((await handle(callback(), env)).status, 302)
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM users WHERE id='other'").get().n, 0)
  } finally { globalThis.fetch = priorFetch }
})
test('expired or revoked invitation is rejected before and after the landing page', async () => {
  const { db, env } = setup(), expired = await create(env), revoked = await create(env)
  db.prepare('UPDATE invitations SET expires_at=? WHERE id=?').run(Date.now()-1, expired.id)
  assert.equal((await handle(new Request(expired.url), env)).status,403)
  const initial = await handle(new Request(revoked.url), env)
  const inviteCookie=initial.headers.get('set-cookie').match(/__Host-egm_invite=([^;]+)/)[1]
  db.prepare('UPDATE invitations SET revoked_at=? WHERE id=?').run(Date.now(),revoked.id)
  assert.equal((await handle(new Request(env.APP_URL+'/auth/invite',{headers:{cookie:`__Host-egm_invite=${inviteCookie}`}}),env)).status,403)
  assert.equal((await handle(new Request(env.APP_URL+'/auth/invite/continue',{method:'POST',headers:{origin:env.APP_URL,cookie:`__Host-egm_invite=${inviteCookie}`}}),env)).status,403)
})
test('wrong-account redemption gets its own page, keeps the invitation, and unrelated failures stay generic', async () => {
  const { db, env: base } = setup(), env = emailEnv(base)
  let invitationUrl
  const sent = await manageInvitations(emailRequest(), env, owner, async (url, init) => { invitationUrl = JSON.parse(init.body).text.match(/https:\/\/[^\s]+/)[0]; return Response.json({ id: 'email_123' }) })
  const invite = { id: (await sent.json()).id, url: invitationUrl }
  const { flowCookie } = await startInvitation(env, invite.url)
  const flow = await open(flowCookie, env.SESSION_SECRET, 'login')
  const priorFetch = globalThis.fetch
  const callback = async user => {
    globalThis.fetch = async () => Response.json({ user })
    return handle(new Request(`${env.APP_URL}/auth/callback?state=${encodeURIComponent(flow.state)}&code=test`, { headers: { cookie: `__Host-egm_flow=${flowCookie}` } }), env)
  }
  try {
    const wrong = await callback(person('other', 'other@example.org'))
    assert.equal(wrong.status, 403)
    const html = await wrong.text()
    assert.match(html, /Use the invited account/)
    assert.match(html, /href="\/auth\/invite" class="action">Try again/)
    assert.doesNotMatch(html, /guest@example\.org|other@example\.org/)
    assert.match(wrong.headers.get('set-cookie'), /__Host-egm_invite=/)
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM users WHERE id='other'").get().n, 0)
    db.prepare('UPDATE invitations SET revoked_at=? WHERE id=?').run(Date.now(), invite.id)
    const revoked = await callback(person('other', 'other@example.org'))
    assert.match(await revoked.text(), /This invitation is unavailable/)
  } finally { globalThis.fetch = priorFetch }
})
test('a previously denied person with a valid invitation sees accurate copy and is not approved', async () => {
  const { db, env } = setup(), invite = await create(env)
  db.prepare('INSERT INTO users(id,email,name,verified,status,created_at) VALUES(?,?,?,1,?,?)').run('guest', 'guest@example.org', 'Guest', 'denied', new Date().toISOString())
  const { flowCookie } = await startInvitation(env, invite.url)
  const flow = await open(flowCookie, env.SESSION_SECRET, 'login')
  const priorFetch = globalThis.fetch
  try {
    globalThis.fetch = async () => Response.json({ user: person() })
    const response = await handle(new Request(`${env.APP_URL}/auth/callback?state=${encodeURIComponent(flow.state)}&code=test`, { headers: { cookie: `__Host-egm_flow=${flowCookie}` } }), env)
    assert.equal(response.status, 403)
    const html = await response.text()
    assert.match(html, /declined earlier/)
    assert.doesNotMatch(html, /invitation is unavailable/)
    assert.equal(db.prepare("SELECT status FROM users WHERE id='guest'").get().status, 'denied')
  } finally { globalThis.fetch = priorFetch }
})
test('every failed invited sign-in returns to the invitation and creates no pending user', async () => {
  const { db, env } = setup(), invite = await create(env)
  const { continued, inviteCookie, flowCookie } = await startInvitation(env, invite.url)
  assert.match(continued.headers.get('set-cookie'), /__Host-egm_invite=[^;]+;.*Max-Age=3600/)
  const flow = await open(flowCookie, env.SESSION_SECRET, 'login')
  const callback = (query, cookies) => handle(new Request(`${env.APP_URL}/auth/callback?${query}`, { headers: { cookie: cookies } }), env)
  const priorFetch = globalThis.fetch
  try {
    globalThis.fetch = async () => Response.json({ user: { ...person(), email_verified: false } })
    for (const [title, query, cookies] of [
      ['Sign-in cancelled', `error=access_denied&state=${encodeURIComponent(flow.state)}`, `__Host-egm_flow=${flowCookie}`],
      ['Sign-in expired', 'code=test&state=other', `__Host-egm_flow=${flowCookie}`],
      ['Verify your email', `code=test&state=${encodeURIComponent(flow.state)}`, `__Host-egm_flow=${flowCookie}`],
      ['Sign-in expired', 'code=test&state=other', `__Host-egm_invite=${inviteCookie}`]
    ]) {
      const response = await callback(query, cookies)
      const html = await response.text()
      assert.match(html, new RegExp(title), title)
      assert.match(html, /href="\/auth\/invite" class="action"/, title)
      const kept = response.headers.get('set-cookie').match(/__Host-egm_invite=([^;]+)/)?.[1]
      assert.equal((await open(kept, env.SESSION_SECRET, 'invitation'))?.token, invite.token, title)
    }
  } finally { globalThis.fetch = priorFetch }
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM users WHERE id='guest'").get().n, 0)
})
test('an expired invitation cookie asks the person to reopen their link instead of a plain sign-in', async () => {
  const { env } = setup()
  for (const request of [new Request(env.APP_URL+'/auth/invite'), new Request(env.APP_URL+'/auth/invite/continue', { method: 'POST', headers: { origin: env.APP_URL } })]) {
    const response = await handle(request, env)
    assert.equal(response.status, 400)
    const html = await response.text()
    assert.match(html, /Open your invitation again/)
    assert.doesNotMatch(html, /\/auth\/login/)
    assert.equal(response.headers.get('location'), null)
  }
})
test('the invitation cookie ends when the invitation is redeemed or unusable', async () => {
  const { db, env } = setup(), invite = await create(env)
  const { flowCookie, inviteCookie } = await startInvitation(env, invite.url)
  const flow = await open(flowCookie, env.SESSION_SECRET, 'login')
  const callback = () => handle(new Request(`${env.APP_URL}/auth/callback?state=${encodeURIComponent(flow.state)}&code=test`, { headers: { cookie: `__Host-egm_flow=${flowCookie}; __Host-egm_invite=${inviteCookie}` } }), env)
  const priorFetch = globalThis.fetch
  try {
    globalThis.fetch = async () => Response.json({ user: person() })
    const signedIn = await callback()
    assert.equal(signedIn.status, 302)
    assert.match(signedIn.headers.get('set-cookie'), /__Host-egm_invite=;.*Max-Age=0/)
    globalThis.fetch = async () => Response.json({ user: person('other', 'other@example.org') })
    const used = await callback()
    const html = await used.text()
    assert.match(html, /This invitation is unavailable/)
    assert.match(html, /href="\/auth\/login" class="action"/)
    assert.match(used.headers.get('set-cookie'), /__Host-egm_invite=;.*Max-Age=0/)
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM users WHERE id='other'").get().n, 0)
  } finally { globalThis.fetch = priorFetch }
})
test('an internal callback failure retries through the invitation while its cookie lasts', async () => {
  const { env: base } = setup(), invite = await create(base)
  const { flowCookie, inviteCookie } = await startInvitation(base, invite.url)
  const flow = await open(flowCookie, base.SESSION_SECRET, 'login')
  const env = { ...base, DB: { prepare() { throw Error('d1 down') } } }
  const priorFetch = globalThis.fetch
  try {
    globalThis.fetch = async () => Response.json({ user: person() })
    const response = await (await import('./worker.mjs')).default.fetch(new Request(`${env.APP_URL}/auth/callback?state=${encodeURIComponent(flow.state)}&code=test`, { headers: { cookie: `__Host-egm_flow=${flowCookie}; __Host-egm_invite=${inviteCookie}` } }), env, {})
    assert.equal(response.status, 503)
    assert.match(await response.text(), /href="\/auth\/invite" class="action">Try again/)
  } finally { globalThis.fetch = priorFetch }
})
