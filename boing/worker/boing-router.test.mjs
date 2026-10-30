import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { createHash, generateKeyPairSync } from 'node:crypto'
import { handleBoingRoute } from './boing-router.mjs'
import { GITHUB_APP_SCHEMA } from './boing-github-app.mjs'
import { JOBS_SCHEMA } from './boing-jobs.mjs'
import { INVITES_SCHEMA } from './boing-invites.mjs'
import { BOING_QUOTA_SCHEMA } from './boing-quotas.mjs'
import { BOING_AI_CONSENT_SCHEMA } from './boing-ai-settings.mjs'
import { AUDIT_SCHEMA } from './boing-audit.mjs'
import { BOING_MEMBERSHIP_AUDIT_SCHEMA } from './boing-membership-admin.mjs'

const user = { id: 'user_123', verified: 1, status: 'active' }
function setup() {
  const sql = new DatabaseSync(':memory:')
  sql.exec(readFileSync(new URL('../../egm-cloudflare/schema.sql', import.meta.url), 'utf8'))
  sql.exec(readFileSync(new URL('./boing-tenancy-schema.sql', import.meta.url), 'utf8'))
  sql.exec(GITHUB_APP_SCHEMA)
  sql.exec(JOBS_SCHEMA)
  sql.exec(readFileSync(new URL('./boing-provider-budget.sql', import.meta.url), 'utf8'))
  sql.exec(readFileSync(new URL('./boing-execution-fence-migration.sql', import.meta.url), 'utf8'))
  sql.exec(INVITES_SCHEMA)
  sql.exec(BOING_QUOTA_SCHEMA)
  sql.exec(BOING_AI_CONSENT_SCHEMA)
  sql.exec(AUDIT_SCHEMA)
  sql.exec(BOING_MEMBERSHIP_AUDIT_SCHEMA)
  sql.exec(`INSERT INTO users(id,email,name,verified,status,created_at) VALUES('user_123','a@example.com','A',1,'approved','now');
    INSERT INTO boing_identities SELECT id,email,'active' FROM users WHERE status='approved' AND verified=1;
    INSERT INTO boing_organizations VALUES('a','A','org_A','active',1,'now'),('b','B','org_B','active',1,'now');
    INSERT INTO boing_memberships VALUES('a','user_123','owner','active','now'),('b','user_123','owner','active','now');
    INSERT INTO boing_projects VALUES('pa','a','A',NULL,NULL,'active','now'),('pb','b','B',NULL,NULL,'active','now');
    INSERT INTO boing_snapshots VALUES('pa','{"stars":1}','now'),('pb','{"secret":2}','now');`)
  const disclosure = 'Cloudflare Workers AI processes project snapshot data.'
  sql.prepare('INSERT INTO boing_ai_consents VALUES(?,?,?,?)').run('a', createHash('sha256').update(disclosure).digest('hex'), user.id, 'now')
  const DB = { prepare(query) { return { bind(...args) { return {
    async first() { return sql.prepare(query).get(...args) ?? null },
    async all() { return { results: sql.prepare(query).all(...args) } },
    async run() { const r = sql.prepare(query).run(...args); return { meta: { changes: Number(r.changes) } } }
  } } } }, async batch(statements) {
    sql.exec('BEGIN')
    try { const result = []; for (const statement of statements) result.push(await statement.run()); sql.exec('COMMIT'); return result } catch (error) { sql.exec('ROLLBACK'); throw error }
  } }
  const env = { DB, WORKOS_API_KEY: 'test', APP_URL: 'https://app.test', BOING_AI_BUDGET_APPROVED: 'true', BOING_AI_PROCESSOR_DISCLOSURE: disclosure, AI: { async run() { return { response: 'One star.' } } } }
  const requestWorkos = async url => {
    const org = new URL(url).searchParams.get('organization_id')
    return Response.json({ object: 'list', data: [{ user_id: user.id, organization_id: org, status: org === 'org_A' ? 'active' : 'inactive' }], list_metadata: { after: null } })
  }
  return { env, requestWorkos, sql }
}
const req = (path, init) => new Request(`https://app.test${path}`, init)
test('workspace export routes through owner and project guards and excludes other tenants', async () => {
  const { env, sql, requestWorkos } = setup()
  sql.exec(readFileSync(new URL('./boing-metric-history-migration.sql', import.meta.url), 'utf8'))
  sql.exec("DELETE FROM boing_snapshots WHERE project_id='pa'; UPDATE boing_projects SET website_url='https://example.com' WHERE id='pa'; INSERT INTO boing_source_versions VALUES('pa','website',1); INSERT INTO boing_collection_results VALUES('pa','website',1,'{\"performanceScore\":88}','now');")
  const response = await handleBoingRoute(req('/api/boing/workspace/export'), env, user, 'a', { requestWorkos })
  assert.equal(response.status, 200)
  const data = await response.json()
  assert.deepEqual(data.projects.map(project => project.project.id), ['pa'])
  assert.equal(data.projects[0].sources.website.data.performanceScore, 88)
  assert.doesNotMatch(JSON.stringify(data), /secret/)
  sql.exec("UPDATE boing_memberships SET role='admin' WHERE organization_id='a' AND user_id='user_123'")
  assert.equal((await handleBoingRoute(req('/api/boing/workspace/export'), env, user, 'a', { requestWorkos })).status, 404)
  sql.exec("UPDATE boing_memberships SET role='owner' WHERE organization_id='a' AND user_id='user_123'; INSERT INTO boing_snapshots VALUES('pa','{\"private\":true}','now')")
  assert.equal((await handleBoingRoute(req('/api/boing/workspace/export'), env, user, 'a', { requestWorkos })).status, 403)
  assert.equal((await handleBoingRoute(req('/api/boing/workspace/export', { method: 'POST' }), env, user, 'a', { requestWorkos })).status, 405)
})
test('manual collection requires origin, configured budget, execution context, and verified owner binding', async () => {
  const { env, sql } = setup()
  sql.exec(readFileSync(new URL('./boing-membership-binding-migration.sql', import.meta.url), 'utf8'))
  sql.exec("INSERT INTO boing_workos_membership_bindings VALUES('a','user_123','om_123','2026-01-01T00:00:00Z'); UPDATE boing_projects SET website_url='https://example.com' WHERE id='pa'; INSERT INTO boing_source_versions VALUES('pa','website',1)")
  Object.assign(env, { BOING_MEMBERSHIP_BINDING_REQUIRED: 'true', BOING_COLLECTION_ENABLED: 'true', BOING_PAGESPEED_BUDGET_APPROVED: 'true', PAGESPEED_API_KEY: 'test', BOING_PAGESPEED_DAILY_CALL_LIMIT: '100', BOING_PAGESPEED_WORKSPACE_DAILY_CALL_LIMIT: '10' })
  const requestWorkos = async () => Response.json({ object: 'list', data: [{ id: 'om_123', updated_at: '2026-01-01T00:00:00Z', user_id: user.id, organization_id: 'org_A', status: 'active' }], list_metadata: { after: null } })
  const make = (origin = 'https://app.test') => req('/api/boing/projects/pa/collect', { method: 'POST', headers: { origin } })
  let promise, count = 0
  const options = { requestWorkos, waitUntil(p) { promise = p }, async runJob(_env, id) { assert.match(id, /^[a-f0-9-]+$/); count++ } }
  assert.equal((await handleBoingRoute(make('https://evil.test'), env, user, 'a', options)).status, 403)
  assert.equal((await handleBoingRoute(make(), { ...env, BOING_PAGESPEED_BUDGET_APPROVED: 'false' }, user, 'a', options)).status, 503)
  assert.equal((await handleBoingRoute(make(), env, user, 'a', { requestWorkos })).status, 503)
  assert.equal(sql.prepare('SELECT count(*) n FROM boing_collection_jobs').get().n, 0)
  assert.equal((await handleBoingRoute(make(), env, user, 'a', options)).status, 202)
  await promise
  assert.equal(count, 1)
  assert.equal((await handleBoingRoute(make(), env, user, 'a', options)).status, 409)
})
const privateKey = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } }).privateKey
const requestGithub = async url => url.endsWith('/access_tokens') ? Response.json({ token: 'test-token', expires_at: '2099-01-01' }) : Response.json({ total_count: 1, repositories: [{ id: 123, full_name: 'account/repo' }] })

