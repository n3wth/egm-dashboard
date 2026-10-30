import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { BOING_IDENTITY_SCHEMA, authenticateBoingSession } from './boing-identity.mjs'
import { GITHUB_APP_SCHEMA } from './boing-github-app.mjs'
import { JOBS_SCHEMA } from './boing-jobs.mjs'
import { AUDIT_SCHEMA } from './boing-audit.mjs'
import { createBoingWorker } from './boing-worker.mjs'
import { handleBoingRoute } from './boing-router.mjs'

function fixture() {
  const sql = new DatabaseSync(':memory:')
  sql.exec('PRAGMA foreign_keys=ON')
  sql.exec(BOING_IDENTITY_SCHEMA)
  for (const file of ['boing-tenancy-schema.sql', 'boing-membership-binding-migration.sql']) sql.exec(readFileSync(new URL(`./${file}`, import.meta.url), 'utf8'))
  sql.exec(GITHUB_APP_SCHEMA)
  sql.exec(JOBS_SCHEMA)
  sql.exec(AUDIT_SCHEMA)
  const token = 'a'.repeat(43)
  const hash = createHash('sha256').update(token).digest('base64url')
  sql.exec(`INSERT INTO boing_identities VALUES('user_A','a@example.com','active'),('user_B','b@example.com','active');
    INSERT INTO boing_organizations VALUES('a','Workspace A','org_A','active',0,'now'),('b','Workspace B','org_B','active',0,'now');
    INSERT INTO boing_memberships VALUES('a','user_A','owner','active','now'),('b','user_B','owner','active','now');
    INSERT INTO boing_workos_membership_bindings VALUES('a','user_A','om_A','2026-01-01T00:00:00Z'),('b','user_B','om_B','2026-01-01T00:00:00Z');
    INSERT INTO boing_projects VALUES('pa','a','Project A',NULL,'https://a.example.com/','active','now'),('pb','b','Private project B',NULL,'https://b.example.com/','active','now');
    INSERT INTO boing_source_versions VALUES('pa','website',1),('pb','website',1);`)
  sql.prepare('INSERT INTO boing_sessions VALUES(?,?,?,?,NULL)').run(hash, 'user_A', 'session_A', Math.floor(Date.now() / 1000) + 1800)
  const DB = { prepare(query) { return { bind(...args) { return {
    async first() { return sql.prepare(query).get(...args) ?? null },
    async all() { return { results: sql.prepare(query).all(...args) } },
    async run() { return { meta: { changes: Number(sql.prepare(query).run(...args).changes) } } }
  } } } }, async batch(statements) {
    sql.exec('BEGIN')
    try { const result = []; for (const statement of statements) result.push(await statement.run()); sql.exec('COMMIT'); return result } catch (error) { sql.exec('ROLLBACK'); throw error }
  } }
  const env = { DB, APP_URL: 'https://app.test', WORKOS_API_KEY: 'test', WORKOS_CLIENT_ID: 'client_Test', WORKOS_RBAC_ISSUER: 'https://issuer.test', BOING_MEMBERSHIP_BINDING_REQUIRED: 'true' }
  let memberships = 0, revokeAt = Infinity
  const provider = async input => {
    const url = new URL(input)
    if (url.pathname === '/user_management/users/user_A/sessions') return Response.json({ data: [{ id: 'session_A', user_id: 'user_A', status: 'active', expires_at: new Date(Date.now() + 3600000).toISOString() }], list_metadata: { after: null } })
    if (url.pathname === '/user_management/users/user_A') return Response.json({ id: 'user_A', email: 'a@example.com', email_verified: true })
    if (url.pathname === '/user_management/organization_memberships') {
      memberships++
      const org = url.searchParams.get('organization_id'), user = url.searchParams.get('user_id')
      return Response.json({ object: 'list', data: [{ id: 'om_A', user_id: user, organization_id: org, status: memberships >= revokeAt ? 'inactive' : 'active', updated_at: '2026-01-01T00:00:00Z' }], list_metadata: { after: null } })
    }
    throw new Error('unexpected provider request')
  }
  const worker = createBoingWorker({
    authenticate: (e, value) => authenticateBoingSession(e, value, { request: provider }),
    route: (req, e, user, org, options) => handleBoingRoute(req, e, user, org, { ...options, requestWorkos: provider, requestGithub: provider })
  })
  const request = (path, org, init = {}) => new Request(`https://app.test${path}`, { ...init, headers: { cookie: `__Host-boing_session=${token}`, 'x-boing-organization': org, ...init.headers } })
  return { sql, env, worker, request, revokeDuringRead() { revokeAt = memberships + 2 } }
}

test('real worker and session reject cross-workspace selectors and project IDs', async () => {
  const f = fixture()
  const own = await f.worker.fetch(f.request('/api/boing/projects', 'a'), f.env)
  assert.equal(own.status, 200)
  assert.match(await own.text(), /Project A/)
  for (const suffix of ['snapshot', 'sources', 'history', 'export', 'collection-status']) {
    const response = await f.worker.fetch(f.request(`/api/boing/projects/pb/${suffix}`, 'a'), f.env)
    assert.ok([403, 404].includes(response.status), `${suffix}: ${response.status}`)
    assert.doesNotMatch(await response.text(), /Private project B|b\.example/)
  }
  for (const path of ['/api/boing/projects', '/api/boing/workspace/export']) {
    const response = await f.worker.fetch(f.request(path, 'b'), f.env)
    assert.equal(response.status, 403)
    assert.doesNotMatch(await response.text(), /Private project B|b\.example/)
  }
  const response = await f.worker.fetch(f.request('/api/boing/projects/pb/name', 'a', { method: 'PUT', headers: { origin: 'https://app.test', 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Intrusion' }) }), f.env)
  assert.ok([403, 404].includes(response.status), `rename: ${response.status} ${await response.text()}`)
  assert.equal(f.sql.prepare("SELECT name FROM boing_projects WHERE id='pb'").get().name, 'Private project B')
  f.sql.close()
})

test('real worker withholds a project list when WorkOS membership is revoked during a read', async () => {
  const f = fixture()
  f.revokeDuringRead()
  const response = await f.worker.fetch(f.request('/api/boing/projects', 'a'), f.env)
  assert.equal(response.status, 403)
  assert.doesNotMatch(await response.text(), /Project A|a\.example/)
  f.sql.close()
})
