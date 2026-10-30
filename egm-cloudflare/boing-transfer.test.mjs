import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { BOING_LEGACY_BASELINE_SCHEMA, exportLegacyTransfer, importLegacyTransfer, transferFingerprint, identityAttestationFingerprint } from './boing-transfer.mjs'
import { resolveBoingContext } from './boing-context.mjs'

function database(schema, { failAt = -1 } = {}) {
  const sql = new DatabaseSync(':memory:')
  sql.exec('PRAGMA foreign_keys=ON')
  sql.exec(readFileSync(new URL(schema, import.meta.url), 'utf8'))
  if (schema === 'boing-tenancy-schema.sql') sql.exec(BOING_LEGACY_BASELINE_SCHEMA)
  const db = {
    prepare(query) {
      const make = args => ({ run: () => sql.prepare(query).run(...args), all: () => sql.prepare(query).all(...args), first: async () => sql.prepare(query).get(...args) ?? null })
      return { ...make([]), bind: (...args) => make(args) }
    },
    async batch(statements) {
      sql.exec('BEGIN')
      try {
        const results = statements.map((stmt, index) => {
          if (index === failAt) throw new Error('simulated failure')
          if (stmt.all && stmt.run && index < 4 && schema === 'schema.sql') return { results: stmt.all() }
          return { meta: stmt.run() }
        })
        sql.exec('COMMIT')
        return results
      } catch (error) { sql.exec('ROLLBACK'); throw error }
    },
  }
  return { db, sql }
}

function source() {
  const value = database('schema.sql')
  value.sql.exec(`INSERT INTO users(id,email,name,verified,status,created_at) VALUES
    ('user_OWNER','owner@example.com','Owner',1,'approved','now'),
    ('user_MEMBER','member@example.com','Member',1,'approved','now'),
    ('user_PENDING','pending@example.com','Pending',1,'pending','now');
    INSERT INTO snapshots VALUES(1,'{"stars":42}','2026-01-02');
    UPDATE presentation SET body='{"title":"EGM"}',revision=4 WHERE id=1;
    INSERT INTO repo_baselines VALUES('google/elephant-goldfish-model',40,'2026-01-01');`)
  return value
}
const options = { organizationId: 'egm-org', projectId: 'egm-project', ownerId: 'user_OWNER', workosOrganizationId: 'org_EGM', repository: 'google/elephant-goldfish-model', websiteUrl: 'https://egm.dev', now: '2026-01-03' }
const identityAttestation = { targetOrganizationId: 'org_EGM', checkedAt: '2026-01-03T00:00:00.000Z', mappings: [
  { sourceId: 'user_OWNER', targetId: 'user_NEWOWNER', email: 'owner@example.com', sourceEmailVerified: true, sourceStatus: 'active', targetEmailVerified: true, targetStatus: 'active', targetMembershipStatus: 'active' },
  { sourceId: 'user_MEMBER', targetId: 'user_NEWMEMBER', email: 'member@example.com', sourceEmailVerified: true, sourceStatus: 'active', targetEmailVerified: true, targetStatus: 'active', targetMembershipStatus: 'active' },
] }
const mappedOptions = async fingerprint => ({ ...options, expectedFingerprint: fingerprint, identityAttestation, expectedIdentityFingerprint: await identityAttestationFingerprint(identityAttestation) })
function seedTargets(sql) { sql.exec("INSERT INTO boing_identities VALUES('user_NEWOWNER','owner@example.com','active'),('user_NEWMEMBER','member@example.com','active')") }