test('collection status shows only the latest current-source job to authorized project members', async () => {
  const { env, sql, requestWorkos } = setup()
  sql.exec(`UPDATE boing_projects SET website_url='https://example.com' WHERE id='pa';
    INSERT INTO boing_source_versions VALUES('pa','website',2);
    INSERT INTO boing_collection_jobs(id,organization_id,project_id,actor_id,kind,source_revision,status,created_at,expires_at,finished_at) VALUES
      ('old','a','pa','user_123','website',1,'completed','2026-01-01T00:00:00Z',9999999999999,'2026-01-01T00:01:00Z'),
      ('latest','a','pa','user_123','website',2,'completed','2026-01-02T00:00:00Z',9999999999999,'2026-01-02T00:01:00Z');`)
  const opts = { requestWorkos, requestGithub }
  const response = await handleBoingRoute(req('/api/boing/projects/pa/collection-status'), env, user, 'a', opts)
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('cache-control'), 'private, no-store')
  assert.deepEqual(await response.json(), { jobs: [{ kind: 'website', status: 'completed', createdAt: '2026-01-02T00:00:00Z', finishedAt: '2026-01-02T00:01:00Z' }] })
  assert.equal((await handleBoingRoute(req('/api/boing/projects/pb/collection-status'), env, user, 'a', opts)).status, 404)
  assert.equal((await handleBoingRoute(req('/api/boing/projects/pa/collection-status', { method: 'POST' }), env, user, 'a', opts)).status, 405)
  sql.exec("UPDATE boing_memberships SET role='member' WHERE organization_id='a'")
  assert.equal((await handleBoingRoute(req('/api/boing/projects/pa/collection-status'), env, user, 'a', opts)).status, 404)
  sql.exec("INSERT INTO boing_project_memberships(organization_id,project_id,user_id,created_at) VALUES('a','pa','user_123','now')")
  assert.equal((await handleBoingRoute(req('/api/boing/projects/pa/collection-status'), env, user, 'a', opts)).status, 200)
  sql.exec("UPDATE boing_organizations SET status='suspended' WHERE id='a'")
  assert.notEqual((await handleBoingRoute(req('/api/boing/projects/pa/collection-status'), env, user, 'a', opts)).status, 200)
})

