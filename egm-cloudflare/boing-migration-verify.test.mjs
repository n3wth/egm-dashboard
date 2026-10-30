import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { verifyAndImportLegacyTransfer, verifyMigrationIdentities } from './boing-migration-verify.mjs'
import { BOING_LEGACY_BASELINE_SCHEMA, identityAttestationFingerprint, transferFingerprint } from './boing-transfer.mjs'

const payload = { version: 2, users: [{ id: 'user_Source', email: 'owner@example.com' }], snapshot: { body: '{}', generated_at: 'now' }, presentation: { body: '{}', revision: 0 }, baselines: [] }
const mappings = [{ sourceId: 'user_Source', targetId: 'user_Target' }]
const timestamp = Date.parse('2026-01-01T00:00:00.000Z')

async function fixture() {
  const sql = new DatabaseSync(':memory:')
  sql.exec("CREATE TABLE boing_identities(user_id TEXT PRIMARY KEY,email TEXT NOT NULL,status TEXT NOT NULL); INSERT INTO boing_identities VALUES('user_Target','owner@example.com','active')")
  const targetDb = { prepare(query) { return { bind(...args) { return { async first() { return sql.prepare(query).get(...args) ?? null } } } } } }
  const calls = []
  const request = async (url, options) => {
    calls.push({ url, options })
    assert.equal(options.redirect, 'manual')
    const parsed = new URL(url)
    if (parsed.pathname.endsWith('/organization_memberships')) return Response.json({ object: 'list', data: [{ user_id: 'user_Target', organization_id: 'org_Target', status: 'active' }], list_metadata: { after: null } })
    const id = parsed.pathname.split('/').at(-1)
    const expected = id === 'user_Source' ? 'Bearer source-key' : 'Bearer target-key'
    assert.equal(options.headers.authorization, expected)
    return Response.json({ id, email: 'owner@example.com', email_verified: true })
  }
  return { sql, calls, input: { payload, expectedSourceFingerprint: await transferFingerprint(payload), mappings, targetOrganizationId: 'org_Target', sourceEnv: { WORKOS_API_KEY: 'source-key' }, targetEnv: { WORKOS_API_KEY: 'target-key' }, targetDb, request, clock: () => timestamp } }
}

test('verifies both identities and target membership without provider mutations', async () => {
  const { input, calls } = await fixture()
  const result = await verifyMigrationIdentities(input)
  assert.equal(result.identityAttestation.checkedAt, '2026-01-01T00:00:00.000Z')
  assert.equal(result.identityAttestation.mappings[0].targetId, 'user_Target')
  assert.equal(result.identityFingerprint, await identityAttestationFingerprint(result.identityAttestation))
  assert.equal(calls.length, 3)
  assert.ok(calls.every(call => !call.options.method || call.options.method === 'GET'))
  assert.doesNotMatch(JSON.stringify(result), /source-key|target-key/)
})

test('rejects incorrect fingerprints, duplicate or incomplete mappings before network calls', async () => {
  const { input, calls } = await fixture()
  await assert.rejects(verifyMigrationIdentities({ ...input, expectedSourceFingerprint: '0'.repeat(64) }), /invalid migration mapping/)
  await assert.rejects(verifyMigrationIdentities({ ...input, mappings: [] }), /identity verification unavailable/)
  await assert.rejects(verifyMigrationIdentities({ ...input, mappings: [{ sourceId: 'user_Other', targetId: 'user_Target' }] }), /invalid migration mapping/)
  assert.equal(calls.length, 0)
})

test('denies unverified or changed provider identity and inactive or ambiguous membership', async () => {
  for (const mode of ['unverified', 'wrong-email', 'inactive', 'ambiguous', 'outage']) {
    const { input } = await fixture()
    const base = input.request
    input.request = async (url, options) => {
      if (mode === 'outage') throw Error('offline')
      if (url.includes('/organization_memberships')) {
        const item = { user_id: 'user_Target', organization_id: 'org_Target', status: mode === 'inactive' ? 'inactive' : 'active' }
        return Response.json({ object: 'list', data: mode === 'ambiguous' ? [item, item] : [item], list_metadata: { after: null } })
      }
      if (url.endsWith('user_Target') && mode === 'unverified') return Response.json({ id: 'user_Target', email: 'owner@example.com', email_verified: false })
      if (url.endsWith('user_Target') && mode === 'wrong-email') return Response.json({ id: 'user_Target', email: 'other@example.com', email_verified: true })
      return base(url, options)
    }
    await assert.rejects(verifyMigrationIdentities(input), /identity verification failed/)
  }
})

test('rejects suspended or changed local target and stale verification', async () => {
  const { sql, input } = await fixture()
  sql.exec("UPDATE boing_identities SET status='suspended'")
  await assert.rejects(verifyMigrationIdentities(input), /identity verification failed/)
  sql.exec("UPDATE boing_identities SET status='active'")
  const base = input.request
  input.request = async (...args) => { sql.exec("UPDATE boing_identities SET status='suspended'"); return base(...args) }
  await assert.rejects(verifyMigrationIdentities(input), /identity verification failed/)
  sql.exec("UPDATE boing_identities SET status='active'")
  input.request = base
  let time = timestamp
  input.clock = () => { const value = time; time += 16 * 60_000; return value }
  await assert.rejects(verifyMigrationIdentities(input), /identity verification unavailable/)
})

