import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { AUDIT_SCHEMA } from './boing-audit.mjs'
import { BOING_MEMBERSHIP_AUDIT_SCHEMA, handleMembershipRevocation } from './boing-membership-admin.mjs'

function fixture() {
  const sql = new DatabaseSync(':memory:')
  sql.exec('PRAGMA foreign_keys=ON')
  sql.exec(readFileSync(new URL('./boing-tenancy-schema.sql', import.meta.url), 'utf8'))
  sql.exec(AUDIT_SCHEMA)
  sql.exec(BOING_MEMBERSHIP_AUDIT_SCHEMA)
  sql.exec(`INSERT INTO boing_identities VALUES ('user_Owner','owner@example.com','active'),('user_Member','member@example.com','active'),('user_Other','other@example.com','active');
    INSERT INTO boing_organizations VALUES ('one','One','org_One','active',0,'now'),('two','Two','org_Two','active',0,'now');
    INSERT INTO boing_memberships VALUES ('one','user_Owner','owner','active','now'),('one','user_Member','member','active','now'),('two','user_Other','owner','active','now');
    INSERT INTO boing_projects VALUES ('p1','one','One',NULL,NULL,'active','now');
    INSERT INTO boing_project_memberships VALUES ('one','p1','user_Member','now');`)
  const db = { prepare(query) { return { bind(...args) { return {
    async first() { return sql.prepare(query).get(...args) ?? null },
    async run() { return { meta: { changes: Number(sql.prepare(query).run(...args).changes) } } }
  } } } }, async batch(statements) { sql.exec('BEGIN'); try { const result = []; for (const s of statements) result.push(await s.run()); sql.exec('COMMIT'); return result } catch (error) { sql.exec('ROLLBACK'); throw error } } }
  const env = { DB: db, APP_URL: 'https://app.test', WORKOS_API_KEY: 'test' }
  const owner = { id: 'user_Owner', status: 'active', verified: 1 }
  const provider = async url => { const query = new URL(url).searchParams; return Response.json({ object: 'list', data: [{ user_id: query.get('user_id'), organization_id: query.get('organization_id'), status: 'active' }], list_metadata: { after: null } }) }
  const call = (target, { actor = owner, org = 'one', origin = 'https://app.test', requestWorkos = provider } = {}) => handleMembershipRevocation(new Request(`https://app.test/api/boing/members/${target}/revoke`, { method: 'POST', headers: { origin } }), env, actor, org, { requestWorkos, now: 1800000000000 })
  return { sql, db, env, call }
}

test('revocation binds the original owner grant and rolls back on audit failure', async () => {
  for (const mode of ['success', 'provider_changed', 'binding_changed', 'audit_failure']) {
    const { sql, db, env, call } = fixture()
    sql.exec(readFileSync(new URL('./boing-membership-binding-migration.sql', import.meta.url), 'utf8'))
    sql.exec("INSERT INTO boing_workos_membership_bindings VALUES('one','user_Owner','om_123','2026-01-01T00:00:00.000Z')")
    env.BOING_MEMBERSHIP_BINDING_REQUIRED = 'true'
    let checks = 0
    const provider = async () => Response.json({ object: 'list', data: [{ id: 'om_123', user_id: 'user_Owner', organization_id: 'org_One', status: 'active', updated_at: mode === 'provider_changed' && ++checks > 1 ? '2026-01-02T00:00:00.000Z' : '2026-01-01T00:00:00.000Z' }], list_metadata: { after: null } })
    if (mode === 'binding_changed') { const batch = db.batch; db.batch = async statements => { sql.exec("UPDATE boing_workos_membership_bindings SET workos_updated_at='changed'"); return batch(statements) } }
    if (mode === 'audit_failure') sql.exec("CREATE TRIGGER fail_target BEFORE INSERT ON boing_membership_audit_targets BEGIN SELECT RAISE(ABORT, 'failure'); END")
    const result = await call('user_Member', { requestWorkos: provider })
    assert.equal(result.status, mode === 'success' ? 200 : mode === 'provider_changed' ? 403 : 503)
    assert.equal(sql.prepare("SELECT status FROM boing_memberships WHERE organization_id='one' AND user_id='user_Member'").get().status, mode === 'success' ? 'suspended' : 'active')
    assert.equal(sql.prepare('SELECT count(*) n FROM boing_project_memberships').get().n, mode === 'success' ? 0 : 1)
    assert.equal(sql.prepare('SELECT count(*) n FROM boing_audit_events').get().n, mode === 'success' ? 1 : 0)
  }
})