test('collection status expires abandoned work and rejects a changed WorkOS membership binding', async () => {
  const { env, sql } = setup()
  sql.exec(readFileSync(new URL('./boing-membership-binding-migration.sql', import.meta.url), 'utf8'))
  sql.exec(`INSERT INTO boing_workos_membership_bindings VALUES('a','user_123','om_123','2026-01-01T00:00:00Z');
    UPDATE boing_projects SET website_url='https://example.com' WHERE id='pa';
    INSERT INTO boing_source_versions VALUES('pa','website',1);
    INSERT INTO boing_collection_jobs(id,organization_id,project_id,actor_id,kind,source_revision,status,created_at,expires_at)
      VALUES('expired','a','pa','user_123','website',1,'queued','2026-01-01T00:00:00Z',1);`)
  env.BOING_MEMBERSHIP_BINDING_REQUIRED = 'true'
  const requestWorkos = async () => Response.json({ object: 'list', data: [{ id: 'om_123', updated_at: '2026-01-01T00:00:00Z', user_id: user.id, organization_id: 'org_A', status: 'active' }], list_metadata: { after: null } })
  const endpoint = () => req('/api/boing/projects/pa/collection-status')
  const result = await handleBoingRoute(endpoint(), env, user, 'a', { requestWorkos, requestGithub })
  assert.equal((await result.json()).jobs[0].status, 'expired')
  sql.exec("UPDATE boing_workos_membership_bindings SET workos_updated_at='2026-01-02T00:00:00Z' WHERE organization_id='a'")
  assert.notEqual((await handleBoingRoute(endpoint(), env, user, 'a', { requestWorkos, requestGithub })).status, 200)
})

test('history is scoped to the authorized project and read-only', async () => {
  const { env, requestWorkos } = setup()
  const opts = { requestWorkos, requestGithub }
  const response = await handleBoingRoute(req('/api/boing/projects/pa/history'), env, user, 'a', opts)
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('cache-control'), 'private, no-store')
  assert.deepEqual((await response.json()).history, [])
  assert.equal((await handleBoingRoute(req('/api/boing/projects/pb/history'), env, user, 'a', opts)).status, 404)
  assert.equal((await handleBoingRoute(req('/api/boing/projects/pa/history', { method: 'POST' }), env, user, 'a', opts)).status, 405)
})

