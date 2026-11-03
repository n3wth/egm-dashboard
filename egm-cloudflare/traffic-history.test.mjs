import test from 'node:test'
import assert from 'node:assert/strict'
import { mergeTrafficRows, trafficHistory } from './github-snapshot.mjs'

const day = (date, views, visitors = 1, clones = 0, cloners = 0) => ({ date, views, visitors, clones, cloners })

test('merged history keeps days beyond the current window in date order', () => {
  const rows = mergeTrafficRows([day('2026-10-02', 5), day('2026-10-01', 4)], [day('2026-10-03', 6)])
  assert.deepEqual(rows.map(row => row.date), ['2026-10-01', '2026-10-02', '2026-10-03'])
})

test('each day keeps the largest observed count per field, in any order', () => {
  const complete = day('2026-10-10', 40, 9, 12, 3)
  const truncated = day('2026-10-10', 7, 2, 20, 1)
  const expected = [day('2026-10-10', 40, 9, 20, 3)]
  assert.deepEqual(mergeTrafficRows([complete], [truncated]), expected)
  assert.deepEqual(mergeTrafficRows([truncated], [complete]), expected)
})

test('invalid rows are dropped instead of becoming zero-count days', () => {
  const rows = mergeTrafficRows([{ date: '2026-10-01', views: null, visitors: 1, clones: 0, cloners: 0 }, { date: 'Oct 2', views: 1, visitors: 1, clones: 0, cloners: 0 }, day('2026-10-03', -1)], [day('2026-10-04', 3)])
  assert.deepEqual(rows, [day('2026-10-04', 3)])
})

test('history is bounded to the most recent days', () => {
  const rows = Array.from({ length: 20 }, (_, index) => day(new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10), index))
  assert.deepEqual(mergeTrafficRows(rows, [], 5).map(row => row.views), [15, 16, 17, 18, 19])
})

test('history source covers the retained dates and explains non-additive uniques', () => {
  const history = trafficHistory([day('2026-09-30', 1)], [day('2026-10-13', 2), day('2026-10-14', 3)], '2026-10-14T12:00:00Z')
  assert.deepEqual(history.source.coverage, { startDate: '2026-09-30', endDate: '2026-10-14' })
  assert.equal(history.source.executedAt, '2026-10-14T12:00:00Z')
  assert.match(history.source.metricDefinitions[1].definition, /must not be summed/)
  assert.ok(history.source.caveats.some(caveat => /missing, never zero/.test(caveat)))
})
