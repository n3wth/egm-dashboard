import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { AUDIT_SCHEMA } from './boing-audit.mjs'
import { handleBoingAuditView } from './boing-audit-view.mjs'

function fixture() {
  const sql = new DatabaseSync(':memory:')
  sql.exec(readFileSync(new URL('./boing-tenancy-schema.sql', import.meta.url), 'utf8'))
  sql.exec(AUDIT_SCHEMA)
  sql.exec(`INSERT INTO boing_identities VALUES ('user_Owner','owner@example.com','active'),('user_Member','member@example.com','active');
    INSERT INTO boing_organizations VALUES ('one','One','org_One','active',0,'now'),('two','Two','org_Two','active',0,'now');
    INSERT INTO boing_memberships VALUES ('one','user_Owner','owner','active','now'),('one','user_Member','member','active','now'),('two','user_Owner','owner','active','now');
    INSERT INTO boing_audit_events VALUES ('other','two','user_Owner',NULL,'other.event','2026-01-01');`)
  const db = { prepare(query) { return { bind(...args) { return { async first() { return sql.prepare(query).get(...args) ?? null }, async all() { return { results: sql.prepare(query).all(...args) } } } } } } }
  const env = { DB: db, WORKOS_API_KEY: 'test' }
  const user = { id: 'user_Owner', status: 'active', verified: 1 }
  const provider = async url => { const q = new URL(url).searchParams; return Response.json({ object: 'list', data: [{ user_id: q.get('user_id'), organization_id: q.get('organization_id'), status: 'active' }], list_metadata: { after: null } }) }
  const call = (actor = user, workos = provider, method = 'GET') => handleBoingAuditView(new Request('https://app.test/api/boing/audit', { method }), env, actor, 'one', { requestWorkos: workos })
  return { sql, call, provider }
}

test('returns bounded workspace-only events to a verified owner', async () => {
  const { sql, call } = fixture()
  const insert = sql.prepare('INSERT INTO boing_audit_events VALUES (?,?,?,?,?,?)')
  for (let n = 0; n < 55; n++) insert.run(`id${n}`, 'one', 'user_Owner', null, 'project.created', `2026-01-${String(n % 28 + 1).padStart(2, '0')}`)
  const response = await call()
  assert.equal(response.status, 200)
  assert.match(response.headers.get('cache-control'), /no-store/)
  const data = await response.json()
  assert.equal(data.events.length, 50)
  assert.equal(data.truncated, true)
  assert.ok(data.events.every(event => event.action === 'project.created'))
  assert.equal((await call({ id: 'user_Member', status: 'active', verified: 1 })).status, 403)
  assert.equal((await call(undefined, undefined, 'POST')).status, 405)
})

test('fails closed on provider errors, revocation and remapping during revalidation', async () => {
  const { sql, call, provider } = fixture()
  assert.equal((await call(undefined, async () => { throw new Error('offline') })).status, 503)
  let calls = 0
  const revoke = async url => { calls++; if (calls === 2) sql.exec("UPDATE boing_memberships SET status='suspended' WHERE user_id='user_Owner' AND organization_id='one'"); return provider(url) }
  assert.equal((await call(undefined, revoke)).status, 403)
  sql.exec("UPDATE boing_memberships SET status='active' WHERE user_id='user_Owner' AND organization_id='one'")
  calls = 0
  const remap = async url => { calls++; if (calls === 2) sql.exec("UPDATE boing_organizations SET workos_organization_id='org_New' WHERE id='one'"); return provider(url) }
  assert.equal((await call(undefined, remap)).status, 403)
})