test('transfers approved identities and project data between separate databases without touching legacy data', async () => {
  const src = source(), dst = database('boing-tenancy-schema.sql')
  seedTargets(dst.sql)
  dst.sql.exec("INSERT INTO boing_identities VALUES('other','other@example.com','active'); INSERT INTO boing_organizations VALUES('other-org','Other','org_other','active',0,'now');")
  const { payload, fingerprint } = await exportLegacyTransfer(src.db)
  assert.deepEqual(payload.users.map(user => user.id), ['user_MEMBER', 'user_OWNER'])
  assert.equal((await importLegacyTransfer(dst.db, payload, await mappedOptions(fingerprint))).status, 'imported')
  assert.equal(dst.sql.prepare('SELECT body FROM boing_snapshots WHERE project_id=?').get('egm-project').body, '{"stars":42}')
  assert.deepEqual({ ...dst.sql.prepare('SELECT repo,stars,observed_at FROM boing_legacy_repo_baselines WHERE project_id=?').get('egm-project') }, payload.baselines[0])
  assert.equal(dst.sql.prepare('SELECT count(*) AS n FROM boing_memberships WHERE organization_id=?').get('egm-org').n, 2)
  assert.equal(dst.sql.prepare('SELECT ai_enabled FROM boing_organizations WHERE id=?').get('egm-org').ai_enabled, 0)
  assert.equal(dst.sql.prepare('SELECT count(*) AS n FROM boing_organizations WHERE id=?').get('other-org').n, 1)
  assert.equal(src.sql.prepare('SELECT count(*) AS n FROM users').get().n, 3)
  const workos = async url => {
    assert.equal(new URL(url).searchParams.get('organization_id'), 'org_EGM')
    return Response.json({ object: 'list', data: [{ user_id: 'user_NEWOWNER', organization_id: 'org_EGM', status: 'active' }], list_metadata: { after: null } })
  }
  assert.deepEqual(await resolveBoingContext({ DB: dst.db, WORKOS_API_KEY: 'test' }, { id: 'user_NEWOWNER', status: 'active', verified: 1 }, 'egm-org', workos), { status: 'allowed', organizationId: 'egm-org', userId: 'user_NEWOWNER', role: 'owner' })
  await assert.rejects(importLegacyTransfer(dst.db, payload, await mappedOptions(fingerprint)))
})

test('detects changed source or tampered payload and rejects missing owner', async () => {
  const src = source(), dst = database('boing-tenancy-schema.sql')
  const first = await exportLegacyTransfer(src.db)
  const opts = await mappedOptions(first.fingerprint)
  src.sql.exec("UPDATE snapshots SET body='{\"stars\":43}' WHERE id=1")
  const second = await exportLegacyTransfer(src.db)
  assert.notEqual(first.fingerprint, second.fingerprint)
  src.sql.exec("UPDATE repo_baselines SET stars=41")
  assert.notEqual(second.fingerprint, (await exportLegacyTransfer(src.db)).fingerprint)
  await assert.rejects(importLegacyTransfer(dst.db, first.payload, { ...opts, expectedFingerprint: second.fingerprint }), /fingerprint mismatch/)
  await assert.rejects(importLegacyTransfer(dst.db, first.payload, { ...opts, ownerId: 'user_PENDING' }), /invalid migration parameters/)
  await assert.rejects(importLegacyTransfer(dst.db, first.payload, { ...opts, workosOrganizationId: 'invalid' }), /invalid migration parameters/)
  await assert.rejects(importLegacyTransfer(dst.db, first.payload, { ...opts, organizationId: '../invalid' }), /invalid migration parameters/)
  assert.equal(dst.sql.prepare('SELECT count(*) AS n FROM boing_organizations').get().n, 0)
})

test('rejects collisions and rolls back all target changes on mid-batch failure', async () => {
  const { payload, fingerprint } = await exportLegacyTransfer(source().db)
  const opts = await mappedOptions(fingerprint)
  for (const failAt of [-1, 4]) {
    const dst = database('boing-tenancy-schema.sql', { failAt })
    seedTargets(dst.sql)
    if (failAt === -1) dst.sql.exec("UPDATE boing_identities SET status='suspended' WHERE user_id='user_NEWOWNER'")
    await assert.rejects(importLegacyTransfer(dst.db, payload, opts))
    assert.equal(dst.sql.prepare('SELECT count(*) AS n FROM boing_organizations').get().n, 0)
    assert.equal(dst.sql.prepare('SELECT count(*) AS n FROM boing_migrations').get().n, 0)
    assert.equal(dst.sql.prepare('SELECT count(*) AS n FROM boing_legacy_repo_baselines').get().n, 0)
  }
  const duplicateEmail = database('boing-tenancy-schema.sql')
  seedTargets(duplicateEmail.sql)
  duplicateEmail.sql.exec("INSERT INTO boing_identities VALUES('different-id','OWNER@example.com','active')")
  await assert.rejects(importLegacyTransfer(duplicateEmail.db, payload, opts))
  assert.equal(duplicateEmail.sql.prepare('SELECT count(*) AS n FROM boing_organizations').get().n, 0)
})

