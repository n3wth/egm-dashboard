import test from 'node:test'
import assert from 'node:assert/strict'
import { collectionSources, collectionWindow, monthBudget, monthlyCallCaps, planCollection } from './collection-schedule.mjs'

const until = '2026-11-04T06:33:01Z'

test('the collection window is only REFRESH_UNTIL', () => {
  const open = collectionWindow({ REFRESH_UNTIL: until }, Date.parse('2026-11-04T06:33:00Z'))
  assert.equal(open.open, true)
  assert.equal(Date.parse(open.endsAt), Date.parse(until))
  assert.equal(collectionWindow({ REFRESH_UNTIL: until }, Date.parse(until)).open, false)
  assert.equal(collectionWindow({ REFRESH_UNTIL: 'invalid' }).open, false)
})

test('a provider inside its current interval or monthly cap does not run', () => {
  const now = Date.parse('2026-10-28T12:00:00Z')
  const budget = monthBudget(null, now)
  const cached = { semrush_status: { rows: [{ status: 'available', nextAttemptAt: '2026-10-29T00:00:00Z', lastSuccessAt: '2026-10-28T00:00:00Z' }] } }
  assert.equal(planCollection('semrush', cached, budget, now), 'schedule')
  assert.equal(budget.calls.semrush, undefined)
  assert.equal(planCollection('semrush', {}, budget, now), 'run')
  assert.equal(budget.calls.semrush, 1)
  budget.calls.github = monthlyCallCaps.github
  assert.equal(planCollection('github', {}, budget, now), 'monthly_cap')
  const recent = { traffic: { source: { executedAt: new Date(now - 60 * 1000).toISOString() } } }
  const fresh = monthBudget(null, now)
  assert.equal(planCollection('github', recent, fresh, now), 'schedule')
})

test('source rows keep the last success and name a closed window', () => {
  const sources = collectionSources({
    queries: { semrush_status: { rows: [{ reason: 'provider_failed', lastSuccessAt: '2026-10-01T00:00:00Z' }] } },
    state: { semrush: 'failed', github: 'refreshed' },
    checkedAt: '2026-10-28T00:00:00Z',
    windowOpen: false
  })
  assert.equal(sources.find(source => source.id === 'semrush').reason, 'collection_window_ended')
  assert.equal(sources.find(source => source.id === 'semrush').lastSuccessAt, '2026-10-01T00:00:00Z')
  assert.equal(sources.find(source => source.id === 'github').lastSuccessAt, '2026-10-28T00:00:00Z')
})