test('owner suspends only the selected local membership, removes grants and audits target', async () => {
  const { sql, call } = fixture()
  const response = await call('user_Member')
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { revoked: true, providerMembershipUnchanged: true })
  assert.equal(sql.prepare("SELECT status FROM boing_memberships WHERE organization_id='one' AND user_id='user_Member'").get().status, 'suspended')
  assert.equal(sql.prepare('SELECT count(*) n FROM boing_project_memberships').get().n, 0)
  assert.deepEqual({ ...sql.prepare('SELECT a.actor_id,a.action,t.target_user_id FROM boing_audit_events a JOIN boing_membership_audit_targets t ON t.event_id=a.id').get() }, { actor_id: 'user_Owner', action: 'membership.revoked', target_user_id: 'user_Member' })
  assert.equal((await call('user_Member')).status, 404)
})

test('cross-tenant, non-owner, self and origin violations do not modify access', async () => {
  const { sql, call } = fixture()
  assert.equal((await call('user_Owner')).status, 409)
  assert.equal((await call('user_Other')).status, 404)
  assert.equal((await call('user_Member', { origin: 'https://evil.test' })).status, 403)
  assert.equal((await call('user_Owner', { actor: { id: 'user_Member', status: 'active', verified: 1 } })).status, 403)
  assert.equal(sql.prepare("SELECT status FROM boing_memberships WHERE organization_id='one' AND user_id='user_Member'").get().status, 'active')
  assert.equal(sql.prepare('SELECT count(*) n FROM boing_audit_events').get().n, 0)
})

test('concurrent owner removals cannot remove the last active owner', async () => {
  const { sql, call } = fixture()
  sql.exec("INSERT INTO boing_memberships VALUES ('one','user_Other','owner','active','now')")
  const other = { id: 'user_Other', status: 'active', verified: 1 }
  const responses = await Promise.all([call('user_Other'), call('user_Owner', { actor: other })])
  assert.equal(responses.filter(result => result.status === 200).length, 1)
  assert.ok(responses.some(result => [403, 404, 503].includes(result.status)))
  assert.equal(sql.prepare("SELECT count(*) n FROM boing_memberships WHERE organization_id='one' AND role='owner' AND status='active'").get().n, 1)
})

test('provider revocation, remapping and audit failure prevent the mutation', async () => {
  for (const mode of ['revoked', 'unavailable', 'remapped', 'audit']) {
    const { sql, call } = fixture()
    if (mode === 'audit') sql.exec('DROP TABLE boing_membership_audit_targets')
    const requestWorkos = async () => {
      if (mode === 'unavailable') throw new Error('offline')
      if (mode === 'remapped') sql.exec("UPDATE boing_organizations SET workos_organization_id='org_Changed' WHERE id='one'")
      return Response.json({ object: 'list', data: [{ user_id: 'user_Owner', organization_id: 'org_One', status: mode === 'revoked' ? 'inactive' : 'active' }], list_metadata: { after: null } })
    }
    const result = await call('user_Member', { requestWorkos })
    assert.equal(result.status, mode === 'unavailable' || mode === 'audit' ? 503 : 403)
    assert.equal(sql.prepare("SELECT status FROM boing_memberships WHERE organization_id='one' AND user_id='user_Member'").get().status, 'active')
    assert.equal(sql.prepare('SELECT count(*) n FROM boing_project_memberships').get().n, 1)
  }
})
