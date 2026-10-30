import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { GITHUB_APP_SCHEMA } from './boing-github-app.mjs'
import { JOBS_SCHEMA } from './boing-jobs.mjs'
import { handleBoingProjectExport as exportWithScope } from './boing-export.mjs'
const handleBoingProjectExport = (request, env, user) => exportWithScope(request, env, user, 'a')

function setup() {
  const sql = new DatabaseSync(':memory:')
  sql.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'))
  sql.exec(readFileSync(new URL('./boing-tenancy-schema.sql', import.meta.url), 'utf8'))
  sql.exec(GITHUB_APP_SCHEMA)
  sql.exec(JOBS_SCHEMA)
  sql.exec(`INSERT INTO users(id,email,name,verified,status,created_at) VALUES
    ('owner','o@example.com','Owner',1,'approved','now'),('member','m@example.com','Member',1,'approved','now');
    INSERT INTO boing_identities SELECT id,email,'active' FROM users WHERE status='approved' AND verified=1;
    INSERT INTO boing_organizations VALUES('a','A','wa','active',0,'now'),('b','B','wb','active',0,'now');
    INSERT INTO boing_projects VALUES('pa','a','Project A','a/a',NULL,'active','now'),('private','a','Private','a/private',NULL,'active','now'),('pb','b','Project B','b/b',NULL,'active','now');
    INSERT INTO boing_memberships VALUES('a','owner','owner','active','now'),('a','member','member','active','now');
    INSERT INTO boing_project_memberships VALUES('a','pa','member','now');
    INSERT INTO boing_snapshots VALUES('pa','{"value":"a"}','now'),('private','{"value":"private-secret"}','now'),('pb','{"value":"tenant-secret"}','now');
    INSERT INTO boing_presentations VALUES('pa','{"title":"A"}',1);`)
  const DB = { prepare(query) { return { bind(...args) { return { async first() { return sql.prepare(query).get(...args) ?? null } } } } } }
  return { sql, env: { DB } }
}
const user = id => ({ id, status: 'active', verified: 1 })
const req = (project, method = 'GET') => new Request(`https://app.boing.run/api/boing/projects/${project}/export`, { method })

test('exports only authorized project records as a no-store attachment', async () => {
  const { env } = setup()
  const res = await handleBoingProjectExport(req('pa'), env, user('member'))
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('cache-control'), 'private, no-store')
  assert.match(res.headers.get('content-disposition'), /^attachment/)
  const data = await res.json()
  assert.equal(data.project.id, 'pa')
  assert.equal(data.snapshot.data.value, 'a')
  assert.equal(data.presentation.revision, 1)
  for (const id of ['pb', 'private']) {
    const denied = await handleBoingProjectExport(req(id), env, user('member'))
    assert.equal(denied.status, 404)
    assert.doesNotMatch(await denied.text(), /secret/)
  }
  assert.equal((await handleBoingProjectExport(req('private'), env, user('owner'))).status, 200)
})

test('exports current collected sources and excludes stale, disconnected and cross-tenant data', async () => {
  const { env, sql } = setup()
  sql.exec(`UPDATE boing_projects SET website_url='https://project.example' WHERE id='pa';
    INSERT INTO boing_source_versions VALUES('pa','github',1),('pa','website',1),('pb','website',1);
    INSERT INTO boing_github_installations VALUES(1,'a',1,'account','active');
    INSERT INTO boing_github_repositories VALUES('a','pa',1,12,'account/repo');
    INSERT INTO boing_collection_results VALUES('pa','github',1,'{"stars":9}','g-now'),('pa','website',1,'{"score":88}','w-now'),('pb','website',1,'{"secret":"other"}','now');`)
  let data = await (await handleBoingProjectExport(req('pa'), env, user('owner'))).json()
  assert.equal(data.project.repository, 'account/repo')
  assert.equal(data.sources.github.data.stars, 9)
  assert.equal(data.sources.website.data.score, 88)
  assert.equal(data.sources.github.generatedAt, 'g-now')
  assert.doesNotMatch(JSON.stringify(data), /other/)
  sql.exec("UPDATE boing_source_versions SET revision=2 WHERE project_id='pa' AND kind='website'; UPDATE boing_github_installations SET status='suspended' WHERE installation_id=1")
  data = await (await handleBoingProjectExport(req('pa'), env, user('owner'))).json()
  assert.equal(data.project.repository, null)
  assert.deepEqual(data.sources, { github: null, website: null })
  assert.equal((await handleBoingProjectExport(req('pb'), env, user('owner'))).status, 404)
})

