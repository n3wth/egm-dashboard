import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { resolveBoingContext } from './boing-context.mjs'

const user = { id: 'user_123', verified: 1, status: 'active' }
function setup() {
  const sql = new DatabaseSync(':memory:')
  sql.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'))
  sql.exec(readFileSync(new URL('./boing-tenancy-schema.sql', import.meta.url), 'utf8'))
  sql.exec(`INSERT INTO users(id,email,name,verified,status,created_at) VALUES('user_123','a@example.com','A',1,'approved','now');
    INSERT INTO boing_identities SELECT id,email,'active' FROM users WHERE status='approved' AND verified=1;
    INSERT INTO boing_organizations VALUES('a','A','org_A','active',0,'now'),('b','B','org_B','active',0,'now');
    INSERT INTO boing_memberships VALUES('a','user_123','owner','active','now'),('b','user_123','member','active','now');`)
  const DB = { prepare(query) { return { bind(...args) { return { async first() { return sql.prepare(query).get(...args) ?? null } } } } } }
  return { sql, env: { DB, WORKOS_API_KEY: 'test' } }
}
function workos(userId = 'user_123', organizationId = 'org_A', status = 'active') {
  return Response.json({ object: 'list', data: [{ user_id: userId, organization_id: organizationId, status }], list_metadata: { after: null } })
}

test('resolves exact server-mapped organization with fresh WorkOS verification', async () => {
  const { env } = setup()
  let calls = 0
  const result = await resolveBoingContext(env, user, 'a', async url => {
    calls++
    const parsed = new URL(url)
    assert.equal(parsed.searchParams.get('user_id'), user.id)
    assert.equal(parsed.searchParams.get('organization_id'), 'org_A')
    return workos()
  })
  assert.deepEqual(result, { status: 'allowed', organizationId: 'a', userId: user.id, role: 'owner' })
  assert.equal(calls, 1)
})

test('denies wrong org, stale WorkOS membership, missing mapping and invalid identity', async () => {
  const { env, sql } = setup()
  let calls = 0
  const verify = async () => { calls++; return workos() }
  assert.deepEqual(await resolveBoingContext(env, user, 'missing', verify), { status: 'denied' })
  assert.deepEqual(await resolveBoingContext(env, { ...user, verified: 0 }, 'a', verify), { status: 'denied' })
  assert.deepEqual(await resolveBoingContext(env, user, '../a', verify), { status: 'denied' })
  assert.equal(calls, 0)
  assert.deepEqual(await resolveBoingContext(env, user, 'b', verify), { status: 'denied' })
  assert.deepEqual(await resolveBoingContext(env, user, 'a', async () => workos('user_123', 'org_A', 'inactive')), { status: 'denied' })
  sql.exec("UPDATE boing_organizations SET workos_organization_id=NULL WHERE id='a'")
  assert.deepEqual(await resolveBoingContext(env, user, 'a', verify), { status: 'denied' })
})

test('fails closed for local or provider failure and for revocation during verification', async () => {
  const { env, sql } = setup()
  assert.deepEqual(await resolveBoingContext(env, user, 'a', async () => { throw Error('offline') }), { status: 'unavailable' })
  assert.deepEqual(await resolveBoingContext({}, user, 'a'), { status: 'unavailable' })
  assert.deepEqual(await resolveBoingContext(env, user, 'a', async () => {
    sql.exec("UPDATE boing_memberships SET status='suspended' WHERE organization_id='a'")
    return workos()
  }), { status: 'denied' })
  sql.exec("UPDATE boing_memberships SET status='active' WHERE organization_id='a'")
  assert.deepEqual(await resolveBoingContext(env, user, 'a', async () => {
    sql.exec("UPDATE boing_organizations SET workos_organization_id='org_C' WHERE id='a'")
    return workos()
  }), { status: 'denied' })
})

test('required provider membership version denies missing, replaced, modified or revoked grants', async () => {
  const { env, sql } = setup()
  env.BOING_MEMBERSHIP_BINDING_REQUIRED = 'true'
  const provider = (overrides = {}) => Response.json({ object: 'list', data: [{ id: 'om_123', user_id: user.id, organization_id: 'org_A', status: 'active', updated_at: '2026-01-01T00:00:00.000Z', ...overrides }], list_metadata: { after: null } })
  // A missing migration is unavailable, not permission to accept an unbound grant.
  assert.deepEqual(await resolveBoingContext(env, user, 'a', async () => provider()), { status: 'unavailable' })
  sql.exec(readFileSync(new URL('./boing-membership-binding-migration.sql', import.meta.url), 'utf8'))
  assert.deepEqual(await resolveBoingContext(env, user, 'a', async () => provider()), { status: 'denied' })
  sql.exec("INSERT INTO boing_workos_membership_bindings VALUES('a','user_123','om_123','2026-01-01T00:00:00.000Z')")
  assert.equal((await resolveBoingContext(env, user, 'a', async () => provider())).status, 'allowed')
  assert.equal((await resolveBoingContext(env, user, 'a', async () => provider({ id: 'om_new' }))).status, 'denied')
  assert.equal((await resolveBoingContext(env, user, 'a', async () => provider({ updated_at: '2026-01-02T00:00:00.000Z' }))).status, 'denied')
  assert.equal((await resolveBoingContext(env, user, 'a', async () => provider({ status: 'inactive' }))).status, 'denied')
  assert.equal((await resolveBoingContext(env, user, 'a', async () => { throw Error('offline') })).status, 'unavailable')
  assert.equal((await resolveBoingContext(env, user, 'a', async () => {
    sql.exec("UPDATE boing_memberships SET role='member' WHERE organization_id='a' AND user_id='user_123'")
    return provider()
  })).status, 'denied')
  assert.equal((await resolveBoingContext(env, user, 'a', async () => {
    sql.exec("UPDATE boing_workos_membership_bindings SET workos_updated_at='2026-01-02T00:00:00.000Z' WHERE organization_id='a'")
    return provider()
  })).status, 'denied')
  sql.exec("UPDATE boing_memberships SET status='suspended' WHERE organization_id='a'")
  assert.equal((await resolveBoingContext(env, user, 'a', async () => provider())).status, 'denied')
})
