import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { AUDIT_SCHEMA, recordAuditEvent as recordScopedAuditEvent, listAuditEvents } from './boing-audit.mjs'
import { BOING_IDENTITY_SCHEMA } from './boing-identity.mjs'
const recordAuditEvent = (db, actor, { organizationId, ...event }) => recordScopedAuditEvent(db, actor, organizationId, event)

// No legacy users table: identities come only from BOING_IDENTITY_SCHEMA.
function setup() {
  const sql = new DatabaseSync(':memory:')
  sql.exec('PRAGMA foreign_keys=ON')
  sql.exec(BOING_IDENTITY_SCHEMA)
  sql.exec(readFileSync(new URL('./boing-tenancy-schema.sql', import.meta.url), 'utf8'))
  sql.exec(AUDIT_SCHEMA)
  sql.exec(`INSERT INTO boing_identities(user_id,email,status) VALUES
    ('owner','o@example.com','active'),('member','m@example.com','active'),('other','x@example.com','active');
    INSERT INTO boing_organizations VALUES('a','A','wa','active',0,'now'),('b','B','wb','active',0,'now');
    INSERT INTO boing_projects VALUES('pa','a','A','a/a',NULL,'active','now'),('private','a','Private','a/private',NULL,'active','now'),('pb','b','B','b/b',NULL,'active','now');
    INSERT INTO boing_memberships VALUES('a','owner','owner','active','now'),('a','member','member','active','now'),('b','other','owner','active','now');
    INSERT INTO boing_project_memberships VALUES('a','pa','member','now');`)
  const db = { prepare(query) { return { bind(...args) { return {
    async run() { return { meta: { changes: Number(sql.prepare(query).run(...args).changes) } } },
    async all() { return { results: sql.prepare(query).all(...args) } },
  } } } } }
  return { db, sql }
}
// Shape of authenticateBoingSession(...).user in boing-identity.mjs.
const actor = id => ({ id, email: `${id}@example.com`, verified: 1, status: 'active' })

test('records scoped fixed events and allows only the organization owner to read them', async () => {
  const { db } = setup()
  assert.equal(await recordAuditEvent(db, actor('member'), { organizationId: 'a', projectId: 'pa', action: 'project.exported' }), true)
  assert.equal(await recordAuditEvent(db, actor('other'), { organizationId: 'b', projectId: 'pb', action: 'project.viewed' }), true)
  const entries = await listAuditEvents(db, actor('owner'), 'a')
  assert.equal(entries.length, 1)
  assert.equal(entries[0].action, 'project.exported')
  assert.equal(entries[0].actor_id, 'member')
  assert.deepEqual(await listAuditEvents(db, actor('member'), 'a'), [])
  assert.deepEqual(await listAuditEvents(db, actor('owner'), 'b'), [])
})

test('rejects invalid scope, revoked access and arbitrary event content', async () => {
  const { db, sql } = setup()
  assert.equal(await recordAuditEvent(db, actor('member'), { organizationId: 'b', projectId: 'pb', action: 'project.viewed' }), false)
  assert.equal(await recordAuditEvent(db, actor('member'), { organizationId: 'a', projectId: 'private', action: 'project.viewed' }), false)
  assert.equal(await recordAuditEvent(db, actor('member'), { organizationId: 'a', projectId: 'pb', action: 'project.viewed' }), false)
  assert.equal(await recordAuditEvent(db, actor('member'), { organizationId: 'a', action: 'secret-token' }), false)
  assert.equal(await recordAuditEvent(db, { ...actor('member'), verified: 0 }, { organizationId: 'a', action: 'ai.enabled' }), false)
  sql.exec("DELETE FROM boing_project_memberships WHERE project_id='pa' AND user_id='member'")
  assert.equal(await recordAuditEvent(db, actor('member'), { organizationId: 'a', projectId: 'pa', action: 'project.viewed' }), false)
  sql.exec("UPDATE boing_memberships SET status='suspended' WHERE user_id='owner'")
  assert.deepEqual(await listAuditEvents(db, actor('owner'), 'a'), [])
  assert.equal(await recordAuditEvent(db, actor('owner'), { organizationId: 'a', action: 'ai.enabled' }), false)
  assert.equal(sql.prepare('SELECT COUNT(*) AS count FROM boing_audit_events').get().count, 0)
})

test('only active Boing identities can record or read; legacy user shapes are rejected', async () => {
  const { db, sql } = setup()
  assert.equal(await recordAuditEvent(db, { id: 'owner', status: 'approved', verified: 1 }, { organizationId: 'a', action: 'ai.enabled' }), false)
  assert.equal(await recordAuditEvent(db, { ...actor('owner'), status: 'suspended' }, { organizationId: 'a', action: 'ai.enabled' }), false)
  assert.equal(await recordAuditEvent(db, actor('ghost'), { organizationId: 'a', action: 'ai.enabled' }), false)
  assert.equal(await recordAuditEvent(db, actor('owner'), { organizationId: 'a', action: 'ai.enabled' }), true)
  // A stale actor object cannot outlive suspension of the stored identity.
  sql.exec("UPDATE boing_identities SET status='suspended' WHERE user_id='owner'")
  assert.equal(await recordAuditEvent(db, actor('owner'), { organizationId: 'a', action: 'ai.disabled' }), false)
  assert.deepEqual(await listAuditEvents(db, actor('owner'), 'a'), [])
  sql.exec("UPDATE boing_identities SET status='active' WHERE user_id='owner'")
  assert.equal((await listAuditEvents(db, actor('owner'), 'a')).length, 1)
  assert.equal(sql.prepare('SELECT COUNT(*) AS count FROM boing_audit_events').get().count, 1)
})

test('bounds audit list and rejects invalid limits', async () => {
  const { db } = setup()
  for (let i = 0; i < 3; i++) assert.equal(await recordAuditEvent(db, actor('owner'), { organizationId: 'a', action: 'ai.enabled' }), true)
  assert.equal((await listAuditEvents(db, actor('owner'), 'a', 2)).length, 2)
  assert.deepEqual(await listAuditEvents(db, actor('owner'), 'a', 101), [])
})

test('audit operations cannot select a project outside their server-verified organization', async () => {
  const { db, sql } = setup()
  sql.exec("INSERT INTO boing_memberships VALUES('b','owner','owner','active','now')")
  assert.equal(await recordScopedAuditEvent(db, actor('owner'), 'a', { projectId: 'pb', action: 'project.viewed' }), false)
  assert.equal(await recordScopedAuditEvent(db, actor('owner'), 'b', { projectId: 'pb', action: 'project.viewed' }), true)
  assert.deepEqual(await listAuditEvents(db, actor('owner'), 'a'), [])
  assert.equal((await listAuditEvents(db, actor('owner'), 'b')).length, 1)
  assert.equal(await recordScopedAuditEvent(db, actor('owner'), undefined, { action: 'ai.enabled' }), false)
})