test('rejects malformed source data and excess users without truncation', async () => {
  const src = source()
  src.sql.exec("UPDATE presentation SET body='not json' WHERE id=1")
  await assert.rejects(exportLegacyTransfer(src.db), /invalid source data/)
  const valid = await exportLegacyTransfer(source().db)
  await assert.rejects(transferFingerprint({ ...valid.payload, users: Array.from({ length: 101 }, (_, i) => ({ id: `u${i}`, email: `u${i}@example.com` })) }), /invalid transfer/)
  await assert.rejects(transferFingerprint({ ...valid.payload, baselines: [{ repo: 'bad', stars: -1, observed_at: 'now' }] }), /invalid baseline/)
  const tooMany = source()
  const insert = tooMany.sql.prepare('INSERT INTO repo_baselines VALUES(?,?,?)')
  for (let i = 0; i < 1000; i++) insert.run(`repo-${i}`, i, 'now')
  await assert.rejects(exportLegacyTransfer(tooMany.db), /invalid transfer/)
})

test('requires recent complete one-to-one attestation for the exact source and target organization', async () => {
  const { payload, fingerprint } = await exportLegacyTransfer(source().db)
  const opts = await mappedOptions(fingerprint)
  const variants = [
    null,
    { ...identityAttestation, mappings: identityAttestation.mappings.slice(0, 1) },
    { ...identityAttestation, mappings: identityAttestation.mappings.map((item, i) => i ? { ...item, targetId: 'user_NEWOWNER' } : item) },
    { ...identityAttestation, mappings: identityAttestation.mappings.map((item, i) => i ? { ...item, email: 'wrong@example.com' } : item) },
    { ...identityAttestation, mappings: identityAttestation.mappings.map((item, i) => i ? { ...item, targetEmailVerified: false } : item) },
    { ...identityAttestation, mappings: identityAttestation.mappings.map((item, i) => i ? { ...item, sourceEmailVerified: false } : item) },
    { ...identityAttestation, mappings: identityAttestation.mappings.map((item, i) => i ? { ...item, sourceStatus: 'inactive' } : item) },
    { ...identityAttestation, mappings: identityAttestation.mappings.map((item, i) => i ? { ...item, targetStatus: 'inactive' } : item) },
    { ...identityAttestation, mappings: identityAttestation.mappings.map((item, i) => i ? { ...item, targetMembershipStatus: 'inactive' } : item) },
    { ...identityAttestation, targetOrganizationId: 'org_Other' },
    { ...identityAttestation, checkedAt: '2026-01-02T23:44:59.000Z' },
    { ...identityAttestation, checkedAt: '2026-01-03T00:00:01.000Z' },
  ]
  for (const attestation of variants) {
    const dst = database('boing-tenancy-schema.sql'); seedTargets(dst.sql)
    let digest = opts.expectedIdentityFingerprint
    try { digest = await identityAttestationFingerprint(attestation) } catch {}
    await assert.rejects(importLegacyTransfer(dst.db, payload, { ...opts, identityAttestation: attestation, expectedIdentityFingerprint: digest }), /identity attestation/)
    assert.equal(dst.sql.prepare('SELECT count(*) n FROM boing_organizations').get().n, 0)
  }
  const dst = database('boing-tenancy-schema.sql'); seedTargets(dst.sql)
  await assert.rejects(importLegacyTransfer(dst.db, payload, { ...opts, expectedIdentityFingerprint: '0'.repeat(64) }), /identity attestation/)
  await assert.rejects(importLegacyTransfer(dst.db, payload, { ...options, expectedFingerprint: fingerprint }), /identity attestation/)
  assert.equal(dst.sql.prepare('SELECT count(*) n FROM boing_organizations').get().n, 0)
})

