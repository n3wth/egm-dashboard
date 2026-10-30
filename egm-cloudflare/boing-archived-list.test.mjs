import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { handleArchivedProjects } from './boing-archived-list.mjs'

function fixture() {
  const sql = new DatabaseSync(':memory:')
  sql.exec(readFileSync(new URL('./boing-tenancy-schema.sql', import.meta.url), 'utf8'))
  sql.exec(`INSERT INTO boing_identities VALUES('user_Owner','owner@example.com','active'),('user_Member','member@example.com','active');
    INSERT INTO boing_organizations VALUES('one','One','org_One','active',0,'now'),('two','Two','org_Two','active',0,'now');
    INSERT INTO boing_memberships VALUES('one','user_Owner','owner','active','now'),('one','user_Member','member','active','now');
    INSERT INTO boing_projects VALUES('p','one','Archived','private/repo','https://private.example','archived','now'),('q','two','Other',NULL,NULL,'archived','now'),('r','one','Active',NULL,NULL,'active','now');`)
  const db = { prepare(query) { return { bind(...args) { return {
    async first() { return sql.prepare(query).get(...args) ?? null },
    async all() { return { results: sql.prepare(query).all(...args) } }
  } } } } }
  const env = { DB: db, WORKOS_API_KEY: 'test' }
  const owner = { id: 'user_Owner', status: 'active', verified: 1 }
  const provider = async url => { const q = new URL(url).searchParams; return Response.json({ object: 'list', data: [{ user_id: q.get('user_id'), organization_id: q.get('organization_id'), status: 'active' }], list_metadata: { after: null } }) }
  const call = ({ actor = owner, org = 'one', requestWorkos = provider, method = 'GET' } = {}) => handleArchivedProjects(new Request('https://app.test/api/boing/projects/archived', { method }), env, actor, org, { requestWorkos })
  return { sql, call }
}

test('only an owner sees bounded minimal archived project information in their workspace', async () => {
  const { sql, call } = fixture()
  const response = await call()
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('cache-control'), 'private, no-store')
  assert.deepEqual(await response.json(), { projects: [{ id: 'p', name: 'Archived' }], truncated: false })
  assert.equal((await call({ actor: { id: 'user_Member', verified: 1, status: 'active' } })).status, 403)
  assert.equal((await call({ org: 'two' })).status, 403)
  assert.equal((await call({ method: 'POST' })).status, 405)
  for (let n = 0; n < 101; n++) sql.prepare("INSERT INTO boing_projects VALUES(?, 'one', ?,NULL,NULL,'archived','now')").run(`p${n}`, `Item ${n}`)
  const data = await (await call()).json()
  assert.equal(data.projects.length, 100)
  assert.equal(data.truncated, true)
})

test('provider outage and mapping changes fail closed', async () => {
  const { sql, call } = fixture()
  assert.equal((await call({ requestWorkos: async () => { throw Error('offline') } })).status, 503)
  const remap = async () => { sql.exec("UPDATE boing_organizations SET workos_organization_id='org_Changed' WHERE id='one'"); return Response.json({ object: 'list', data: [{ user_id: 'user_Owner', organization_id: 'org_One', status: 'active' }], list_metadata: { after: null } }) }
  assert.equal((await call({ requestWorkos: remap })).status, 403)
})
