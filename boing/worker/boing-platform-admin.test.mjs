import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { AUDIT_SCHEMA } from './boing-audit.mjs'
import { handlePlatformProvision } from './boing-platform-admin.mjs'

function setup() {
  const sql = new DatabaseSync(':memory:')
  sql.exec('PRAGMA foreign_keys=ON')
  sql.exec(readFileSync(new URL('./boing-tenancy-schema.sql', import.meta.url), 'utf8'))
  sql.exec(AUDIT_SCHEMA)
  sql.exec("INSERT INTO boing_identities VALUES('user_Admin','admin@example.com','active')")
  const DB = { prepare(query) { return { bind(...args) { return {
    async first() { return sql.prepare(query).get(...args) ?? null },
    async run() { return { meta: { changes: Number(sql.prepare(query).run(...args).changes) } } },
  } } } }, async batch(statements) { sql.exec('BEGIN'); try { const result = []; for (const s of statements) result.push(await s.run()); sql.exec('COMMIT'); return result } catch (error) { sql.exec('ROLLBACK'); throw error } } }
  const env = { DB, APP_URL: 'https://staging.test', WORKOS_API_KEY: 'test', BOING_ENVIRONMENT: 'staging', BOING_PLATFORM_PROVISIONING_ENABLED: 'true', BOING_PLATFORM_ADMIN_IDS: 'user_Admin' }
  const actor = { id: 'user_Admin', verified: 1, status: 'active' }
  const input = { name: 'Workspace', workosOrganizationId: 'org_123', ownerUserId: 'user_Owner', ownerEmail: 'owner@example.com' }
  const provider = async url => {
    if (url.endsWith('/user_Owner')) return Response.json({ id: 'user_Owner', email: 'owner@example.com', email_verified: true })
    return Response.json({ object: 'list', data: [{ user_id: 'user_Owner', organization_id: 'org_123', status: 'active' }], list_metadata: { after: null } })
  }
  const call = (body = input, { environment = env, user = actor, requestWorkos = provider, origin = 'https://staging.test' } = {}) => handlePlatformProvision(new Request('https://staging.test/api/boing/platform/workspaces', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body) }), environment, user, { requestWorkos, now: 1800000000000 })
  return { sql, env, actor, input, provider, call }
}

test('staging platform admin provisions a verified existing WorkOS owner atomically with audit', async () => {
  const { sql, call } = setup()
  const response = await call()
  assert.equal(response.status, 201)
  const { workspace } = await response.json()
  assert.equal(sql.prepare('SELECT workos_organization_id,ai_enabled FROM boing_organizations WHERE id=?').get(workspace.id).workos_organization_id, 'org_123')
  assert.equal(sql.prepare('SELECT role FROM boing_memberships WHERE organization_id=? AND user_id=?').get(workspace.id, 'user_Owner').role, 'owner')
  assert.equal(sql.prepare('SELECT action FROM boing_audit_events').get().action, 'workspace.created')
  assert.equal((await call()).status, 503)
  assert.equal(sql.prepare('SELECT count(*) n FROM boing_organizations').get().n, 1)
})

test('admin capability is visible only to an active allowed staging admin', async () => {
  const { env, actor, sql } = setup()
  const request = new Request('https://staging.test/api/boing/platform/workspaces')
  assert.equal((await handlePlatformProvision(request, env, actor)).status, 200)
  assert.equal((await handlePlatformProvision(request, env, { ...actor, id: 'user_Other' })).status, 403)
  assert.equal((await handlePlatformProvision(request, { ...env, BOING_PLATFORM_PROVISIONING_ENABLED: 'false' }, actor)).status, 503)
  sql.exec("UPDATE boing_identities SET status='suspended' WHERE user_id='user_Admin'")
  assert.equal((await handlePlatformProvision(request, env, actor)).status, 403)
})

test('provisioning atomically records the verified owner membership version when required', async () => {
  const { sql, env, call, input } = setup()
  sql.exec(readFileSync(new URL('./boing-membership-binding-migration.sql', import.meta.url), 'utf8'))
  env.BOING_MEMBERSHIP_BINDING_REQUIRED = 'true'
  const provider = async url => url.endsWith('/user_Owner')
    ? Response.json({ id: 'user_Owner', email: 'owner@example.com', email_verified: true })
    : Response.json({ object: 'list', data: [{ id: 'om_123', user_id: 'user_Owner', organization_id: 'org_123', status: 'active', updated_at: '2026-10-28T11:00:00.000Z' }], list_metadata: { after: null } })
  assert.equal((await call(input, { requestWorkos: provider })).status, 201)
  const binding = sql.prepare('SELECT user_id,workos_membership_id FROM boing_workos_membership_bindings').get()
  assert.equal(binding.user_id, 'user_Owner')
  assert.equal(binding.workos_membership_id, 'om_123')
})

test('staging gate, exact origin, authenticated admin allowlist and recipient email are required', async () => {
  const { sql, env, actor, input, call } = setup()
  assert.equal((await call(input, { environment: { ...env, BOING_ENVIRONMENT: 'production' } })).status, 503)
  assert.equal((await call(input, { environment: { ...env, BOING_PLATFORM_PROVISIONING_ENABLED: 'false' } })).status, 503)
  assert.equal((await call(input, { origin: 'https://evil.test' })).status, 403)
  assert.equal((await call(input, { user: { ...actor, id: 'user_Other' } })).status, 403)
  assert.equal((await call({ ...input, ownerEmail: 'other@example.com' })).status, 403)
  assert.equal((await call({ ...input, unknown: 'x' })).status, 400)
  assert.equal(sql.prepare('SELECT count(*) n FROM boing_organizations').get().n, 0)
})

test('inactive provider membership, suspended local owner, or missing audit never grant access', async () => {
  for (const mode of ['revoked', 'suspended', 'audit', 'actor-revoked']) {
    const { sql, call, input, provider } = setup()
    if (mode === 'suspended') sql.exec("INSERT INTO boing_identities VALUES('user_Owner','owner@example.com','suspended')")
    if (mode === 'audit') sql.exec('DROP TABLE boing_audit_events')
    const requestWorkos = async url => {
      if (mode === 'actor-revoked') sql.exec("UPDATE boing_identities SET status='suspended' WHERE user_id='user_Admin'")
      if (mode === 'revoked' && !url.endsWith('/user_Owner')) return Response.json({ object: 'list', data: [], list_metadata: { after: null } })
      return provider(url)
    }
    assert.ok([403, 503].includes((await call(input, { requestWorkos })).status))
    assert.equal(sql.prepare('SELECT count(*) n FROM boing_organizations').get().n, 0)
    assert.equal(sql.prepare('SELECT count(*) n FROM boing_memberships').get().n, 0)
  }
})

test('concurrent requests cannot bind the same WorkOS organization twice', async () => {
  const { sql, call } = setup()
  const responses = await Promise.all(Array.from({ length: 5 }, () => call()))
  assert.equal(responses.filter(response => response.status === 201).length, 1)
  assert.equal(sql.prepare('SELECT count(*) n FROM boing_organizations').get().n, 1)
  assert.equal(sql.prepare('SELECT count(*) n FROM boing_memberships').get().n, 1)
  assert.equal(sql.prepare('SELECT count(*) n FROM boing_audit_events').get().n, 1)
})
