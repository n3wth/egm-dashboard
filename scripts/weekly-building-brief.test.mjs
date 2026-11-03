import test from 'node:test'
import assert from 'node:assert/strict'
import { reportingWindow, searchAll, renderEvidence, replaceEvidence } from './weekly-building-brief.mjs'

test('uses the previous complete UTC week across year boundaries and Sunday', () => {
  assert.deepEqual(reportingWindow(new Date('2026-11-02T17:00:00Z')), { since: '2026-10-26T00:00:00.000Z', until: '2026-11-02T00:00:00.000Z', key: '2026-11-02' })
  assert.equal(reportingWindow(new Date('2027-01-03T23:59:59Z')).since, '2026-12-21T00:00:00.000Z')
})

test('paginates, rejects partial results, changing totals, duplicates and search cap', () => {
  let page = 0
  const result = searchAll('query', () => ({ incomplete_results: false, total_count: 2, items: [{ id: ++page }] }))
  assert.equal(result.length, 2)
  for (const response of [
    { incomplete_results: true, total_count: 1, items: [] },
    { incomplete_results: false, total_count: 1001, items: [] },
    { incomplete_results: false, total_count: 2, items: [] },
    { incomplete_results: false, total_count: 2, items: [{ id: 1 }, { id: 1 }] }
  ]) assert.throws(() => searchAll('query', () => response))
  let calls = 0
  assert.throws(() => searchAll('query', () => ({ incomplete_results: false, total_count: ++calls === 1 ? 2 : 3, items: [{ id: calls }] })), /changed/)
  assert.deepEqual(searchAll('query', () => ({ incomplete_results: false, total_count: 0, items: [] })), [])
})

test('reruns preserve human decisions and fail safely if markers were edited', () => {
  const packet = { since: 'start', until: 'end', collectedAt: 'now', groups: [] }
  const evidence = renderEvidence(packet)
  const body = `Human commitments\n${evidence}\nHuman results`
  const updated = replaceEvidence(body, renderEvidence({ ...packet, collectedAt: 'later' }))
  assert.ok(updated.startsWith('Human commitments\n'))
  assert.ok(updated.endsWith('\nHuman results'))
  assert.match(updated, /Collected: later/)
  assert.throws(() => replaceEvidence('human-only document', evidence))
  assert.throws(() => replaceEvidence(body + evidence, evidence))
})

test('escapes source titles and explicitly labels missing outcomes', () => {
  const text = renderEvidence({ groups: [{ name: 'New issues', url: 'https://github.com', items: [{ number: 1, title: '[do this](evil)\n# heading', html_url: 'https://github.com/google/elephant-goldfish-model/issues/1' }] }] })
  assert.ok(text.includes('\\[do this\\]\\(evil\\) \\# heading'))
  assert.match(text, /Missing evidence is unknown/)
  assert.match(text, /Merged does not mean released/)
})
