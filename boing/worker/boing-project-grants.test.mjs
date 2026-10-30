import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { grantProjectAccess, listProjectGrants, revokeProjectAccess } from './boing-project-grants.mjs'
import { projectAccess } from './boing-tenancy.mjs'
import { BOING_IDENTITY_SCHEMA } from './boing-identity.mjs'
import { GITHUB_APP_SCHEMA } from './boing-github-app.mjs'

// No legacy users table: identities come only from BOING_IDENTITY_SCHEMA.
function fixture() {
  const sql = new DatabaseSync(':memory:')
  sql.exec('PRAGMA foreign_keys=ON')
  sql.exec(BOING_IDENTITY_SCHEMA)
  sql.exec(readFileSync(new URL('./boing-tenancy-schema.sql', import.meta.url), 'utf8'))
  sql.exec(GITHUB_APP_SCHEMA)
  sql.exec(`INSERT INTO boing_identities(user_id,email,status) VALUES
    ('owner','owner@example.com','active'),
    ('owner2','owner2@example.com','active'),
    ('member','member@example.com','active'),
    ('suspended','suspended@example.com','suspended');
    INSERT INTO boing_organizations VALUES('org1','One','workos1','active',0,'now'),('org2','Two','workos2','active',0,'now');
    INSERT INTO boing_projects VALUES('proj1','org1','One',NULL,NULL,'active','now'),('proj2','org2','Two',NULL,NULL,'active','now');
    INSERT INTO boing_memberships VALUES('org1','owner','owner','active','now'),('org1','member','member','active','now'),
      ('org1','suspended','member','active','now'),('org2','owner2','owner','active','now');`)
  const db = { prepare(query) { return { bind(...args) { return {
    async first() { return sql.prepare(query).get(...args) ?? null },
    async all() { return { results: sql.prepare(query).all(...args) } },
    async run() { return { meta: { changes: Number(sql.prepare(query).run(...args).changes) } } },
  } } } } }
  return { sql, db }
}

test('owner grants and revokes access for a member of the same organization', async () => {
  const { db } = fixture()
  assert.equal(await projectAccess(db, 'member', 'proj1', 'org1'), null)
  assert.equal(await grantProjectAccess(db, 'owner', 'proj1', 'member', 'now'), true)
  assert.equal((await projectAccess(db, 'member', 'proj1', 'org1')).id, 'proj1')
  assert.equal(await grantProjectAccess(db, 'owner', 'proj1', 'member', 'now'), false)
  assert.deepEqual((await listProjectGrants(db, 'owner', 'proj1')).map(x => x.user_id), ['member'])
  assert.equal(await revokeProjectAccess(db, 'owner', 'proj1', 'member'), true)
  assert.equal(await projectAccess(db, 'member', 'proj1', 'org1'), null)
  assert.equal(await revokeProjectAccess(db, 'owner', 'proj1', 'member'), false)
})

test('cross-tenant, non-owner, suspended and revoked users cannot change grants', async () => {
  const { db, sql } = fixture()
  assert.equal(await grantProjectAccess(db, 'owner2', 'proj1', 'member'), false)
  assert.equal(await grantProjectAccess(db, 'member', 'proj1', 'member'), false)
  assert.equal(await grantProjectAccess(db, 'owner', 'proj1', 'owner2'), false)
  assert.equal(await grantProjectAccess(db, 'owner', 'proj1', 'suspended'), false)
  assert.equal(await grantProjectAccess(db, 'owner', 'proj1', 'unknown'), false)
  assert.equal(await listProjectGrants(db, 'member', 'proj1'), null)
  assert.equal(await grantProjectAccess(db, 'owner', 'proj1', 'member'), true)
  assert.equal(await revokeProjectAccess(db, 'owner2', 'proj1', 'member'), false)
  sql.exec("UPDATE boing_memberships SET status='suspended' WHERE user_id='owner'")
  assert.equal(await revokeProjectAccess(db, 'owner', 'proj1', 'member'), false)
  assert.equal(await grantProjectAccess(db, 'owner', 'proj1', 'member'), false)
  assert.equal(await listProjectGrants(db, 'owner', 'proj1'), null)
})

test('a suspended Boing identity loses owner authority even with an active membership', async () => {
  const { db, sql } = fixture()
  assert.equal(await grantProjectAccess(db, 'owner', 'proj1', 'member'), true)
  sql.exec("UPDATE boing_identities SET status='suspended' WHERE user_id='owner'")
  assert.equal(await listProjectGrants(db, 'owner', 'proj1'), null)
  assert.equal(await revokeProjectAccess(db, 'owner', 'proj1', 'member'), false)
  assert.equal(await grantProjectAccess(db, 'owner', 'proj1', 'suspended'), false)
  sql.exec("UPDATE boing_identities SET status='active' WHERE user_id='owner'")
  assert.deepEqual((await listProjectGrants(db, 'owner', 'proj1')).map(x => x.user_id), ['member'])
  // A grant to a target whose identity is later suspended no longer grants project access.
  sql.exec("UPDATE boing_identities SET status='suspended' WHERE user_id='member'")
  assert.equal(await projectAccess(db, 'member', 'proj1', 'org1'), null)
  assert.equal(await revokeProjectAccess(db, 'owner', 'proj1', 'member'), true)
})

test('suspended organizations and archived projects reject mutations', async () => {
  const { db, sql } = fixture()
  sql.exec("UPDATE boing_organizations SET status='suspended' WHERE id='org1'")
  assert.equal(await grantProjectAccess(db, 'owner', 'proj1', 'member'), false)
  sql.exec("UPDATE boing_organizations SET status='active' WHERE id='org1'; UPDATE boing_projects SET status='archived' WHERE id='proj1'")
  assert.equal(await grantProjectAccess(db, 'owner', 'proj1', 'member'), false)
})
