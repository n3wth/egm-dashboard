import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { AUDIT_SCHEMA } from './boing-audit.mjs'
import { handleBoingMembers } from './boing-members.mjs'

function fixture() {
  const sql = new DatabaseSync(':memory:')
  sql.exec(readFileSync(new URL('./boing-tenancy-schema.sql', import.meta.url), 'utf8'))
  sql.exec(AUDIT_SCHEMA)
  sql.exec(`INSERT INTO boing_identities VALUES ('user_Owner','owner@example.com','active'),('user_Member','member@example.com','active'),('user_Other','other@example.com','active');
    INSERT INTO boing_organizations VALUES ('one','One','org_One','active',0,'now'),('two','Two','org_Two','active',0,'now');
    INSERT INTO boing_memberships VALUES ('one','user_Owner','owner','active','now'),('one','user_Member','member','active','now'),('two','user_Owner','owner','active','now'),('two','user_Other','member','active','now');
    INSERT INTO boing_projects VALUES ('p1','one','One',NULL,NULL,'active','now'),('p2','two','Two',NULL,NULL,'active','now');`)
  const db = { prepare(query) { return { bind(...args) { return {
    async first() { return sql.prepare(query).get(...args) ?? null },
    async all() { return { results: sql.prepare(query).all(...args) } },
    async run() { return { meta: { changes: Number(sql.prepare(query).run(...args).changes) } } }
  } } } }, async batch(statements) { sql.exec('BEGIN'); try { const rows = []; for (const statement of statements) rows.push(await statement.run()); sql.exec('COMMIT'); return rows } catch (error) { sql.exec('ROLLBACK'); throw error } } }
  const env = { DB: db, APP_URL: 'https://app.test', WORKOS_API_KEY: 'test' }
  const user = { id: 'user_Owner', status: 'active', verified: 1 }
  const requestWorkos = async url => { const query = new URL(url).searchParams; return Response.json({ object: 'list', data: [{ user_id: query.get('user_id'), organization_id: query.get('organization_id'), status: 'active' }], list_metadata: { after: null } }) }
  const call = (path, init = {}, actor = user, org = 'one', provider = requestWorkos) => handleBoingMembers(new Request(`https://app.test${path}`, init), env, actor, org, { requestWorkos: provider })
  const put = (id, enabled, origin = 'https://app.test') => ({ method: 'PUT', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ userId: id, enabled }) })
  return { sql, call, put, env }
}

test('lists local workspace members only to a freshly verified owner', async () => {
  const { call } = fixture()
  const result = await call('/api/boing/members')
  assert.equal(result.status, 200)
  assert.deepEqual((await result.json()).members.map(row => row.user_id).sort(), ['user_Member', 'user_Owner'])
  assert.equal((await call('/api/boing/members', {}, { id: 'user_Member', status: 'active', verified: 1 })).status, 403)
})

test('grant rejects a changed owner or target membership version during provider calls', async () => {
  for (const mode of ['ok', 'owner_provider', 'owner_local', 'target_local']) {
    const { sql, env, call, put } = fixture()
    sql.exec(readFileSync(new URL('./boing-membership-binding-migration.sql', import.meta.url), 'utf8'))
    sql.exec("INSERT INTO boing_workos_membership_bindings VALUES('one','user_Owner','om_Owner','2026-10-28T00:00:00.000Z'),('one','user_Member','om_Member','2026-10-28T00:00:00.000Z')")
    env.BOING_MEMBERSHIP_BINDING_REQUIRED = 'true'
    let ownerCalls = 0, targetCalls = 0
    const provider = async url => {
      const q = new URL(url).searchParams, id = q.get('user_id'), actor = id === 'user_Owner'
      if (actor) ownerCalls++; else targetCalls++
      if (actor && ownerCalls === 2 && mode === 'owner_local') sql.exec("UPDATE boing_workos_membership_bindings SET workos_updated_at='2026-10-28T00:00:01.000Z' WHERE user_id='user_Owner'")
      if (actor && ownerCalls === 2 && mode === 'target_local') sql.exec("UPDATE boing_workos_membership_bindings SET workos_updated_at='2026-10-28T00:00:01.000Z' WHERE user_id='user_Member'")
      const updated = actor && ownerCalls === 2 && mode === 'owner_provider' ? '2026-10-28T00:00:01.000Z' : '2026-10-28T00:00:00.000Z'
      return Response.json({ object: 'list', data: [{ id: actor ? 'om_Owner' : 'om_Member', user_id: id, organization_id: q.get('organization_id'), status: 'active', updated_at: updated }], list_metadata: { after: null } })
    }
    const response = await call('/api/boing/projects/p1/access', put('user_Member', true), undefined, 'one', provider)
    assert.equal(response.status, mode === 'ok' ? 200 : 404)
    assert.equal(sql.prepare('SELECT count(*) n FROM boing_project_memberships').get().n, mode === 'ok' ? 1 : 0)
    assert.ok(targetCalls >= 1)
  }
})

test('owner grants and revokes with audit in the same transaction and cannot cross workspace', async () => {
  const { call, put, sql } = fixture()
  assert.equal((await call('/api/boing/projects/p2/access', put('user_Other', true))).status, 404)
  assert.equal((await call('/api/boing/projects/p1/access', put('user_Member', true, 'https://evil.test'))).status, 403)
  assert.equal((await call('/api/boing/projects/p1/access', put('user_Member', true))).status, 200)
  assert.deepEqual((await (await call('/api/boing/projects/p1/access')).json()).userIds, ['user_Member'])
  assert.equal((await call('/api/boing/projects/p1/access', put('user_Member', false))).status, 200)
  assert.deepEqual(sql.prepare('SELECT action FROM boing_audit_events ORDER BY rowid').all().map(row => row.action), ['project.access_granted', 'project.access_revoked'])
})

test('provider revocation and remapping fail closed; audit failures roll back the grant', async () => {
  const { call, put, sql } = fixture()
  const provider = async url => { const q = new URL(url).searchParams; return Response.json({ object: 'list', data: [{ user_id: q.get('user_id'), organization_id: q.get('organization_id'), status: q.get('user_id') === 'user_Member' ? 'inactive' : 'active' }], list_metadata: { after: null } }) }
  assert.equal((await call('/api/boing/projects/p1/access', put('user_Member', true), undefined, 'one', provider)).status, 404)
  sql.exec('DROP TABLE boing_audit_events')
  assert.equal((await call('/api/boing/projects/p1/access', put('user_Member', true))).status, 503)
  assert.equal(sql.prepare('SELECT count(*) AS n FROM boing_project_memberships').get().n, 0)
})
