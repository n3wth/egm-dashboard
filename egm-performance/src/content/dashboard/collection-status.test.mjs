import test from 'node:test'
import assert from 'node:assert/strict'
import { collectionStatusLines, collectionSummary, formatObservedAt } from './collection-status.mjs'

test('the strip names the last success, a failure, and a closed window', () => {
  const lines = collectionStatusLines({ reason: 'failed', lastSuccessAt: '2026-10-01T03:04:00Z', status: 'failed' }, '2026-11-04T06:33:01Z', Date.parse('2026-10-28T00:00:00Z'), 'UTC')
  assert.equal(lines.reason, 'Failed')
  assert.equal(lines.success, `Last success ${formatObservedAt('2026-10-01T03:04:00Z', 'UTC')}`)
  assert.match(lines.success, /UTC/)
  assert.equal(collectionStatusLines({ reason: null, status: 'refreshed' }, '2026-11-04T06:33:01Z', Date.parse('2026-11-04T06:33:01Z')).reason, 'Collection window ended')
})

test('the summary counts sources that have a recorded success', () => {
  const sources = [
    { lastSuccessAt: '2026-10-01T00:00:00Z', reason: 'schedule', status: 'cached' },
    { lastSuccessAt: null, reason: 'unconfigured', status: 'unconfigured' }
  ]
  assert.equal(collectionSummary(sources, '2026-11-04T06:33:01Z', Date.parse('2026-10-28T00:00:00Z')).label, '0 of 2 sources healthy')
  assert.equal(collectionStatusLines(sources[0],null,Date.parse('2026-10-28T00:00:00Z')).reason,'Stored data is more than 36 hours old')
})
test('health requires recent successful data and no exhausted budget',()=>{
  const now=Date.parse('2026-11-02T08:00:00Z')
  const source={lastSuccessAt:'2026-11-02T07:00:00Z',status:'cached',reason:'schedule'}
  assert.equal(collectionSummary([source],null,now).healthy,1)
  assert.equal(collectionSummary([{...source,reason:'monthly_cap'}],null,now).healthy,0)
  assert.match(formatObservedAt(source.lastSuccessAt),/PST/)
})
test('unknown observation timestamps do not become epoch dates',()=>{
  for(const value of [null,undefined,'','   ',0,false,'not a timestamp'])assert.equal(formatObservedAt(value),null)
})
