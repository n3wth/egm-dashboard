import test from 'node:test'
import assert from 'node:assert/strict'
import { collectionStatusLines, collectionSummary, formatObservedAt } from './collection-status.mjs'

test('the strip names the last success, a failure, and a closed window', () => {
  const lines = collectionStatusLines({ reason: 'failed', lastSuccessAt: '2026-10-01T03:04:00Z', status: 'failed' }, '2026-11-04T06:33:01Z', Date.parse('2026-10-28T00:00:00Z'), 'UTC')
  assert.equal(lines.reason, 'Failed')
  assert.equal(lines.success, `Last success ${formatObservedAt('2026-10-01T03:04:00Z', 'UTC')}`)
  assert.doesNotMatch(lines.success, /UTC/)
  assert.equal(collectionStatusLines({ reason: null, status: 'refreshed' }, '2026-11-04T06:33:01Z', Date.parse('2026-11-04T06:33:01Z')).reason, 'Collection window ended')
})

test('the summary counts sources that have a recorded success', () => {
  const sources = [
    { lastSuccessAt: '2026-10-01T00:00:00Z', reason: 'schedule', status: 'cached' },
    { lastSuccessAt: null, reason: 'unconfigured', status: 'unconfigured' }
  ]
  assert.equal(collectionSummary(sources, '2026-11-04T06:33:01Z', Date.parse('2026-10-28T00:00:00Z')).label, '1 of 2 sources healthy')
})
