import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { AUDIT_SCHEMA } from './boing-audit.mjs'
import { BOING_AI_CONSENT_SCHEMA, configuredAiDisclosure, handleBoingAiSettings, hasCurrentAiConsent } from './boing-ai-settings.mjs'

function fixture() {
  const sql = new DatabaseSync(':memory:')
  sql.exec('PRAGMA foreign_keys=ON')
  sql.exec(readFileSync(new URL('./boing-tenancy-schema.sql', import.meta.url), 'utf8'))
  sql.exec(AUDIT_SCHEMA)
  sql.exec(BOING_AI_CONSENT_SCHEMA)
  sql.exec(`INSERT INTO boing_identities VALUES ('user_Owner','owner@example.test','active'),('user_Member','member@example.test','active');
    INSERT INTO boing_organizations VALUES ('one','One','org_One','active',0,'now'),('two','Two','org_Two','active',0,'now');
    INSERT INTO boing_memberships VALUES ('one','user_Owner','owner','active','now'),('one','user_Member','member','active','now');`)
  const DB = { prepare(query) { return { bind(...args) { return {
    async first() { return sql.prepare(query).get(...args) ?? null },
    async run() { return { meta: { changes: Number(sql.prepare(query).run(...args).changes) } } }
  } } } }, async batch(statements) { sql.exec('BEGIN'); try { const results = []; for (const statement of statements) results.push(await statement.run()); sql.exec('COMMIT'); return results } catch (error) { sql.exec('ROLLBACK'); throw error } } }
  const env = { DB, APP_URL: 'https://app.test', WORKOS_API_KEY: 'test', BOING_AI_BUDGET_APPROVED: 'true', BOING_AI_PROCESSOR_DISCLOSURE: 'Project snapshot data is sent to the configured AI processor.', AI: { run() {} } }
  const user = { id: 'user_Owner', verified: 1, status: 'active' }
  const requestWorkos = async url => { const query = new URL(url).searchParams; return Response.json({ object: 'list', data: [{ user_id: query.get('user_id'), organization_id: query.get('organization_id'), status: 'active' }], list_metadata: { after: null } }) }
  const call = (method = 'GET', body, { actor = user, org = 'one', origin = 'https://app.test', provider = requestWorkos } = {}) => handleBoingAiSettings(new Request('https://app.test/api/boing/ai-settings', { method, headers: method === 'PUT' ? { origin, 'content-type': 'application/json' } : {}, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), env, actor, org, { requestWorkos: provider, now: 1800000000000 })
  return { sql, env, call }
}

test('only an owner can opt in after explicitly acknowledging the current disclosure', async () => {
  const { env, call, sql } = fixture()
  const disclosure = await configuredAiDisclosure(env)
  assert.deepEqual(await (await call()).json(), { enabled: false, available: true, disclosure })
  assert.equal((await call('GET', undefined, { actor: { id: 'user_Member', verified: 1, status: 'active' } })).status, 200)
  assert.equal((await call('PUT', { enabled: true, disclosureId: disclosure.id }, { actor: { id: 'user_Member', verified: 1, status: 'active' } })).status, 403)
  assert.equal((await call('PUT', { enabled: true, disclosureId: disclosure.id }, { origin: 'https://evil.test' })).status, 403)
  assert.equal((await call('PUT', { enabled: true, disclosureId: 'wrong' })).status, 409)
  assert.equal((await call('PUT', { enabled: true, disclosureId: disclosure.id })).status, 200)
  assert.equal(await hasCurrentAiConsent(env, 'one'), true)
  assert.equal(await hasCurrentAiConsent(env, 'two'), false)
  assert.deepEqual(sql.prepare('SELECT action FROM boing_audit_events').all().map(x => x.action), ['ai.enabled'])
})

test('a changed processor disclosure or revoked budget blocks inference until new consent', async () => {
  const { env, call } = fixture()
  const old = await configuredAiDisclosure(env)
  assert.equal((await call('PUT', { enabled: true, disclosureId: old.id })).status, 200)
  env.BOING_AI_PROCESSOR_DISCLOSURE = 'Project snapshot data is sent to a different configured processor.'
  assert.equal(await hasCurrentAiConsent(env, 'one'), false)
  assert.equal((await call('PUT', { enabled: true, disclosureId: old.id })).status, 409)
  const current = await configuredAiDisclosure(env)
  env.BOING_AI_BUDGET_APPROVED = 'false'
  assert.equal((await call('PUT', { enabled: true, disclosureId: current.id })).status, 409)
  assert.equal(await hasCurrentAiConsent(env, 'one'), false)
  env.BOING_AI_BUDGET_APPROVED = 'true'
  assert.equal((await call('PUT', { enabled: true, disclosureId: current.id })).status, 200)
  assert.equal(await hasCurrentAiConsent(env, 'one'), true)
  assert.equal((await call('PUT', { enabled: false })).status, 200)
  assert.equal(await hasCurrentAiConsent(env, 'one'), false)
})

test('revocation, provider outage, remapping, and audit failures fail closed', async () => {
  const { env, call, sql } = fixture()
  const disclosure = await configuredAiDisclosure(env)
  const denied = async () => Response.json({ object: 'list', data: [], list_metadata: { after: null } })
  assert.equal((await call('PUT', { enabled: true, disclosureId: disclosure.id }, { provider: denied })).status, 403)
  assert.equal((await call('PUT', { enabled: true, disclosureId: disclosure.id }, { provider: async () => { throw Error('offline') } })).status, 503)
  const remap = async () => { sql.exec("UPDATE boing_organizations SET workos_organization_id='org_Changed' WHERE id='one'"); return Response.json({ object: 'list', data: [{ user_id: 'user_Owner', organization_id: 'org_One', status: 'active' }], list_metadata: { after: null } }) }
  assert.equal((await call('PUT', { enabled: true, disclosureId: disclosure.id }, { provider: remap })).status, 403)
  sql.exec("UPDATE boing_organizations SET workos_organization_id='org_One' WHERE id='one'; DROP TABLE boing_audit_events")
  assert.equal((await call('PUT', { enabled: true, disclosureId: disclosure.id })).status, 503)
  assert.equal(sql.prepare("SELECT ai_enabled FROM boing_organizations WHERE id='one'").get().ai_enabled, 0)
})

test('bound owner version is rechecked after body parsing and before the atomic write', async () => {
  for (const mode of ['provider_changed', 'binding_removed']) {
    const { env, call, sql } = fixture()
    sql.exec(readFileSync(new URL('./boing-membership-binding-migration.sql', import.meta.url), 'utf8'))
    sql.exec("INSERT INTO boing_workos_membership_bindings VALUES('one','user_Owner','om_123','2026-01-01T00:00:00.000Z')")
    env.BOING_MEMBERSHIP_BINDING_REQUIRED = 'true'
    const disclosure = await configuredAiDisclosure(env)
    let checks = 0
    const provider = async () => Response.json({ object: 'list', data: [{ id: 'om_123', user_id: 'user_Owner', organization_id: 'org_One', status: 'active', updated_at: mode === 'provider_changed' && ++checks > 1 ? '2026-01-02T00:00:00.000Z' : '2026-01-01T00:00:00.000Z' }], list_metadata: { after: null } })
    if (mode === 'binding_removed') {
      const batch = env.DB.batch.bind(env.DB)
      env.DB.batch = async statements => { sql.exec('DELETE FROM boing_workos_membership_bindings'); return batch(statements) }
    }
    const result = await call('PUT', { enabled: true, disclosureId: disclosure.id }, { provider })
    assert.ok([403, 503].includes(result.status))
    assert.equal(sql.prepare("SELECT ai_enabled FROM boing_organizations WHERE id='one'").get().ai_enabled, 0)
    assert.equal(sql.prepare('SELECT count(*) AS n FROM boing_ai_consents').get().n, 0)
    assert.equal(sql.prepare('SELECT count(*) AS n FROM boing_audit_events').get().n, 0)
  }
})

test('bound owner can enable and disable AI with a current matching grant', async () => {
  const { env, call, sql } = fixture()
  sql.exec(readFileSync(new URL('./boing-membership-binding-migration.sql', import.meta.url), 'utf8'))
  sql.exec("INSERT INTO boing_workos_membership_bindings VALUES('one','user_Owner','om_123','2026-01-01T00:00:00.000Z')")
  env.BOING_MEMBERSHIP_BINDING_REQUIRED = 'true'
  const disclosure = await configuredAiDisclosure(env)
  const provider = async () => Response.json({ object: 'list', data: [{ id: 'om_123', user_id: 'user_Owner', organization_id: 'org_One', status: 'active', updated_at: '2026-01-01T00:00:00.000Z' }], list_metadata: { after: null } })
  assert.equal((await call('PUT', { enabled: true, disclosureId: disclosure.id }, { provider })).status, 200)
  assert.equal(await hasCurrentAiConsent(env, 'one'), true)
  assert.equal((await call('PUT', { enabled: false }, { provider })).status, 200)
  assert.equal(await hasCurrentAiConsent(env, 'one'), false)
  assert.deepEqual(sql.prepare('SELECT action FROM boing_audit_events ORDER BY rowid').all().map(row => row.action), ['ai.enabled', 'ai.disabled'])
})