test('project exports include only current authorized metric history', async () => {
  const { env, requestWorkos, sql } = setup()
  bindGithub(sql, env)
  sql.exec(`INSERT INTO boing_metric_history VALUES
    ('a','pa','github',1,date('now'),'now','{"stars":9}'),
    ('a','pa','github',2,date('now'),'now','{"stars":999}');`)
  const opts = { requestWorkos, requestGithub }
  const response = await handleBoingRoute(req('/api/boing/projects/pa/export'), env, user, 'a', opts)
  assert.equal(response.status, 200)
  assert.deepEqual((await response.json()).history.map(row => row.metrics.stars), [9])
  assert.equal((await handleBoingRoute(req('/api/boing/projects/pb/export'), env, user, 'a', opts)).status, 404)
  sql.exec("UPDATE boing_github_installations SET status='suspended' WHERE installation_id=1")
  assert.notEqual((await handleBoingRoute(req('/api/boing/projects/pa/export'), env, user, 'a', opts)).status, 200)
})
function bindGithub(sql, env) {
  env.GITHUB_APP_ID = '1'; env.GITHUB_APP_PRIVATE_KEY = privateKey
  sql.exec("INSERT INTO boing_github_installations VALUES(1,'a',1,'account','active'); INSERT INTO boing_github_repositories VALUES('a','pa',1,123,'account/repo'); INSERT INTO boing_source_versions VALUES('pa','github',1)")
}

test('invitation management is owner-only, scoped, and requires same-origin writes', async () => {
  const { env, requestWorkos, sql } = setup()
  const opts = { requestWorkos }
  const make = (body, origin = 'https://app.test') => req('/api/boing/invitations', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body) })
  assert.equal((await handleBoingRoute(make({ email: 'b@example.com', role: 'member' }, 'https://evil.test'), env, user, 'a', opts)).status, 403)
  assert.equal((await handleBoingRoute(make({ email: 'b@example.com', role: 'member' }), env, user, 'b', opts)).status, 403)
  assert.equal((await handleBoingRoute(make({ email: 'b@example.com', role: 'owner' }), env, user, 'a', opts)).status, 400)
  const created = await handleBoingRoute(make({ email: 'b@example.com', role: 'member' }), env, user, 'a', opts)
  assert.equal(created.status, 201)
  assert.equal(created.headers.get('cache-control'), 'private, no-store')
  const record = (await created.json()).invitation
  assert.match(record.token, /^[A-Za-z0-9_-]{43}$/)
  const list = await (await handleBoingRoute(req('/api/boing/invitations'), env, user, 'a', opts)).json()
  assert.equal(list.invitations.length, 1)
  assert.equal(JSON.stringify(list).includes(record.token), false)
  const revoke = req(`/api/boing/invitations/${record.id}/revoke`, { method: 'POST', headers: { origin: 'https://app.test', 'content-type': 'application/json' }, body: '{}' })
  assert.equal((await handleBoingRoute(revoke, env, user, 'a', opts)).status, 200)
  sql.exec("UPDATE boing_memberships SET role='member' WHERE organization_id='a' AND user_id='user_123'")
  assert.equal((await handleBoingRoute(req('/api/boing/invitations'), env, user, 'a', opts)).status, 403)
})

test('invitation creation fails if the owner binding changes during verification', async () => {
  const { env, sql } = setup()
  sql.exec(readFileSync(new URL('./boing-membership-binding-migration.sql', import.meta.url), 'utf8'))
  sql.exec("INSERT INTO boing_workos_membership_bindings VALUES('a','user_123','om_123','2026-01-01T00:00:00Z')")
  env.BOING_MEMBERSHIP_BINDING_REQUIRED = 'true'
  let calls = 0
  const requestWorkos = async () => {
    if (++calls === 2) sql.exec("DELETE FROM boing_workos_membership_bindings WHERE organization_id='a' AND user_id='user_123'")
    return Response.json({ object: 'list', data: [{ id: 'om_123', updated_at: '2026-01-01T00:00:00Z', user_id: user.id, organization_id: 'org_A', status: 'active' }], list_metadata: { after: null } })
  }
  const request = req('/api/boing/invitations', { method: 'POST', headers: { origin: 'https://app.test', 'content-type': 'application/json' }, body: JSON.stringify({ email: 'guest@example.com', role: 'member' }) })
  assert.equal((await handleBoingRoute(request, env, user, 'a', { requestWorkos })).status, 403)
  assert.equal(sql.prepare('SELECT count(*) AS n FROM boing_invitations').get().n, 0)
})

