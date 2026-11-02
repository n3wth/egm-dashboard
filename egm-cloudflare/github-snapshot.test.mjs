import test from 'node:test'
import assert from 'node:assert/strict'
import { stampCollectedQueries } from './github-snapshot.mjs'

test('GitHub provenance distinguishes lifetime, point-in-time, mixed and daily ranges', () => {
  const ids = ['downloads', 'maintenance', 'issue_queue', 'reach', 'star_history', 'traffic', 'activity', 'referrers', 'paths', 'website']
  const source = { executedAt: 'old', coverage: { startDate: 'old' }, filters: ['Repository: google/elephant-goldfish-model', 'Daily traffic buckets use UTC'], metricDefinitions: [{ label: 'Original', definition: 'Preserved' }], links: [{ label: 'GitHub traffic', url: 'https://github.com/google/elephant-goldfish-model/graphs/traffic' }], caveats: ['Existing limitation'] }
  const independent = { rows: [{ value: 1 }], source: structuredClone(source) }
  const data = { queries: Object.fromEntries(ids.map(id => [id, { rows: [], source: structuredClone(source) }])) }
  data.queries.independent = structuredClone(independent)
  const started = '2026-11-02T08:00:00Z'
  const requests = ['https://api.github.com/repos/google/elephant-goldfish-model']
  const window = { startDate: '2026-10-18', endDate: '2026-10-31' }
  stampCollectedQueries(data, new Set(ids), started, requests, [{ date: window.startDate }, { date: window.endDate }], { start: '2026-09-13', today: '2026-11-02' })
  assert.deepEqual(data.queries.downloads.source.coverage, { type: 'lifetime', asOf: started })
  for (const id of ['maintenance', 'issue_queue']) assert.deepEqual(data.queries[id].source.coverage, { type: 'point-in-time', asOf: started })
  assert.deepEqual(data.queries.reach.source.coverage, { ...window, type: 'mixed', asOf: started })
  assert.match(data.queries.reach.source.caveats.join(' '), /not gains during that window/)
  assert.deepEqual(data.queries.star_history.source.coverage, { startDate: '2026-09-13', endDate: '2026-11-02' })
  const suffixes = id => data.queries[id].source.links.map(link => new URL(link.url).pathname.replace('/google/elephant-goldfish-model', ''))
  assert.deepEqual(suffixes('downloads'), ['/releases'])
  assert.deepEqual(suffixes('maintenance'), ['/issues', '/pulls'])
  assert.deepEqual(suffixes('issue_queue'), ['/issues'])
  assert.deepEqual(suffixes('star_history'), ['/stargazers'])
  assert.deepEqual(suffixes('reach'), ['', '/graphs/traffic'])
  for (const id of ids) {
    assert.equal(data.queries[id].source.executedAt, started)
    assert.deepEqual(data.queries[id].source.metricDefinitions, source.metricDefinitions)
    assert.equal(data.queries[id].source.evidenceFlow[0].detail, requests[0])
    assert.ok(data.queries[id].source.caveats.includes('Existing limitation'))
  }
  for (const id of ['downloads', 'maintenance', 'issue_queue', 'star_history']) assert.deepEqual(data.queries[id].source.filters, [source.filters[0]])
  for (const id of ['traffic', 'activity', 'referrers', 'paths', 'website']) {
    assert.deepEqual(data.queries[id].source.coverage, window)
    assert.deepEqual(data.queries[id].source.filters, source.filters)
  }
  assert.deepEqual(data.queries.independent, independent)
})