test('verified mapping can be consumed by the offline importer without copying source IDs', async () => {
  const { input } = await fixture()
  const sql = new DatabaseSync(':memory:')
  sql.exec(readFileSync(new URL('./boing-tenancy-schema.sql', import.meta.url), 'utf8'))
  sql.exec(BOING_LEGACY_BASELINE_SCHEMA)
  sql.exec("INSERT INTO boing_identities VALUES('user_Target','owner@example.com','active')")
  const db = { prepare(query) { return { bind(...args) { return {
    async first() { return sql.prepare(query).get(...args) ?? null },
    async all() { return { results: sql.prepare(query).all(...args) } },
    async run() { return { meta: { changes: Number(sql.prepare(query).run(...args).changes) } } }
  } }, async all() { return { results: sql.prepare(query).all() } } } }, async batch(statements) {
    sql.exec('BEGIN')
    try { const results = []; for (const statement of statements) results.push(await statement.run()); sql.exec('COMMIT'); return results } catch (error) { sql.exec('ROLLBACK'); throw error }
  } }
  input.targetDb = db
  const params = { ...input, organizationId: 'egm', projectId: 'project', ownerId: 'user_Source', repository: 'org/repo', websiteUrl: 'https://example.org' }
  const denied = async () => new Response(null, { status: 503 })
  await assert.rejects(verifyAndImportLegacyTransfer({ ...params, request: denied }), /identity verification failed/)
  assert.equal(sql.prepare('SELECT count(*) AS n FROM boing_organizations').get().n, 0)
  assert.equal(sql.prepare('SELECT count(*) AS n FROM boing_memberships').get().n, 0)
  const result = await verifyAndImportLegacyTransfer(params)
  assert.equal(result.status, 'imported')
  assert.deepEqual({ ...sql.prepare('SELECT user_id,role FROM boing_memberships').get() }, { user_id: 'user_Target', role: 'owner' })
  assert.equal(sql.prepare("SELECT count(*) AS n FROM boing_identities WHERE user_id='user_Source'").get().n, 0)
})

test('gated migration binds freshly verified membership atomically and denies provider changes', async () => {
  for (const mode of ['ok', 'changed', 'missing', 'no-schema']) {
    const { input } = await fixture()
    const sql = new DatabaseSync(':memory:')
    sql.exec('PRAGMA foreign_keys=ON')
    sql.exec(readFileSync(new URL('./boing-tenancy-schema.sql', import.meta.url), 'utf8'))
    sql.exec(BOING_LEGACY_BASELINE_SCHEMA)
    if (mode !== 'no-schema') sql.exec(readFileSync(new URL('./boing-membership-binding-migration.sql', import.meta.url), 'utf8'))
    sql.exec("INSERT INTO boing_identities VALUES('user_Target','owner@example.com','active')")
    const db = { prepare(query) { return { bind(...args) { return {
      async first() { return sql.prepare(query).get(...args) ?? null },
      async run() { return { meta: { changes: Number(sql.prepare(query).run(...args).changes) } } },
    } }, async all() { return { results: sql.prepare(query).all() } } } }, async batch(statements) {
      sql.exec('BEGIN')
      try { const results = []; for (const s of statements) results.push(await s.run()); sql.exec('COMMIT'); return results } catch (error) { sql.exec('ROLLBACK'); throw error }
    } }
    const original = input.request
    let checks = 0
    input.request = async (url, options) => {
      if (!url.includes('/organization_memberships')) return original(url, options)
      checks++
      return Response.json({ object: 'list', data: [{ user_id: 'user_Target', organization_id: 'org_Target', status: 'active', ...(mode === 'missing' ? {} : { id: 'om_123', updated_at: mode === 'changed' && checks > 1 ? '2026-01-01T00:00:01.000Z' : '2026-01-01T00:00:00.000Z' }) }], list_metadata: { after: null } })
    }
    input.targetDb = db
    input.targetEnv.BOING_MEMBERSHIP_BINDING_REQUIRED = 'true'
    const params = { ...input, organizationId: 'egm', projectId: 'project', ownerId: 'user_Source', repository: 'org/repo', websiteUrl: 'https://example.org' }
    if (mode === 'ok') {
      assert.equal((await verifyAndImportLegacyTransfer(params)).status, 'imported')
      assert.deepEqual({ ...sql.prepare('SELECT user_id,workos_membership_id,workos_updated_at FROM boing_workos_membership_bindings').get() }, { user_id: 'user_Target', workos_membership_id: 'om_123', workos_updated_at: '2026-01-01T00:00:00.000Z' })
      assert.equal(checks, 2)
    } else {
      await assert.rejects(verifyAndImportLegacyTransfer(params))
      assert.equal(sql.prepare('SELECT count(*) AS n FROM boing_organizations').get().n, 0)
      assert.equal(sql.prepare('SELECT count(*) AS n FROM boing_memberships').get().n, 0)
    }
  }
})