test('routes real project, export and insight handlers with verified scope', async () => {
  const { env, requestWorkos, sql } = setup()
  const opts = { requestWorkos, requestGithub }
  const projects = await handleBoingRoute(req('/api/boing/projects'), env, user, 'a', opts)
  assert.equal(projects.status, 200)
  assert.deepEqual((await projects.json()).projects.map(p => p.id), ['pa'])
  // Legacy unbound snapshots require a separately verified migration policy.
  assert.equal((await handleBoingRoute(req('/api/boing/projects/pa/export'), env, user, 'a', opts)).status, 404)
  bindGithub(sql, env)
  assert.equal((await handleBoingRoute(req('/api/boing/projects/pa/export'), env, user, 'a', opts)).status, 200)
  const insight = req('/api/boing/insights', { method: 'POST', headers: { origin: 'https://app.test', 'content-type': 'application/json' }, body: JSON.stringify({ projectId: 'pa' }) })
  assert.equal((await handleBoingRoute(insight, env, user, 'a', opts)).status, 200)
})

test('does not return a project list after provider membership is revoked during the read', async () => {
  const { env } = setup()
  let active = true
  const requestWorkos = async () => Response.json({ object: 'list', data: active ? [{ user_id: user.id, organization_id: 'org_A', status: 'active' }] : [], list_metadata: { after: null } })
  const result = await handleBoingRoute(req('/api/boing/projects'), env, user, 'a', { requestWorkos,
    projectList: async () => { active = false; return { status: 'ok', projects: [{ id: 'pa', name: 'private project' }] } } })
  assert.equal(result.status, 403)
  assert.doesNotMatch(await result.text(), /private project/)
})

test('AI calls require an approved budget and a working quota store', async () => {
  const { env, requestWorkos, sql } = setup()
  let calls = 0
  env.AI.run = async () => { calls++; return { response: 'One star.' } }
  const insight = () => req('/api/boing/insights', { method: 'POST', headers: { origin: 'https://app.test', 'content-type': 'application/json' }, body: JSON.stringify({ projectId: 'pa' }) })
  env.BOING_AI_BUDGET_APPROVED = 'false'
  assert.equal((await handleBoingRoute(insight(), env, user, 'a', { requestWorkos })).status, 503)
  env.BOING_AI_BUDGET_APPROVED = 'true'
  sql.prepare('INSERT INTO boing_quota_usage VALUES(?,?,?,?,?,?)').run('a', user.id, 'ai.insight', Math.floor(Date.now() / 3600000) * 3600000, 20, Date.now())
  assert.equal((await handleBoingRoute(insight(), env, user, 'a', { requestWorkos })).status, 429)
  sql.exec('DROP TABLE boing_quota_usage')
  assert.equal((await handleBoingRoute(insight(), env, user, 'a', { requestWorkos })).status, 503)
  assert.equal(calls, 0)
})

test('routes workspace member management through verified tenant context', async () => {
  const { env, requestWorkos } = setup()
  const result = await handleBoingRoute(req('/api/boing/members'), env, user, 'a', { requestWorkos })
  assert.equal(result.status, 200)
  assert.ok(Array.isArray((await result.json()).members))
  assert.equal((await handleBoingRoute(req('/api/boing/members'), env, user, 'b', { requestWorkos })).status, 403)
})