test('fails closed for oversized or malformed collected source records', async () => {
  const { env, sql } = setup()
  sql.exec("UPDATE boing_projects SET website_url='https://project.example' WHERE id='pa'; INSERT INTO boing_source_versions VALUES('pa','website',1); INSERT INTO boing_collection_results VALUES('pa','website',1,'bad','now')")
  assert.equal((await handleBoingProjectExport(req('pa'), env, user('owner'))).status, 503)
  sql.prepare("UPDATE boing_collection_results SET body=? WHERE project_id='pa'").run(JSON.stringify({ data: 'x'.repeat(1024 * 1024) }))
  assert.equal((await handleBoingProjectExport(req('pa'), env, user('owner'))).status, 413)
})

test('rejects unverified users, revoked grants and suspended memberships', async () => {
  const { env, sql } = setup()
  assert.equal((await handleBoingProjectExport(req('pa'), env, null)).status, 401)
  assert.equal((await handleBoingProjectExport(req('pa'), env, { ...user('member'), verified: 0 })).status, 401)
  assert.equal((await handleBoingProjectExport(req('pa', 'POST'), env, user('member'))).status, 405)
  sql.exec("DELETE FROM boing_project_memberships WHERE project_id='pa' AND user_id='member'")
  assert.equal((await handleBoingProjectExport(req('pa'), env, user('member'))).status, 404)
  sql.exec("UPDATE boing_memberships SET status='suspended' WHERE user_id='owner'")
  assert.equal((await handleBoingProjectExport(req('pa'), env, user('owner'))).status, 404)
})

test('fails closed for oversized and malformed stored data', async () => {
  const { env, sql } = setup()
  sql.prepare("UPDATE boing_snapshots SET body=? WHERE project_id='pa'").run(JSON.stringify({ data: 'x'.repeat(1024 * 1024) }))
  assert.equal((await handleBoingProjectExport(req('pa'), env, user('owner'))).status, 413)
  sql.exec("UPDATE boing_snapshots SET body='bad' WHERE project_id='pa'")
  assert.equal((await handleBoingProjectExport(req('pa'), env, user('owner'))).status, 503)
})

test('invalidated legacy snapshot is omitted while presentation remains exportable', async () => {
  const { env, sql } = setup()
  sql.exec("INSERT INTO boing_snapshot_invalidations VALUES('pa')")
  const response = await handleBoingProjectExport(req('pa'), env, user('owner'))
  const data = await response.json()
  assert.equal(response.status, 200)
  assert.equal(data.snapshot, null)
  assert.equal(data.presentation.data.title, 'A')
  assert.equal(sql.prepare("SELECT body FROM boing_snapshots WHERE project_id='pa'").get().body, '{"value":"a"}')
  sql.exec('DROP TABLE boing_snapshot_invalidations')
  assert.equal((await handleBoingProjectExport(req('pa'), env, user('owner'))).status, 503)
})

test('restricts stale local membership to the server-verified organization', async () => {
  const { env, sql } = setup()
  sql.exec("INSERT INTO boing_memberships VALUES('b','owner','owner','active','now')")
  assert.equal((await exportWithScope(req('pb'), env, user('owner'), 'a')).status, 404)
  assert.equal((await exportWithScope(req('pb'), env, user('owner'), 'b')).status, 200)
  assert.equal((await exportWithScope(req('pa'), env, user('owner'))).status, 403)
})
