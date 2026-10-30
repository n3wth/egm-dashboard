import test from 'node:test'
import assert from 'node:assert/strict'
import { collectionStatusLines } from './collection-status.mjs'

test('the strip names the last success, a failure, and a closed window', () => {
  assert.deepEqual(collectionStatusLines({ reason: 'failed', lastSuccessAt: '2026-10-01T03:04:00Z', status: 'failed' }, '2026-11-04T06:33:01Z', Date.parse('2026-10-28T00:00:00Z')), {
    success: 'Last success 2026-10-01 03:04 UTC',
    reason: 'Failed'
  })
  assert.equal(collectionStatusLines({ reason: null, status: 'refreshed' }, '2026-11-04T06:33:01Z', Date.parse('2026-11-04T06:33:01Z')).reason, 'Collection window ended')
})