test('project data routes require and recheck the server-side GitHub proof', async () => {
  const { env, requestWorkos } = setup()
  const request = () => req('/api/boing/projects/pa/snapshot')
  const denied = await handleBoingRoute(request(), env, user, 'a', { requestWorkos, authorizeData: async () => ({ status: 'denied' }) })
  assert.equal(denied.status, 404)
  const revoked = await handleBoingRoute(request(), env, user, 'a', {
    requestWorkos, authorizeData: async () => ({ status: 'allowed', proof: {} }), recheckData: async () => false
  })
  assert.equal(revoked.status, 503)
  assert.doesNotMatch(await revoked.text(), /stars/)
})

test('member revocation routes only to an authorized workspace owner', async () => {
  const { env, requestWorkos, sql } = setup()
  sql.exec("INSERT INTO boing_identities VALUES('user_Target','target@example.com','active'); INSERT INTO boing_memberships VALUES('a','user_Target','member','active','now')")
  const request = req('/api/boing/members/user_Target/revoke', { method: 'POST', headers: { origin: 'https://app.test' } })
  assert.equal((await handleBoingRoute(request, env, user, 'a', { requestWorkos })).status, 200)
  assert.equal(sql.prepare("SELECT status FROM boing_memberships WHERE organization_id='a' AND user_id='user_Target'").get().status, 'suspended')
})

test('workspace audit is available only in the verified owner scope', async () => {
  const { env, requestWorkos, sql } = setup()
  sql.exec("INSERT INTO boing_audit_events VALUES('event-a','a','user_123',NULL,'workspace.created','2026-01-01')")
  const response = await handleBoingRoute(req('/api/boing/audit'), env, user, 'a', { requestWorkos })
  assert.equal(response.status, 200)
  assert.equal((await response.json()).events.length, 1)
  assert.equal((await handleBoingRoute(req('/api/boing/audit'), env, user, 'b', { requestWorkos })).status, 403)
})

test('archive and restore are scoped owner operations and keep prior snapshots invalidated', async () => {
  const { env, requestWorkos, sql } = setup()
  const request = action => req(`/api/boing/projects/pa/${action}`, { method: 'POST', headers: { origin: 'https://app.test' } })
  assert.equal((await handleBoingRoute(request('archive'), env, user, 'a', { requestWorkos })).status, 200)
  assert.equal(sql.prepare("SELECT status FROM boing_projects WHERE id='pa'").get().status, 'archived')
  assert.equal((await handleBoingRoute(request('restore'), env, user, 'a', { requestWorkos })).status, 200)
  assert.equal(sql.prepare("SELECT count(*) AS n FROM boing_snapshot_invalidations WHERE project_id='pa'").get().n, 1)
})

test('denies cross-organization resource ids and revoked WorkOS membership', async () => {
  const { env, requestWorkos } = setup()
  const opts = { requestWorkos }
  for (const path of ['/api/boing/projects/pb/snapshot', '/api/boing/projects/pb/export']) {
    assert.equal((await handleBoingRoute(req(path), env, user, 'a', opts)).status, 404)
  }
  const insight = req('/api/boing/insights', { method: 'POST', headers: { origin: 'https://app.test', 'content-type': 'application/json' }, body: JSON.stringify({ projectId: 'pb' }) })
  assert.equal((await handleBoingRoute(insight, env, user, 'a', opts)).status, 403)
  assert.equal((await handleBoingRoute(req('/api/boing/projects'), env, user, 'b', opts)).status, 403)
})

test('fails closed without a verified user, valid context or available provider', async () => {
  const { env, requestWorkos } = setup()
  assert.equal(await handleBoingRoute(req('/api/legacy'), env, user, 'a', { requestWorkos }), null)
  assert.equal((await handleBoingRoute(req('/api/boing/projects'), env, null, 'a', { requestWorkos })).status, 401)
  assert.equal((await handleBoingRoute(req('/api/boing/projects'), env, user, 'missing', { requestWorkos })).status, 403)
  assert.equal((await handleBoingRoute(req('/api/boing/projects'), env, user, 'a', { requestWorkos: async () => { throw Error('offline') } })).status, 503)
})

