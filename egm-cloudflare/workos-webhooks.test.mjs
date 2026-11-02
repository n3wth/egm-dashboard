import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { handleWorkosWebhook, verifyWorkosWebhook } from './workos-webhooks.mjs'
import { handle } from './worker.mjs'

const encoder = new TextEncoder()
const secret = 'whsec_test_secret_value'
async function sign(body, timestamp = Date.now()) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(`${timestamp}.${body}`)))
  const hex = [...mac].map(byte => byte.toString(16).padStart(2, '0')).join('')
  return `t=${timestamp}, v1=${hex}`
}
function database() {
  const db = new DatabaseSync(':memory:')
  db.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'))
  db.exec(readFileSync(new URL('./workos-session-schema.sql', import.meta.url), 'utf8'))
  db.prepare('INSERT INTO users(id,email,name,verified,status,created_at) VALUES(?,?,?,1,?,?)').run('user_a', 'a@example.com', 'A', 'approved', '2026-01-01T00:00:00.000Z')
  db.prepare('INSERT INTO sessions(id,user_id,expires_at) VALUES(?,?,?)').run('local', 'user_a', 9999999999)
  db.prepare('INSERT INTO workos_sessions(session_id,user_id,tokens,provider_session_id) VALUES(?,?,?,?)').run('local', 'user_a', 'encrypted', 'session_provider')
  const DB = {
    prepare(sql) {
      const statement = {
        args: [],
        bind(...args) { return { ...this, args } },
        async run() { const result = db.prepare(sql).run(...this.args); return { meta: { changes: Number(result.changes) } } },
        async first() { return db.prepare(sql).get(...this.args) ?? null },
        async all() { return { results: db.prepare(sql).all(...this.args) } },
      }
      return statement
    },
  }
  return { db, env: { DB, WORKOS_WEBHOOK_SECRET: secret, WORKOS_RBAC_ORGANIZATION_ID: 'org_123', WORKOS_API_KEY: 'secret', APP_URL: 'https://egm.example', SESSION_SECRET: 's'.repeat(64) } }
}
const post = (env, body, signature) => new Request(`${env.APP_URL}/webhooks/workos`, { method: 'POST', headers: { 'workos-signature': signature }, body })

test('rejects missing, stale and forged WorkOS signatures', async () => {
  const body = '{"id":"event_1","event":"user.deleted","data":{"id":"user_a"}}'
  assert.equal(await verifyWorkosWebhook(secret, await sign(body, Date.now() - 360000), body), false)
  assert.equal(await verifyWorkosWebhook(secret, 't=1, v1=abcd', body), false)
  assert.equal(await verifyWorkosWebhook('short', await sign(body), body), false)
  assert.equal(await verifyWorkosWebhook(secret, await sign(body), body), true)
})

test('user deletion revokes local access once and ignores a replay', async () => {
  const { db, env } = database()
  const body = JSON.stringify({ id: 'event_delete', event: 'user.deleted', data: { id: 'user_a', object: 'user' } })
  const response = await handleWorkosWebhook(post(env, body, await sign(body)), env)
  assert.equal(response.status, 200)
  assert.equal(db.prepare('SELECT status FROM users WHERE id=?').get('user_a').status, 'denied')
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 0)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM workos_sessions').get().n, 0)
  db.prepare("UPDATE users SET status='approved' WHERE id='user_a'").run()
  assert.equal((await handleWorkosWebhook(post(env, body, await sign(body)), env)).status, 200)
  assert.equal(db.prepare('SELECT status FROM users WHERE id=?').get('user_a').status, 'approved')
})

test('membership updates revoke inactive members and record a role change without blocking on WorkOS', async () => {
  const { db, env } = database()
  const calls = []
  const fetcher = async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return new Response(null, { status: 500 }) }
  const active = JSON.stringify({ id: 'event_role', event: 'organization_membership.updated', data: { id: 'om_1', user_id: 'user_a', organization_id: 'org_123', status: 'active', role: { slug: 'admin' } } })
  assert.equal((await handleWorkosWebhook(post(env, active, await sign(active)), env, fetcher)).status, 200)
  assert.equal(db.prepare('SELECT status FROM users').get().status, 'approved')
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 1)
  assert.equal(calls[0].body.event.action, 'egm.access.role_changed')
  assert.equal(calls[0].body.event.metadata.role, 'admin')
  const other = JSON.stringify({ id: 'event_otherorg', event: 'organization_membership.deleted', data: { user_id: 'user_a', organization_id: 'org_other' } })
  assert.equal((await handleWorkosWebhook(post(env, other, await sign(other)), env, fetcher)).status, 200)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 1)
  const inactive = JSON.stringify({ id: 'event_inactive', event: 'organization_membership.updated', data: { user_id: 'user_a', organization_id: 'org_123', status: 'inactive', role: { slug: 'member' } } })
  assert.equal((await handleWorkosWebhook(post(env, inactive, await sign(inactive)), env, async () => { throw Error('down') })).status, 200)
  assert.equal(db.prepare('SELECT status FROM users').get().status, 'denied')
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 0)
})

test('a revoked provider session deletes only the matching local session', async () => {
  const { db, env } = database()
  db.prepare('INSERT INTO sessions(id,user_id,expires_at) VALUES(?,?,?)').run('other', 'user_a', 9999999999)
  db.prepare('INSERT INTO workos_sessions(session_id,user_id,tokens,provider_session_id) VALUES(?,?,?,?)').run('other', 'user_a', 'encrypted', 'session_other')
  const body = JSON.stringify({ id: 'event_session', event: 'session.revoked', data: { id: 'session_provider', object: 'session', user_id: 'user_a' } })
  assert.equal((await handleWorkosWebhook(post(env, body, await sign(body)), env)).status, 200)
  assert.deepEqual(db.prepare('SELECT id FROM sessions').all().map(row => row.id), ['other'])
  const forged = JSON.stringify({ id: 'event_forged', event: 'session.revoked', data: { id: 'session_provider' } })
  assert.equal((await handle(new Request(`${env.APP_URL}/webhooks/workos`, { method: 'POST', headers: { 'workos-signature': 't=1, v1=nope' }, body: forged }), env)).status, 401)
  assert.equal((await handle(new Request(`${env.APP_URL}/webhooks/workos`, { method: 'GET' }), env)).status, 405)
})
