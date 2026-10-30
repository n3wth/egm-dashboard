import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { createBoingSchema } from './boing-schema.mjs'

test('fresh Boing schema initializes without legacy tables and is repeatable', async () => {
  const db = new DatabaseSync(':memory:')
  try {
    db.exec('PRAGMA foreign_keys = ON')
    const schema = await createBoingSchema()
    db.exec(schema)
    db.exec(schema)
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name)
    for (const name of ['boing_identities', 'boing_sessions', 'boing_auth_flows', 'boing_organizations',
      'boing_memberships', 'boing_projects', 'boing_project_memberships', 'boing_snapshots',
      'boing_presentations', 'boing_invitations', 'boing_github_install_states', 'boing_github_installations',
      'boing_github_repositories', 'boing_github_deliveries', 'boing_github_oauth_flows', 'boing_github_install_handoffs', 'boing_snapshot_invalidations',
      'boing_audit_events', 'boing_membership_audit_targets', 'boing_source_versions', 'boing_collection_jobs', 'boing_collection_results',
      'boing_quota_usage', 'boing_ai_consents', 'boing_legacy_repo_baselines']) assert.ok(tables.includes(name), `missing ${name}`)
    for (const name of ['users', 'sessions', 'snapshots', 'presentation']) assert.ok(!tables.includes(name))
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), [])
    assert.throws(() => db.prepare("INSERT INTO boing_source_versions VALUES('missing', 'github', 1)").run(), /FOREIGN KEY/)
    assert.throws(() => db.prepare("INSERT INTO boing_legacy_repo_baselines VALUES('missing', 'repo', 1, 'now')").run(), /FOREIGN KEY/)
    db.prepare("INSERT INTO boing_organizations VALUES('o', 'O', 'org_O', 'active', 0, 'now')").run()
    db.prepare("INSERT INTO boing_projects VALUES('p', 'o', 'P', NULL, NULL, 'active', 'now')").run()
    db.prepare("INSERT INTO boing_legacy_repo_baselines VALUES('p', 'repo', 1, 'now')").run()
    assert.throws(() => db.prepare("INSERT INTO boing_legacy_repo_baselines VALUES('p', 'repo', 2, 'now')").run(), /UNIQUE/)
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), [])
    db.prepare("INSERT INTO boing_github_deliveries VALUES('delivery', 'hash', 1)").run()
    assert.throws(() => db.prepare("INSERT INTO boing_github_deliveries VALUES('other', 'hash', 2)").run(), /UNIQUE/)
  } finally { db.close() }
})