test('withholds AI output if WorkOS membership is revoked or unavailable during inference', async () => {
  for (const state of ['revoked', 'unavailable', 'remapped']) {
    const { env, sql } = setup()
    bindGithub(sql, env)
    let inFlight = false
    env.AI.run = async () => {
      inFlight = true
      if (state === 'remapped') sql.exec("UPDATE boing_organizations SET workos_organization_id='org_C' WHERE id='a'")
      return { response: 'private result' }
    }
    const requestWorkos = async url => {
      if (inFlight && state === 'unavailable') throw Error('offline')
      const org = new URL(url).searchParams.get('organization_id')
      const status = inFlight && state === 'revoked' ? 'inactive' : 'active'
      return Response.json({ object: 'list', data: [{ user_id: user.id, organization_id: org, status }], list_metadata: { after: null } })
    }
    const request = req('/api/boing/insights', { method: 'POST', headers: { origin: 'https://app.test', 'content-type': 'application/json' }, body: JSON.stringify({ projectId: 'pa' }) })
    const response = await handleBoingRoute(request, env, user, 'a', { requestWorkos, requestGithub })
    assert.equal(response.status, state === 'unavailable' ? 503 : 403)
    assert.equal((await response.text()).includes('private result'), false)
  }
})

test('website endpoint requires a verified owner and exact origin, scopes updates and invalidates old snapshots', async () => {
  const { env, requestWorkos, sql } = setup()
  const opts = { requestWorkos }
  const put = (project, body, origin = 'https://app.test') => req(`/api/boing/projects/${project}/website`, { method: 'PUT', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body) })
  assert.equal((await handleBoingRoute(put('pa', { website: 'https://example.org/' }, 'https://evil.test'), env, user, 'a', opts)).status, 403)
  assert.equal((await handleBoingRoute(put('pb', { website: 'https://example.org/' }), env, user, 'a', opts)).status, 404)
  assert.equal((await handleBoingRoute(put('pa', { website: 'http://127.0.0.1/' }), env, user, 'a', opts)).status, 400)
  assert.equal((await handleBoingRoute(put('pa', { website: 'https://example.org/', extra: 1 }), env, user, 'a', opts)).status, 400)
  assert.equal((await handleBoingRoute(put('pa', { website: 'https://example.org/' }), env, user, 'b', opts)).status, 403)
  assert.equal((await handleBoingRoute(put('pa', { website: 'https://example.org/' }), env, user, 'a', opts)).status, 200)
  assert.equal(sql.prepare("SELECT website_url FROM boing_projects WHERE id='pa'").get().website_url, 'https://example.org/')
  assert.equal(sql.prepare("SELECT revision FROM boing_source_versions WHERE project_id='pa' AND kind='website'").get().revision, 1)
  assert.equal(sql.prepare("SELECT count(*) AS n FROM boing_snapshot_invalidations WHERE project_id='pa'").get().n, 1)
  assert.equal(sql.prepare("SELECT body FROM boing_snapshots WHERE project_id='pa'").get().body, '{"stars":1}')
  sql.exec("UPDATE boing_memberships SET role='member' WHERE organization_id='a' AND user_id='user_123'")
  assert.equal((await handleBoingRoute(put('pa', { website: null }), env, user, 'a', opts)).status, 404)
})

test('website endpoint rejects malformed, missing-origin, oversized and wrong-method requests', async () => {
  const { env, requestWorkos } = setup()
  const opts = { requestWorkos }
  const path = '/api/boing/projects/pa/website'
  assert.equal((await handleBoingRoute(req(path), env, user, 'a', opts)).status, 405)
  assert.equal((await handleBoingRoute(req(path, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{}' }), env, user, 'a', opts)).status, 403)
  assert.equal((await handleBoingRoute(req(path, { method: 'PUT', headers: { origin: 'https://app.test', 'content-type': 'text/plain' }, body: '{}' }), env, user, 'a', opts)).status, 415)
  assert.equal((await handleBoingRoute(req(path, { method: 'PUT', headers: { origin: 'https://app.test', 'content-type': 'application/json' }, body: '{' }), env, user, 'a', opts)).status, 400)
  assert.equal((await handleBoingRoute(req(path, { method: 'PUT', headers: { origin: 'https://app.test', 'content-type': 'application/json', 'content-length': '4097' }, body: '{}' }), env, user, 'a', opts)).status, 413)
  assert.equal((await handleBoingRoute(req(path, { method: 'PUT', headers: { origin: 'https://app.test', 'content-type': 'application/json' }, body: 'x'.repeat(4097) }), env, user, 'a', opts)).status, 413)
})
