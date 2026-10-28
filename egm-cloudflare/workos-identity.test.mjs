import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readVerifiedWorkosEmail, reconcileVerifiedEmail } from './workos-identity.mjs'
import { isDashboardOwner } from './owner-identity.mjs'

function fixture() {
  const db = new DatabaseSync(':memory:')
  db.exec("CREATE TABLE users(id TEXT PRIMARY KEY,email TEXT UNIQUE,status TEXT,verified INTEGER); CREATE TABLE audit(id TEXT,user_id TEXT,action TEXT,actor TEXT,created_at TEXT); INSERT INTO users VALUES('user_owner','owner@example.com','approved',1),('user_pending','pending@example.com','pending',1),('user_denied','denied@example.com','denied',1)")
  const DB = { prepare(sql) { return { bind(...args) { return { sql, args, async first() { return db.prepare(sql).get(...args) ?? null } } } } }, async batch(statements) { return statements.map(({ sql, args }) => ({ meta: { changes: Number(db.prepare(sql).run(...args).changes) } })) } }
  return { db, env: { DB, OWNER_EMAIL: 'owner@example.com', WORKOS_OWNER_USER_ID: 'user_owner', WORKOS_API_KEY: 'fixture-secret' } }
}
test('read WorkOS identity only by exact subject with verified valid email', async () => {
  const { env } = fixture()
  const result = await readVerifiedWorkosEmail(env, 'user_owner', async (url, init) => {
    assert.equal(url, 'https://api.workos.com/user_management/users/user_owner')
    assert.equal(init.redirect, 'manual')
    return Response.json({ id: 'user_owner', email: ' New@Example.com ', email_verified: true })
  })
  assert.equal(result, 'new@example.com')
  for (const item of [{ id: 'user_other', email: 'x@example.com', email_verified: true }, { id: 'user_owner', email: 'x@example.com', email_verified: false }, { id: 'user_owner', email: 'invalid', email_verified: true }]) assert.equal(await readVerifiedWorkosEmail(env, 'user_owner', async () => Response.json(item)), null)
  assert.equal(await readVerifiedWorkosEmail(env, 'user_owner', async () => { throw Error('secret') }), null)
})
test('verified email changes preserve local decision and create one audit entry', async () => {
  for (const state of ['pending', 'denied']) {
    const { db, env } = fixture(), id = `user_${state}`
    const existing = db.prepare('SELECT * FROM users WHERE id=?').get(id)
    assert.equal(await reconcileVerifiedEmail(env, existing, 'updated@example.com'), 'updated')
    assert.equal(db.prepare('SELECT status FROM users WHERE id=?').get(id).status, state)
    assert.equal(db.prepare('SELECT action FROM audit').get().action, 'email_updated')
    assert.equal(await reconcileVerifiedEmail(env, existing, 'updated@example.com'), 'unchanged')
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM audit').get().n, 1)
  }
})
test('email collisions and unpinned owner transfers do not change identity', async () => {
  const { db, env } = fixture(), pending = db.prepare("SELECT * FROM users WHERE id='user_pending'").get()
  assert.equal(await reconcileVerifiedEmail(env, pending, 'denied@example.com'), 'conflict')
  assert.equal(db.prepare('SELECT email FROM users WHERE id=?').get(pending.id).email, pending.email)
  const unpinned = { ...env, WORKOS_OWNER_USER_ID: '' }
  const owner = db.prepare("SELECT * FROM users WHERE id='user_owner'").get()
  assert.equal(await reconcileVerifiedEmail(unpinned, owner, 'new@example.com'), 'conflict')
  assert.equal(await reconcileVerifiedEmail(unpinned, pending, 'owner@example.com'), 'conflict')
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM audit').get().n, 0)
})
test('pinned owner retains privileges after verified email change and old email cannot transfer them', async () => {
  const { db, env } = fixture(), owner = db.prepare("SELECT * FROM users WHERE id='user_owner'").get()
  assert.equal(await reconcileVerifiedEmail(env, owner, 'new@example.com'), 'updated')
  assert.equal(isDashboardOwner(db.prepare('SELECT * FROM users WHERE id=?').get(owner.id), env), true)
  assert.equal(isDashboardOwner({ id: 'user_other', email: 'owner@example.com' }, env), false)
  assert.equal(isDashboardOwner({ id: owner.id, email: 'new@example.com' }, { ...env, WORKOS_OWNER_USER_ID: 'invalid' }), false)
})
