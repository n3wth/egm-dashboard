import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { AUDIT_SCHEMA } from './boing-audit.mjs'
import { reconcileMembershipBinding } from './boing-membership-reconcile.mjs'

function fixture() {
  const sql = new DatabaseSync(':memory:')
  sql.exec('PRAGMA foreign_keys=ON')
  sql.exec(readFileSync(new URL('./boing-tenancy-schema.sql', import.meta.url), 'utf8'))
  sql.exec(readFileSync(new URL('./boing-membership-binding-migration.sql', import.meta.url), 'utf8'))
  sql.exec(AUDIT_SCHEMA)
  sql.exec(`INSERT INTO boing_identities VALUES('user_Operator','op@example.com','active'),('user_Target','target@example.com','active');
    INSERT INTO boing_organizations VALUES('org-local','Workspace','org_123','active',0,'now');
    INSERT INTO boing_memberships VALUES('org-local','user_Target','member','active','now');
    INSERT INTO boing_workos_membership_bindings VALUES('org-local','user_Target','om_old','2026-01-01T00:00:00.000Z');`)
  const DB = { prepare(query) { return { bind(...args) { return {
    async first() { return sql.prepare(query).get(...args) ?? null },
    async run() { return { meta: { changes: Number(sql.prepare(query).run(...args).changes) } } },
  } } } }, async batch(statements) {
    sql.exec('BEGIN')
    try { const result = []; for (const statement of statements) result.push(await statement.run()); sql.exec('COMMIT'); return result } catch (error) { sql.exec('ROLLBACK'); throw error }
  } }
  const env = { DB, WORKOS_API_KEY: 'test' }
  const input = { actorId: 'user_Operator', organizationId: 'org-local', userId: 'user_Target', workosOrganizationId: 'org_123', role: 'member', email: 'target@example.com', previous: { membershipId: 'om_old', updatedAt: '2026-01-01T00:00:00.000Z' }, approved: { membershipId: 'om_new', updatedAt: '2026-01-02T00:00:00.000Z' } }
  const request = async url => url.includes('/users/')
    ? Response.json({ id: 'user_Target', email: input.email, email_verified: true })
    : Response.json({ object: 'list', data: [{ id: 'om_new', user_id: 'user_Target', organization_id: 'org_123', status: 'active', updated_at: input.approved.updatedAt }], list_metadata: { after: null } })
  const invoke = (override = {}, options = {}) => reconcileMembershipBinding(env, { ...input, ...override }, { request, now: Date.parse('2026-01-03T00:00:00Z'), ...options })
  return { sql, DB, env, input, request, invoke }
}

test('explicitly approved binding is replaced with an atomic audit event', async () => {
  const { sql, invoke } = fixture()
  assert.deepEqual(await invoke(), { status: 'updated' })
  const row = sql.prepare('SELECT workos_membership_id,workos_updated_at FROM boing_workos_membership_bindings').get()
  assert.equal(row.workos_membership_id, 'om_new')
  assert.equal(row.workos_updated_at, '2026-01-02T00:00:00.000Z')
  assert.equal(sql.prepare('SELECT action FROM boing_audit_events').get().action, 'membership.reauthorized')
  assert.notEqual((await invoke()).status, 'updated')
  assert.equal(sql.prepare('SELECT count(*) AS n FROM boing_audit_events').get().n, 1)
})

test('missing binding, inactive user, changed role or duplicate identity fails closed', async () => {
  for (const statement of [
    'DELETE FROM boing_workos_membership_bindings',
    "UPDATE boing_identities SET status='suspended' WHERE user_id='user_Target'",
    "UPDATE boing_memberships SET role='admin' WHERE user_id='user_Target'",
    "UPDATE boing_organizations SET workos_organization_id='org_Other'",
    "INSERT INTO boing_identities VALUES('user_Duplicate','target@example.com','active')",
  ]) {
    const { sql, invoke } = fixture()
    sql.exec(statement)
    assert.equal((await invoke()).status, 'denied')
    assert.equal(sql.prepare('SELECT count(*) AS n FROM boing_audit_events').get().n, 0)
  }
})

test('provider failure, wrong identity, and changed version cannot authorize', async () => {
  const { sql, request, invoke } = fixture()
  assert.notEqual((await invoke({}, { request: async () => new Response(null, { status: 503 }) })).status, 'updated')
  assert.equal((await invoke({}, { request: async url => url.includes('/users/') ? Response.json({ id: 'user_Target', email: 'wrong@example.com', email_verified: true }) : request(url) })).status, 'denied')
  assert.equal((await invoke({ approved: { membershipId: 'om_wrong', updatedAt: '2026-01-02T00:00:00.000Z' } })).status, 'denied')
  assert.equal(sql.prepare('SELECT workos_membership_id FROM boing_workos_membership_bindings').get().workos_membership_id, 'om_old')
})

test('concurrent updates or audit failures never leave an unaudited change', async () => {
  const { sql, invoke } = fixture()
  const results = await Promise.all([invoke(), invoke()])
  assert.equal(results.filter(result => result.status === 'updated').length, 1)
  assert.equal(sql.prepare('SELECT count(*) AS n FROM boing_audit_events').get().n, 1)
  const other = fixture()
  other.sql.exec('DROP TABLE boing_audit_events')
  assert.equal((await other.invoke()).status, 'unavailable')
  assert.equal(other.sql.prepare('SELECT workos_membership_id FROM boing_workos_membership_bindings').get().workos_membership_id, 'om_old')
})

test('role changes during provider verification prevent reconciliation', async () => {
  const { sql, request, invoke } = fixture()
  let changed = false
  const transport = async url => {
    if (!changed) { changed = true; sql.exec("UPDATE boing_memberships SET role='admin' WHERE user_id='user_Target'") }
    return request(url)
  }
  assert.equal((await invoke({}, { request: transport })).status, 'denied')
  assert.equal(sql.prepare('SELECT count(*) AS n FROM boing_audit_events').get().n, 0)
})

test('a local version change during the final provider check rolls back the write', async () => {
  const { sql, request, invoke } = fixture()
  let calls = 0
  const transport = async url => {
    calls++
    if (calls === 3) sql.exec("UPDATE boing_workos_membership_bindings SET workos_updated_at='2026-01-01T01:00:00.000Z'")
    return request(url)
  }
  assert.notEqual((await invoke({}, { request: transport })).status, 'updated')
  assert.equal(sql.prepare('SELECT workos_membership_id FROM boing_workos_membership_bindings').get().workos_membership_id, 'om_old')
  assert.equal(sql.prepare('SELECT count(*) AS n FROM boing_audit_events').get().n, 0)
})
