import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { GITHUB_APP_SCHEMA } from './boing-github-app.mjs'
import { verifiedProjectList } from './boing-project-list.mjs'

const user = { id: 'user_owner', status: 'active', verified: 1 }
function fixture() {
  const sql = new DatabaseSync(':memory:')
  sql.exec(readFileSync(new URL('./boing-tenancy-schema.sql', import.meta.url), 'utf8'))
  sql.exec(GITHUB_APP_SCHEMA)
  sql.exec(`INSERT INTO boing_identities VALUES('user_owner','owner@example.com','active');
    INSERT INTO boing_organizations VALUES('one','One','org_One','active',0,'now'),('two','Two','org_Two','active',0,'now');
    INSERT INTO boing_memberships VALUES('one','user_owner','owner','active','now');
    INSERT INTO boing_projects VALUES('bound','one','Bound',NULL,NULL,'active','now'),('legacy','one','Legacy','legacy/private',NULL,'active','now'),('other','two','Other','other/private',NULL,'active','now');
    INSERT INTO boing_github_installations VALUES(1,'one',1,'account','active');
    INSERT INTO boing_github_repositories VALUES('one','bound',1,42,'account/repo');`)
  const DB = { prepare(query) { return { bind(...args) { return {
    async all() { return { results: sql.prepare(query).all(...args) } },
  } } } } }
  return { sql, env: { DB } }
}
const binding = { repositoryFullName: 'account/repo' }

test('lists only tenant projects and discloses repository names only with fresh proof', async () => {
  const { env } = fixture()
  const calls = []
  const result = await verifiedProjectList(env, user, 'one', {
    verify: async (_env, _user, org, id) => { calls.push([org, id]); return id === 'bound' ? { status: 'verified', binding } : { status: 'unbound' } },
    recheck: async (_env, _user, org, id, proof) => org === 'one' && id === 'bound' && proof === binding,
  })
  assert.equal(result.status, 'ok')
  assert.deepEqual(result.projects.map(row => [row.id, row.repository]), [['bound', 'account/repo'], ['legacy', null]])
  assert.deepEqual(calls, [['one', 'bound'], ['one', 'legacy']])
})

test('provider outage or changed proof fails closed', async () => {
  const { env, sql } = fixture()
  assert.deepEqual(await verifiedProjectList(env, user, 'one', { verify: async () => ({ status: 'unavailable' }) }), { status: 'unavailable' })
  assert.deepEqual(await verifiedProjectList(env, user, 'one', {
    verify: async (_env, _user, _org, id) => id === 'bound' ? { status: 'verified', binding } : { status: 'unbound' },
    recheck: async () => false,
  }), { status: 'unavailable' })
  assert.deepEqual(await verifiedProjectList(env, user, 'one', {
    verify: async () => { sql.exec("UPDATE boing_memberships SET status='suspended' WHERE organization_id='one'"); return { status: 'denied' } },
  }), { status: 'unavailable' })
})

test('denied and suspended repositories never disclose names', async () => {
  const { env, sql } = fixture()
  sql.exec("UPDATE boing_github_installations SET status='suspended' WHERE installation_id=1")
  const result = await verifiedProjectList(env, user, 'one', { verify: async () => ({ status: 'denied' }) })
  assert.equal(result.status, 'ok')
  assert.ok(result.projects.every(row => row.repository === null))
})
