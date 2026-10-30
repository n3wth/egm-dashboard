import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { handle, open, seal } from './worker.mjs'

const day = 86400
const clock = () => Math.floor(Date.now() / 1000)
function setup() {
  const db = new DatabaseSync(':memory:')
  db.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'))
  db.prepare("INSERT INTO users(id,email,name,verified,status,created_at) VALUES('user_a','a@example.org','A',1,'approved','2026-01-01')").run()
  const DB = { prepare(sql) { return { bind(...args) { return { async run() { const result = db.prepare(sql).run(...args); return { meta: { changes: Number(result.changes) } } }, async first() { return db.prepare(sql).get(...args) ?? null } } }, async first() { return db.prepare(sql).get() ?? null } } } }
  return { db, env: { DB, APP_URL: 'https://dashboard.example', OWNER_EMAIL: 'owner@example.org', SESSION_SECRET: 'a'.repeat(64), WORKOS_CLIENT_ID: 'client_test', POSTHOG_PROJECT_TOKEN: 'phc_test', POSTHOG_HOST: 'https://us.i.posthog.com' } }
}
const maxAge = response => Number(response.headers.get('set-cookie')?.match(/__Host-egm_session=[^;]+;.*Max-Age=(\d+)/)?.[1])
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) <= 2, `${actual} is not near ${expected}`)
async function visit(env, db, { cookieEndsAt, expiresAt }) {
  db.prepare('DELETE FROM sessions').run()
  db.prepare("INSERT INTO sessions VALUES('s1','user_a',?)").run(expiresAt)
  const token = await seal({ sid: 's1' }, env.SESSION_SECRET, 'session', cookieEndsAt - clock())
  const response = await handle(new Request(env.APP_URL + '/api/snapshot-version', { headers: { cookie: '__Host-egm_session=' + token } }), env)
  return { response, expiresAt: db.prepare("SELECT expires_at FROM sessions WHERE id='s1'").get()?.expires_at }
}

test('sign-in starts a 7-day session and records a sign-in event', async () => {
  const { db, env } = setup()
  const login = await handle(new Request(env.APP_URL + '/auth/login'), env)
  const flowCookie = login.headers.get('set-cookie').match(/__Host-egm_flow=([^;]+)/)[1]
  const flow = await open(flowCookie, env.SESSION_SECRET, 'login')
  const priorFetch = globalThis.fetch, captured = [], pending = []
  try {
    globalThis.fetch = async (url, init) => {
      if (String(url).startsWith('https://us.i.posthog.com/')) { captured.push(JSON.parse(init.body)); return new Response(null) }
      return Response.json({ user: { id: 'user_a', email: 'a@example.org', email_verified: true } })
    }
    const response = await handle(new Request(`${env.APP_URL}/auth/callback?state=${encodeURIComponent(flow.state)}&code=test`, { headers: { cookie: `__Host-egm_flow=${flowCookie}` } }), env, { waitUntil: promise => pending.push(promise) })
    await Promise.all(pending)
    assert.equal(response.status, 302)
    assert.equal(maxAge(response), 30 * day)
    const token = response.headers.get('set-cookie').match(/__Host-egm_session=([^;]+)/)[1]
    const session = await open(token, env.SESSION_SECRET, 'session')
    near(session.exp, clock() + 30 * day)
    near(db.prepare('SELECT expires_at FROM sessions WHERE id=?').get(session.sid).expires_at, clock() + 7 * day)
    assert.deepEqual(captured.map(({ distinct_id, event, properties }) => ({ distinct_id, event, properties })), [{ distinct_id: 'user_a', event: 'dashboard_signed_in', properties: { $geoip_disable: true } }])
  } finally { globalThis.fetch = priorFetch }
})

test('activity extends the session to 7 days after the last visit', async () => {
  const { db, env } = setup()
  const { response, expiresAt } = await visit(env, db, { cookieEndsAt: clock() + 27 * day, expiresAt: clock() + 2 * day })
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('set-cookie'), null)
  near(expiresAt, clock() + 7 * day)
})

test('renewal never extends a session past the signed cookie, 30 days after sign-in', async () => {
  const { db, env } = setup()
  const capped = await visit(env, db, { cookieEndsAt: clock() + day / 2, expiresAt: clock() + 3600 })
  assert.equal(capped.response.status, 200)
  near(capped.expiresAt, clock() + day / 2)
  const final = await visit(env, db, { cookieEndsAt: clock() + 600, expiresAt: clock() + 600 })
  assert.equal(final.response.status, 200)
  near(final.expiresAt, clock() + 600)
})

test('a session renewed within the last hour is not rewritten', async () => {
  const { db, env } = setup()
  const { response, expiresAt } = await visit(env, db, { cookieEndsAt: clock() + 30 * day, expiresAt: clock() + 7 * day - 60 })
  assert.equal(response.status, 200)
  near(expiresAt, clock() + 7 * day - 60)
})

test('an idle session ends after 7 days and shows the session ended page', async () => {
  const { db, env } = setup()
  const { response, expiresAt } = await visit(env, db, { cookieEndsAt: clock() + 20 * day, expiresAt: clock() - 1 })
  assert.equal(response.status, 401)
  near(expiresAt, clock() - 1)
  const token = await seal({ sid: 's1' }, env.SESSION_SECRET, 'session', 20 * day)
  const page = await handle(new Request(env.APP_URL + '/overview', { headers: { cookie: '__Host-egm_session=' + token } }), env)
  assert.match(await page.text(), /Your session ended/)
})
