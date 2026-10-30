import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { reserveProviderCall, budgetedProviderRequest } from './boing-provider-budget.mjs'

function fixture() {
  const sql = new DatabaseSync(':memory:')
  sql.exec(readFileSync(new URL('./boing-provider-budget.sql', import.meta.url), 'utf8'))
  const DB = { prepare(query) { return { bind(...args) { return { async run() { return { meta: { changes: Number(sql.prepare(query).run(...args).changes) } } } } } } } }
  return { sql, env: { DB, BOING_GITHUB_DAILY_CALL_LIMIT: '3', BOING_GITHUB_WORKSPACE_DAILY_CALL_LIMIT: '2', BOING_PAGESPEED_DAILY_CALL_LIMIT: '2', BOING_PAGESPEED_WORKSPACE_DAILY_CALL_LIMIT: '1' } }
}

test('reservations atomically enforce provider and workspace daily limits', async () => {
  const { env, sql } = fixture(), now = Date.UTC(2026, 0, 1)
  const result = await Promise.all(Array.from({ length: 10 }, () => reserveProviderCall(env, 'github', 'a', now)))
  assert.equal(result.filter(Boolean).length, 2)
  assert.equal(await reserveProviderCall(env, 'github', 'b', now), true)
  assert.equal(await reserveProviderCall(env, 'github', 'c', now), false)
  assert.equal(await reserveProviderCall(env, 'pagespeed', 'a', now), true)
  assert.equal(await reserveProviderCall(env, 'pagespeed', 'a', now), false)
  assert.equal(await reserveProviderCall(env, 'github', 'a', now + 86400000), true)
  assert.equal(sql.prepare('SELECT SUM(calls) n FROM boing_provider_call_budget').get().n, 5)
})

test('network attempts are counted before failures and unconfigured budgets fail closed', async () => {
  const { env, sql } = fixture(), now = Date.UTC(2026, 0, 1)
  let calls = 0
  const fakeDb = { prepare() { return { bind() { return { async run() { const allowed = await reserveProviderCall(env, 'pagespeed', 'a', now); return { meta: { changes: allowed ? 1 : 0 } } } } } } } }
  const request = budgetedProviderRequest({ ...env, DB: fakeDb }, 'pagespeed', 'a', async () => { calls++; throw Error('offline') }, () => now, { id: 'job', claimId: 'claim', membershipRole: 'owner' })
  await assert.rejects(request('https://www.googleapis.com/test'))
  await assert.rejects(request('https://www.googleapis.com/test'))
  await assert.rejects(request('https://example.com/test'))
  assert.equal(calls, 1)
  assert.equal(sql.prepare('SELECT calls FROM boing_provider_call_budget').get().calls, 1)
  delete env.BOING_GITHUB_DAILY_CALL_LIMIT
  assert.equal(await reserveProviderCall(env, 'github', 'a', now), false)
  assert.equal(await reserveProviderCall({ ...env, DB: { prepare() { throw Error('missing table') } } }, 'pagespeed', 'a', now), false)
})
