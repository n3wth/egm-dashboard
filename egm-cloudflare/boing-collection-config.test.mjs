import test from 'node:test'
import assert from 'node:assert/strict'
import { collectionConfiguration, collectionReadiness } from './boing-collection-config.mjs'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'

test('collection configuration requires global and per-provider gates and credentials', () => {
  const configured = { BOING_COLLECTION_ENABLED: 'true', BOING_GITHUB_COLLECTION_ENABLED: 'true', GITHUB_APP_ID: '42', GITHUB_APP_PRIVATE_KEY: 'test', BOING_PAGESPEED_BUDGET_APPROVED: 'true', PAGESPEED_API_KEY: 'test', BOING_GITHUB_DAILY_CALL_LIMIT: '100', BOING_GITHUB_WORKSPACE_DAILY_CALL_LIMIT: '10', BOING_PAGESPEED_DAILY_CALL_LIMIT: '100', BOING_PAGESPEED_WORKSPACE_DAILY_CALL_LIMIT: '10' }
  assert.deepEqual(collectionConfiguration(configured), { github: true, website: true })
  assert.deepEqual(collectionConfiguration({ ...configured, BOING_COLLECTION_ENABLED: 'false' }), { github: false, website: false })
  assert.deepEqual(collectionConfiguration({ ...configured, GITHUB_APP_PRIVATE_KEY: '', BOING_PAGESPEED_BUDGET_APPROVED: 'false' }), { github: false, website: false })
  assert.deepEqual(collectionConfiguration({ ...configured, BOING_GITHUB_DAILY_CALL_LIMIT: '', BOING_PAGESPEED_WORKSPACE_DAILY_CALL_LIMIT: '' }), { github: false, website: false })
})

test('configured sources require both budget and execution storage with expected columns', async () => {
  const sql = new DatabaseSync(':memory:')
  const DB = { prepare(query) { return { bind() { return { async all() { return { results: sql.prepare(query).all() } } } } } } }
  const env = { DB, BOING_COLLECTION_ENABLED: 'true', BOING_GITHUB_COLLECTION_ENABLED: 'true', GITHUB_APP_ID: '42', GITHUB_APP_PRIVATE_KEY: 'test', BOING_GITHUB_DAILY_CALL_LIMIT: '100', BOING_GITHUB_WORKSPACE_DAILY_CALL_LIMIT: '10' }
  assert.deepEqual(await collectionReadiness(env), { github: false, website: false })
  sql.exec(readFileSync(new URL('./boing-provider-budget.sql', import.meta.url), 'utf8'))
  assert.deepEqual(await collectionReadiness(env), { github: false, website: false })
  sql.exec(readFileSync(new URL('./boing-execution-fence-migration.sql', import.meta.url), 'utf8'))
  assert.deepEqual(await collectionReadiness(env), { github: true, website: false })
  sql.exec('DROP TABLE boing_provider_call_budget; CREATE TABLE boing_provider_call_budget(day TEXT, provider TEXT, organization_id TEXT)')
  assert.deepEqual(await collectionReadiness(env), { github: false, website: false })
  assert.deepEqual(await collectionReadiness({ ...env, DB: { prepare() { throw new Error('private storage details') } } }), { github: false, website: false })
  sql.close()
})
