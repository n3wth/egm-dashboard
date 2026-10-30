import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { generateKeyPairSync } from 'node:crypto'
import { GITHUB_APP_SCHEMA } from './boing-github-app.mjs'
import { JOBS_SCHEMA } from './boing-jobs.mjs'
import { verifyGithubRepository, recheckGithubBinding } from './boing-github-verify.mjs'

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } })
const user = { id: 'user_123', status: 'active', verified: 1 }

function fixture() {
  const sql = new DatabaseSync(':memory:')
  sql.exec(readFileSync(new URL('./boing-tenancy-schema.sql', import.meta.url), 'utf8'))
  sql.exec(GITHUB_APP_SCHEMA)
  sql.exec(JOBS_SCHEMA)
  sql.exec(`INSERT INTO boing_identities VALUES('user_123','owner@example.com','active');
    INSERT INTO boing_organizations VALUES('one','One','org_One','active',0,'now'),('two','Two','org_Two','active',0,'now');
    INSERT INTO boing_projects VALUES('p1','one','One',NULL,NULL,'active','now'),('p2','two','Two',NULL,NULL,'active','now');
    INSERT INTO boing_memberships VALUES('one','user_123','owner','active','now');
    INSERT INTO boing_github_installations VALUES(1,'one',1,'account','active');
    INSERT INTO boing_github_repositories VALUES('one','p1',1,42,'account/repo');
    INSERT INTO boing_source_versions VALUES('p1','github',1);`)
  const DB = { prepare(query) { return { bind(...args) { return { async first() { return sql.prepare(query).get(...args) ?? null } } } } } }
  return { sql, env: { DB, GITHUB_APP_ID: '123', GITHUB_APP_PRIVATE_KEY: privateKey } }
}

function transport({ result = { total_count: 1, repositories: [{ id: 42, full_name: 'account/repo' }] }, afterMint, afterList } = {}) {
  const calls = []
  return { calls, request: async (url, options) => {
    calls.push(url)
    assert.equal(options.redirect, 'manual')
    if (url.endsWith('/access_tokens')) {
      const body = JSON.parse(options.body)
      assert.deepEqual(body.repository_ids, [42])
      assert.deepEqual(body.permissions, { metadata: 'read' })
      afterMint?.()
      return Response.json({ token: 'do-not-disclose', expires_at: '2099-01-01' })
    }
    assert.equal(url, 'https://api.github.com/installation/repositories?per_page=100&page=1')
    assert.equal(options.headers.authorization, 'Bearer do-not-disclose')
    afterList?.()
    return result instanceof Response ? result : Response.json(result)
  } }
}

test('verifies selected installation repository and rechecks its binding before release', async () => {
  const { sql, env } = fixture(), mock = transport()
  const result = await verifyGithubRepository(env, user, 'one', 'p1', { request: mock.request })
  assert.equal(result.status, 'verified')
  assert.equal(JSON.stringify(result).includes('do-not-disclose'), false)
  assert.equal(mock.calls.length, 2)
  assert.equal(await recheckGithubBinding(env, user, 'one', 'p1', result.binding), true)
  sql.exec("UPDATE boing_source_versions SET revision=2 WHERE project_id='p1'")
  assert.equal(await recheckGithubBinding(env, user, 'one', 'p1', result.binding), false)
})

test('denies cross-tenant access and requires an active local binding', async () => {
  const { sql, env } = fixture(), mock = transport()
  assert.equal((await verifyGithubRepository(env, user, 'two', 'p2', { request: mock.request })).status, 'denied')
  sql.exec("UPDATE boing_github_installations SET status='suspended' WHERE installation_id=1")
  assert.equal((await verifyGithubRepository(env, user, 'one', 'p1', { request: mock.request })).status, 'denied')
  assert.equal(mock.calls.length, 0)
})

test('fails closed on provider absence, mismatch, redirect, outage, or missing configuration', async () => {
  for (const result of [{ total_count: 0, repositories: [] }, { total_count: 1, repositories: [{ id: 99, full_name: 'account/repo' }] }, { total_count: 1, repositories: [{ id: 42, full_name: 'account/renamed' }] }, new Response(null, { status: 302, headers: { location: 'https://evil.test' } }), new Response(null, { status: 503 })]) {
    const { env } = fixture(), mock = transport({ result })
    assert.notEqual((await verifyGithubRepository(env, user, 'one', 'p1', { request: mock.request })).status, 'verified')
    assert.equal(mock.calls.length, 2)
  }
  const { env } = fixture()
  delete env.GITHUB_APP_PRIVATE_KEY
  assert.equal((await verifyGithubRepository(env, user, 'one', 'p1')).status, 'unavailable')
})

test('rejects oversized provider responses and installation-token failures', async () => {
  const { env } = fixture()
  let calls = 0
  const request = async (url, options) => {
    calls++
    assert.equal(options.redirect, 'manual')
    if (url.endsWith('/access_tokens')) return Response.json({ token: 'secret', expires_at: '2099-01-01' })
    return new Response('x'.repeat(262145))
  }
  assert.equal((await verifyGithubRepository(env, user, 'one', 'p1', { request })).status, 'unavailable')
  assert.equal(calls, 2)
  calls = 0
  assert.equal((await verifyGithubRepository(env, user, 'one', 'p1', { request: async () => { calls++; return new Response('', { status: 403 }) } })).status, 'unavailable')
  assert.equal(calls, 1)
})

test('revocation, repository rebinding, and revision changes during provider call deny release', async () => {
  for (const mutation of ["UPDATE boing_memberships SET status='suspended' WHERE user_id='user_123'", "UPDATE boing_github_repositories SET repository_id=43 WHERE project_id='p1'", "UPDATE boing_source_versions SET revision=2 WHERE project_id='p1'", "UPDATE boing_github_installations SET status='deleted' WHERE installation_id=1", "UPDATE boing_organizations SET workos_organization_id='org_Changed' WHERE id='one'"]) {
    const { sql, env } = fixture(), mock = transport({ afterList: () => sql.exec(mutation) })
    assert.equal((await verifyGithubRepository(env, user, 'one', 'p1', { request: mock.request })).status, 'denied')
  }
})

test('unbound project is distinct from verified data', async () => {
  const { sql, env } = fixture(), mock = transport()
  sql.exec("DELETE FROM boing_github_repositories WHERE project_id='p1'")
  assert.equal((await verifyGithubRepository(env, user, 'one', 'p1', { request: mock.request })).status, 'unbound')
  assert.equal(mock.calls.length, 0)
})