test('binding versions are fingerprinted and required for guarded imports', async () => {
  const { payload, fingerprint } = await exportLegacyTransfer(source().db)
  const attestation = { ...identityAttestation, membershipBindingRequired: true, mappings: identityAttestation.mappings.map((item, i) => ({ ...item, targetMembershipId: `om_${i}`, targetMembershipUpdatedAt: '2026-01-02T12:00:00.000Z' })) }
  const digest = await identityAttestationFingerprint(attestation)
  const opts = { ...options, expectedFingerprint: fingerprint, identityAttestation: attestation, expectedIdentityFingerprint: digest, membershipBindingRequired: true }
  const dst = database('boing-tenancy-schema.sql'); seedTargets(dst.sql)
  dst.sql.exec(readFileSync(new URL('./boing-membership-binding-migration.sql', import.meta.url), 'utf8'))
  const changed = { ...attestation, mappings: attestation.mappings.map((item, i) => i ? item : { ...item, targetMembershipId: 'om_recreated' }) }
  await assert.rejects(importLegacyTransfer(dst.db, payload, { ...opts, identityAttestation: changed }), /identity attestation/)
  await assert.rejects(importLegacyTransfer(dst.db, payload, { ...opts, identityAttestation, expectedIdentityFingerprint: await identityAttestationFingerprint(identityAttestation) }), /identity attestation/)
  const missing = { ...attestation, mappings: attestation.mappings.map((item, i) => i ? item : { ...item, targetMembershipUpdatedAt: undefined }) }
  await assert.rejects(identityAttestationFingerprint(missing), /identity attestation/)
  assert.equal(dst.sql.prepare('SELECT count(*) n FROM boing_organizations').get().n, 0)
  const failed = database('boing-tenancy-schema.sql', { failAt: 4 }); seedTargets(failed.sql)
  failed.sql.exec(readFileSync(new URL('./boing-membership-binding-migration.sql', import.meta.url), 'utf8'))
  await assert.rejects(importLegacyTransfer(failed.db, payload, opts))
  assert.equal(failed.sql.prepare('SELECT count(*) n FROM boing_organizations').get().n, 0)
  assert.equal(failed.sql.prepare('SELECT count(*) n FROM boing_memberships').get().n, 0)
  assert.equal((await importLegacyTransfer(dst.db, payload, opts)).status, 'imported')
  assert.equal(dst.sql.prepare('SELECT count(*) n FROM boing_workos_membership_bindings').get().n, 2)
})

test('target identities must already exist and remain active with exact matching email', async () => {
  const { payload, fingerprint } = await exportLegacyTransfer(source().db), opts = await mappedOptions(fingerprint)
  for (const mutation of ['missing', 'suspended', 'email']) {
    const dst = database('boing-tenancy-schema.sql'); seedTargets(dst.sql)
    if (mutation === 'missing') dst.sql.exec("DELETE FROM boing_identities WHERE user_id='user_NEWMEMBER'")
    if (mutation === 'suspended') dst.sql.exec("UPDATE boing_identities SET status='suspended' WHERE user_id='user_NEWMEMBER'")
    if (mutation === 'email') dst.sql.exec("UPDATE boing_identities SET email='different@example.com' WHERE user_id='user_NEWMEMBER'")
    await assert.rejects(importLegacyTransfer(dst.db, payload, opts))
    assert.equal(dst.sql.prepare('SELECT count(*) n FROM boing_organizations').get().n, 0)
    assert.equal(dst.sql.prepare('SELECT count(*) n FROM boing_memberships').get().n, 0)
  }
})

test('identical source and target IDs still require an explicit attestation', async () => {
  const { payload, fingerprint } = await exportLegacyTransfer(source().db)
  const dst = database('boing-tenancy-schema.sql')
  dst.sql.exec("INSERT INTO boing_identities VALUES('user_OWNER','owner@example.com','active'),('user_MEMBER','member@example.com','active')")
  const attestation = { ...identityAttestation, mappings: identityAttestation.mappings.map(item => ({ ...item, targetId: item.sourceId })) }
  const result = await importLegacyTransfer(dst.db, payload, { ...options, expectedFingerprint: fingerprint, identityAttestation: attestation, expectedIdentityFingerprint: await identityAttestationFingerprint(attestation) })
  assert.equal(result.status, 'imported')
  assert.equal(dst.sql.prepare("SELECT role FROM boing_memberships WHERE user_id='user_OWNER'").get().role, 'owner')
})

test('rejects import when archive schema is absent even with no baseline rows', async () => {
  const src = source(), dst = database('boing-tenancy-schema.sql')
  src.sql.exec('DELETE FROM repo_baselines')
  dst.sql.exec('DROP TABLE boing_legacy_repo_baselines')
  const { payload, fingerprint } = await exportLegacyTransfer(src.db)
  await assert.rejects(importLegacyTransfer(dst.db, payload, await mappedOptions(fingerprint)), /no such table/)
  assert.equal(dst.sql.prepare('SELECT count(*) AS n FROM boing_organizations').get().n, 0)
})
