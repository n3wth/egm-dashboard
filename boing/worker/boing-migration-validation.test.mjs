import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { migrateLegacyEgm, readProjectSnapshot } from './boing-tenancy.mjs'
import { GITHUB_APP_SCHEMA } from './boing-github-app.mjs'

// Model D1's transactional batch using the real SQLite schema and statements.
function setup({ failAt } = {}) {
  const sql = new DatabaseSync(':memory:')
  sql.exec('PRAGMA foreign_keys = ON')
  for (const name of ['../../egm-cloudflare/schema.sql', './boing-tenancy-schema.sql']) {
    sql.exec(readFileSync(new URL(name, import.meta.url), 'utf8'))
  }
  sql.exec(GITHUB_APP_SCHEMA)
  function statement(query, args) {
    return {
      async first() { return sql.prepare(query).get(...args) ?? null },
      async run() { return { meta: { changes: Number(sql.prepare(query).run(...args).changes) } } },
    }
  }
  const db = {
    prepare(query) { return { ...statement(query, []), bind: (...args) => statement(query, args) } },
    async batch(statements) {
      sql.exec('BEGIN')
      try {
        for (const [index, item] of statements.entries()) {
          if (index === failAt) throw new Error('simulated batch failure')
          await item.run()
        }
        sql.exec('COMMIT')
      } catch (error) {
        sql.exec('ROLLBACK')
        throw error
      }
    },
  }
  sql.exec(`INSERT INTO users(id,email,name,verified,status,created_at) VALUES
    ('owner','owner@example.com','Owner',1,'approved','now'),
    ('member','member@example.com','Member',1,'approved','now'),
    ('pending','pending@example.com','Pending',1,'pending','now');
    INSERT INTO snapshots VALUES(1,'{"stars":42}','2026-01-02');
    UPDATE presentation SET body='{"title":"EGM"}',revision=4 WHERE id=1;
    INSERT INTO repo_baselines VALUES('google/elephant-goldfish-model',40,'2026-01-01');
    INSERT INTO boing_identities(user_id,email,status) VALUES('member','member@example.com','active');
    INSERT INTO boing_organizations VALUES('other-org','Other','org_other','active',0,'now');
    INSERT INTO boing_projects VALUES('other-project','other-org','Other',NULL,NULL,'active','now');
    INSERT INTO boing_memberships VALUES('other-org','member','owner','active','now');
    INSERT INTO boing_snapshots VALUES('other-project','other-data','now');`)
  return { db, sql }
}

const options = { organizationId: 'egm-org', projectId: 'egm-project', ownerId: 'owner', workosOrganizationId: 'org_egm', now: 'now' }
const count = (sql, table) => sql.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n

test('migration preserves legacy data and unrelated tenant records through a repeat', async () => {
  const { db, sql } = setup()
  const legacyBefore = {
    snapshot: sql.prepare('SELECT * FROM snapshots').all(),
    presentation: sql.prepare('SELECT * FROM presentation').all(),
    users: sql.prepare('SELECT * FROM users ORDER BY id').all(),
    baselines: sql.prepare('SELECT * FROM repo_baselines').all(),
  }
  assert.deepEqual(await migrateLegacyEgm(db, options), { status: 'migrated' })
  assert.deepEqual(await migrateLegacyEgm(db, options), { status: 'already_migrated' })
  assert.deepEqual(sql.prepare('SELECT * FROM snapshots').all(), legacyBefore.snapshot)
  assert.deepEqual(sql.prepare('SELECT * FROM presentation').all(), legacyBefore.presentation)
  assert.deepEqual(sql.prepare('SELECT * FROM users ORDER BY id').all(), legacyBefore.users)
  assert.deepEqual(sql.prepare('SELECT * FROM repo_baselines').all(), legacyBefore.baselines)
  assert.equal(sql.prepare("SELECT body FROM boing_snapshots WHERE project_id='other-project'").get().body, 'other-data')
  assert.equal(await readProjectSnapshot(db, 'owner', 'other-project', 'egm-org'), null)
  assert.equal(await readProjectSnapshot(db, 'member', 'egm-project', 'other-org'), null)
  assert.equal((await readProjectSnapshot(db, 'member', 'egm-project', 'egm-org')).body, '{"stars":42}')
  assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM boing_memberships WHERE organization_id='egm-org'").get().n, 2)
  assert.deepEqual(sql.prepare('SELECT user_id,email,status FROM boing_identities ORDER BY user_id').all().map(row => ({ ...row })), [
    { user_id: 'member', email: 'member@example.com', status: 'active' },
    { user_id: 'owner', email: 'owner@example.com', status: 'active' },
  ])
  assert.equal(sql.prepare("SELECT ai_enabled FROM boing_organizations WHERE id='egm-org'").get().ai_enabled, 0)
})

test('a mid-batch failure rolls back copied data while preserving legacy and other tenants', async () => {
  const { db, sql } = setup({ failAt: 5 })
  await assert.rejects(migrateLegacyEgm(db, options), /simulated batch failure/)
  assert.equal(count(sql, 'boing_migrations'), 0)
  assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM boing_organizations WHERE id='egm-org'").get().n, 0)
  assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM boing_memberships WHERE organization_id='egm-org'").get().n, 0)
  assert.equal(sql.prepare('SELECT body FROM snapshots WHERE id=1').get().body, '{"stars":42}')
  assert.equal(sql.prepare("SELECT body FROM boing_snapshots WHERE project_id='other-project'").get().body, 'other-data')
})

test('missing snapshot or presentation fails before creating migration records', async () => {
  for (const table of ['snapshots', 'presentation']) {
    const { db, sql } = setup()
    sql.exec(`DELETE FROM ${table} WHERE id=1`)
    await assert.rejects(migrateLegacyEgm(db, options), /legacy snapshot and presentation required/)
    assert.equal(count(sql, 'boing_migrations'), 0)
    assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM boing_organizations WHERE id='egm-org'").get().n, 0)
  }
})
