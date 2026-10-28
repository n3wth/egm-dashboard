import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { syncWorkosMember, syncWorkosMemberships } from './workos-membership.mjs'

function fixture() {
  const db = new DatabaseSync(':memory:')
  db.exec("CREATE TABLE sessions(id TEXT PRIMARY KEY); CREATE TABLE users(id TEXT PRIMARY KEY,email TEXT,verified INTEGER,status TEXT); INSERT INTO users VALUES('user_owner','owner@example.com',1,'approved'),('user_approved','member@example.com',1,'approved'),('user_pending','pending@example.com',1,'pending'),('user_denied','denied@example.com',1,'denied')")
  db.exec(readFileSync(new URL('./workos-session-schema.sql', import.meta.url), 'utf8'))
  const DB = { prepare(sql) { return { bind(...args) { return { async run() { const result = db.prepare(sql).run(...args); return { meta: { changes: Number(result.changes) } } }, async first() { return db.prepare(sql).get(...args) ?? null }, async all() { return { results: db.prepare(sql).all(...args) } } } } } } }
  return { db, env: { DB, WORKOS_RBAC_ENABLED: 'true', WORKOS_CLIENT_ID: 'client_123', WORKOS_RBAC_ORGANIZATION_ID: 'org_123', WORKOS_RBAC_ISSUER: 'https://api.workos.com', WORKOS_API_KEY: 'secret', SESSION_SECRET: 'a'.repeat(64), OWNER_EMAIL: 'owner@example.com' } }
}
const empty = () => Response.json({ data: [], list_metadata: { before: null, after: null } })

test('only approved verified non-owner users may create a least-privilege EGM membership', async () => {
  const { env, db } = fixture(), calls = []
  const request = async (url, options) => {
    calls.push({ url, options })
    if (!options.method) {
      const query = new URL(url).searchParams
      assert.equal(query.get('user_id'), 'user_approved')
      assert.equal(query.get('organization_id'), 'org_123')
      assert.equal(query.get('statuses'), 'active,inactive,pending')
      return empty()
    }
    assert.deepEqual(JSON.parse(options.body), { user_id: 'user_approved', organization_id: 'org_123', role_slug: 'member' })
    return Response.json({ user_id: 'user_approved', organization_id: 'org_123', status: 'active', role: { slug: 'member' } })
  }
  for (const user of ['user_owner', 'user_pending', 'user_denied']) assert.equal((await syncWorkosMember(env, user, { request })).status, 'not_eligible')
  assert.equal(calls.length, 0)
  assert.equal((await syncWorkosMember(env, 'user_approved', { request })).status, 'active')
  assert.equal(calls.length, 2)
  assert.equal(db.prepare('SELECT state FROM workos_membership_sync').get().state, 'active')
  assert.equal((await syncWorkosMember(env, 'user_approved', { request })).status, 'deferred')
  assert.equal(calls.length, 2)
})

test('existing active, inactive and pending memberships are never rewritten or reactivated', async () => {
  for (const status of ['active', 'inactive', 'pending']) {
    const { env } = fixture(); let calls = 0
    const request = async (url, options) => {
      calls++
      assert.equal(options.method, undefined)
      return Response.json({ data: [{ user_id: 'user_approved', organization_id: 'org_123', status, role: { slug: 'admin' } }], list_metadata: { before: 'om_1', after: null } })
    }
    assert.equal((await syncWorkosMember(env, 'user_approved', { request })).status, status === 'active' ? 'active' : 'inactive')
    assert.equal(calls, 1)
  }
})

test('transient failures retry without changing local approval; cron skips noneligible users', async () => {
  const { env, db } = fixture(); let calls = 0
  const request = async () => { calls++; throw Error('secret provider error') }
  assert.deepEqual(await syncWorkosMemberships(env, { request, now: () => 1000000 }), { status: 'checked', attempted: 1 })
  assert.equal(calls, 1)
  assert.equal(db.prepare("SELECT status FROM users WHERE id='user_approved'").get().status, 'approved')
  const saved = db.prepare('SELECT state,next_attempt FROM workos_membership_sync').get()
  assert.equal(saved.state, 'retry')
  assert.equal(saved.next_attempt, 2800000)
  assert.deepEqual(await syncWorkosMemberships(env, { request, now: () => 1000001 }), { status: 'checked', attempted: 0 })
})

test('malformed or incomplete provider results never create a membership', async () => {
  for (const response of [{ data: [], list_metadata: { before: 'om_later', after: null } }, { data: [], list_metadata: {} }, { data: [{ user_id: 'other', organization_id: 'org_123', status: 'inactive' }], list_metadata: {before: null, after: null} }, { data: [] }]) {
    const { env } = fixture(); let calls = 0
    const result = await syncWorkosMember(env, 'user_approved', { request: async () => { calls++; return Response.json(response) } })
    assert.equal(result.status, 'retry')
    assert.equal(calls, 1)
  }
})

test('concurrent reconciliation is leased and a user denied during lookup is not provisioned', async () => {
  const { env, db } = fixture(); let release, began, calls = 0
  const wait = new Promise(resolve => { release = resolve })
  const started = new Promise(resolve => { began = resolve })
  const request = async () => { calls++; began(); await wait; return empty() }
  const first = syncWorkosMember(env, 'user_approved', { request, now: () => 1000000 })
  await started
  assert.equal((await syncWorkosMember(env, 'user_approved', { request, now: () => 1000000 })).status, 'deferred')
  db.prepare("UPDATE users SET status='denied' WHERE id='user_approved'").run()
  release()
  assert.equal((await first).status, 'not_eligible')
  assert.equal(calls, 1)
})
