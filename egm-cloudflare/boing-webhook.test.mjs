import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { BOING_WEBHOOK_SCHEMA, handleBoingGithubWebhook } from './boing-webhook.mjs'

function fixture() {
  const sql = new DatabaseSync(':memory:')
  sql.exec(BOING_WEBHOOK_SCHEMA)
  sql.exec(`CREATE TABLE boing_github_installations (installation_id INTEGER PRIMARY KEY,status TEXT);
    CREATE TABLE boing_github_repositories (installation_id INTEGER,project_id TEXT);
    CREATE TABLE boing_source_versions (project_id TEXT,kind TEXT,revision INTEGER,PRIMARY KEY(project_id,kind));
    CREATE TABLE boing_snapshot_invalidations (project_id TEXT PRIMARY KEY);
    INSERT INTO boing_github_installations VALUES (12,'active');
    INSERT INTO boing_github_repositories VALUES (12,'p');`)
  const db = { prepare(query) { return { bind(...args) { return { async run() { return { meta: { changes: Number(sql.prepare(query).run(...args).changes) } } } } } } },
    async batch(statements) { sql.exec('BEGIN'); try { const out = []; for (const s of statements) out.push(await s.run()); sql.exec('COMMIT'); return out } catch (e) { sql.exec('ROLLBACK'); throw e } } }
  return { sql, env: { DB: db, GITHUB_APP_ID: '55', GITHUB_WEBHOOK_SECRET: 'test-secret' } }
}

async function signed(payload, { delivery = 'abc-123', secret = 'test-secret', event = 'installation' } = {}) {
  const raw = JSON.stringify(payload)
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(raw)))
  const sig = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
  return new Request('https://app.example.test/hook', { method: 'POST', headers: { 'x-github-delivery': delivery, 'x-github-event': event, 'x-hub-signature-256': `sha256=${sig}` }, body: raw })
}
const payload = { action: 'suspend', installation: { id: 12, app_id: 55 } }

test('signed suspension updates installation and rejects duplicate id or body', async () => {
  const { sql, env } = fixture()
  assert.equal((await handleBoingGithubWebhook(await signed(payload), env)).status, 200)
  assert.equal(sql.prepare('SELECT status FROM boing_github_installations').get().status, 'suspended')
  assert.equal(sql.prepare('SELECT revision FROM boing_source_versions').get().revision, 1)
  assert.equal((await (await handleBoingGithubWebhook(await signed(payload), env)).json()).duplicate, true)
  sql.exec("UPDATE boing_github_installations SET status='active'")
  assert.equal((await (await handleBoingGithubWebhook(await signed(payload, { delivery: 'different' }), env)).json()).duplicate, true)
  assert.equal(sql.prepare('SELECT status FROM boing_github_installations').get().status, 'suspended')
  assert.equal(sql.prepare('SELECT count(*) AS n FROM boing_github_deliveries').get().n, 1)
})

test('invalid signatures, wrong app, wrong event, and reactivation fail closed', async () => {
  const { sql, env } = fixture()
  assert.equal((await handleBoingGithubWebhook(await signed(payload, { secret: 'bad' }), env)).status, 401)
  assert.equal((await handleBoingGithubWebhook(await signed({ ...payload, installation: { id: 12, app_id: 999 } }), env)).status, 400)
  assert.equal((await handleBoingGithubWebhook(await signed(payload, { event: 'push' }), env)).status, 400)
  assert.equal((await handleBoingGithubWebhook(await signed({ ...payload, action: 'unsuspend' }), env)).status, 400)
  assert.equal(sql.prepare('SELECT status FROM boing_github_installations').get().status, 'active')
  assert.equal(sql.prepare('SELECT count(*) AS n FROM boing_github_deliveries').get().n, 0)
})

test('bound request and missing database fail closed', async () => {
  const { env } = fixture()
  const oversized = new Request('https://example.test/', { method: 'POST', headers: { 'x-github-delivery': 'a', 'x-github-event': 'installation', 'content-length': String(1024 * 1024 + 1) }, body: 'x' })
  assert.equal((await handleBoingGithubWebhook(oversized, env)).status, 413)
  assert.equal((await handleBoingGithubWebhook(await signed(payload), {})).status, 503)
})

test('signed repository removal disables the installation and invalidates bound projects', async () => {
  const { sql, env } = fixture()
  sql.exec("INSERT INTO boing_github_repositories VALUES(12,'other'); INSERT INTO boing_source_versions VALUES('p','github',4),('other','github',8)")
  const removed = { action: 'removed', installation: { id: 12, app_id: 55 }, repositories_removed: [{ id: 91 }] }
  const response = await handleBoingGithubWebhook(await signed(removed, { event: 'installation_repositories' }), env)
  assert.equal(response.status, 200)
  assert.equal(sql.prepare('SELECT status FROM boing_github_installations').get().status, 'suspended')
  assert.equal(sql.prepare("SELECT revision FROM boing_source_versions WHERE project_id='p'").get().revision, 5)
  assert.equal(sql.prepare("SELECT revision FROM boing_source_versions WHERE project_id='other'").get().revision, 9)
  assert.equal(sql.prepare('SELECT count(*) AS n FROM boing_snapshot_invalidations').get().n, 2)
  sql.exec("UPDATE boing_github_installations SET status='active'")
  assert.equal((await handleBoingGithubWebhook(await signed(removed, { event: 'installation_repositories', delivery: 'again' }), env)).status, 200)
  assert.equal(sql.prepare('SELECT status FROM boing_github_installations').get().status, 'suspended')
})

test('an added selection change with no removed repositories still fails closed', async () => {
  const { sql, env } = fixture()
  const changed = { action: 'added', installation: { id: 12, app_id: 55 }, repositories_added: [{ id: 92 }], repositories_removed: [] }
  assert.equal((await handleBoingGithubWebhook(await signed(changed, { event: 'installation_repositories' }), env)).status, 200)
  assert.equal(sql.prepare('SELECT status FROM boing_github_installations').get().status, 'suspended')
  assert.equal(sql.prepare('SELECT revision FROM boing_source_versions').get().revision, 1)
  assert.equal(sql.prepare('SELECT count(*) AS n FROM boing_snapshot_invalidations').get().n, 1)
})
