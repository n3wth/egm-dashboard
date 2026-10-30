import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { GITHUB_APP_SCHEMA } from './boing-github-app.mjs'
import { JOBS_SCHEMA } from './boing-jobs.mjs'
import { authorizeProjectData, recheckProjectData } from './boing-project-data-guard.mjs'

const user = { id: 'user_Owner', status: 'active', verified: 1 }
function fixture() {
  const sql = new DatabaseSync(':memory:')
  sql.exec(readFileSync(new URL('./boing-tenancy-schema.sql', import.meta.url), 'utf8'))
  sql.exec(GITHUB_APP_SCHEMA)
  sql.exec(JOBS_SCHEMA)
  sql.exec(`INSERT INTO boing_identities VALUES('user_Owner','owner@example.com','active');
    INSERT INTO boing_organizations VALUES('one','One','org_One','active',0,'now'),('two','Two','org_Two','active',0,'now');
    INSERT INTO boing_projects VALUES('p1','one','One',NULL,NULL,'active','now'),('p2','two','Two',NULL,NULL,'active','now');
    INSERT INTO boing_memberships VALUES('one','user_Owner','owner','active','now');`)
  const DB = { prepare(query) { return { bind(...args) { return { async first() { return sql.prepare(query).get(...args) ?? null } } } } } }
  return { sql, env: { DB } }
}
const noBinding = async () => ({ status: 'unbound' })

test('unbound website sources are allowed, but unverified legacy snapshots and repository names are not', async () => {
  const { sql, env } = fixture()
  const website = await authorizeProjectData(env, user, 'one', 'p1', 'sources', { verify: noBinding })
  assert.equal(website.status, 'allowed')
  assert.equal(await recheckProjectData(env, user, website.proof), true)
  sql.exec("INSERT INTO boing_snapshots VALUES('p1','{}','now')")
  for (const scope of ['snapshot', 'export', 'insight']) assert.equal((await authorizeProjectData(env, user, 'one', 'p1', scope, { verify: noBinding })).status, 'denied')
  assert.equal((await authorizeProjectData(env, user, 'one', 'p1', 'sources', { verify: noBinding })).status, 'allowed')
  sql.exec("DELETE FROM boing_snapshots; UPDATE boing_projects SET repository='example/legacy' WHERE id='p1'")
  assert.equal((await authorizeProjectData(env, user, 'one', 'p1', 'export', { verify: noBinding })).status, 'denied')
})

test('unbound proof is invalidated by a binding, legacy snapshot, mapping change or revoked membership', async () => {
  for (const mutation of [
    "INSERT INTO boing_github_installations VALUES(1,'one',1,'account','active'); INSERT INTO boing_github_repositories VALUES('one','p1',1,42,'account/repo')",
    "INSERT INTO boing_snapshots VALUES('p1','{}','now')",
    "UPDATE boing_organizations SET workos_organization_id='org_Changed' WHERE id='one'",
    "UPDATE boing_memberships SET status='suspended' WHERE user_id='user_Owner'"
  ]) {
    const { sql, env } = fixture()
    const result = await authorizeProjectData(env, user, 'one', 'p1', 'insight', { verify: noBinding })
    assert.equal(result.status, 'allowed')
    sql.exec(mutation)
    assert.equal(await recheckProjectData(env, user, result.proof), false)
  }
})

test('source proof is invalidated when the website changes during a read', async () => {
  for (const bound of [false, true]) {
    const { sql, env } = fixture()
    sql.exec("UPDATE boing_projects SET website_url='https://example.org/' WHERE id='p1'; INSERT INTO boing_source_versions VALUES('p1','website',1)")
    const binding = { workosOrganizationId: 'org_One', installationId: 1, repositoryId: 42, repositoryFullName: 'account/repo', revision: 1 }
    if (bound) sql.exec("INSERT INTO boing_github_installations VALUES(1,'one',1,'account','active'); INSERT INTO boing_github_repositories VALUES('one','p1',1,42,'account/repo'); INSERT INTO boing_source_versions VALUES('p1','github',1)")
    const result = await authorizeProjectData(env, user, 'one', 'p1', 'export', { verify: async () => bound ? { status: 'verified', binding } : { status: 'unbound' } })
    assert.equal(result.status, 'allowed')
    assert.equal(await recheckProjectData(env, user, result.proof), true)
    sql.exec("UPDATE boing_source_versions SET revision=2 WHERE project_id='p1' AND kind='website'")
    assert.equal(await recheckProjectData(env, user, result.proof), false)
  }
})

test('bound data requires provider verification and matching organization, then a fresh local recheck', async () => {
  const { sql, env } = fixture()
  sql.exec("INSERT INTO boing_github_installations VALUES(1,'one',1,'account','active'); INSERT INTO boing_github_repositories VALUES('one','p1',1,42,'account/repo'); INSERT INTO boing_source_versions VALUES('p1','github',1)")
  const binding = { workosOrganizationId: 'org_One', installationId: 1, repositoryId: 42, repositoryFullName: 'account/repo', revision: 1 }
  for (const status of ['denied', 'unavailable']) assert.notEqual((await authorizeProjectData(env, user, 'one', 'p1', 'export', { verify: async () => ({ status }) })).status, 'allowed')
  const result = await authorizeProjectData(env, user, 'one', 'p1', 'export', { verify: async () => ({ status: 'verified', binding }) })
  assert.equal(result.status, 'allowed')
  assert.equal(await recheckProjectData(env, user, result.proof), true)
  sql.exec("UPDATE boing_source_versions SET revision=2 WHERE project_id='p1'")
  assert.equal(await recheckProjectData(env, user, result.proof), false)
})

test('invalid scope, cross-tenant IDs, and access lost during verification fail closed', async () => {
  const { sql, env } = fixture()
  assert.equal((await authorizeProjectData(env, user, 'two', 'p2', 'sources', { verify: noBinding })).status, 'denied')
  assert.equal((await authorizeProjectData(env, user, 'one', 'p1', 'other', { verify: noBinding })).status, 'denied')
  const result = await authorizeProjectData(env, user, 'one', 'p1', 'sources', { verify: async () => {
    sql.exec("UPDATE boing_memberships SET status='suspended' WHERE user_id='user_Owner'")
    return { status: 'unbound' }
  } })
  assert.equal(result.status, 'denied')
})
