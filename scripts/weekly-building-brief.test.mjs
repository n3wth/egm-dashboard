import test from 'node:test'
import assert from 'node:assert/strict'
import {
  reportingWindow,
  isoWeekKey,
  classifyMergedPulls,
  summarizeAuthorConcentration,
  searchAll,
  renderEvidence,
  replaceEvidence
} from './weekly-building-brief.mjs'

test('uses the previous complete UTC week across year boundaries and Sunday', () => {
  assert.deepEqual(reportingWindow(new Date('2026-11-02T17:00:00Z')), {
    since: '2026-10-26T00:00:00.000Z',
    until: '2026-11-02T00:00:00.000Z',
    key: '2026-11-02',
    isoWeek: '2026-W44'
  })
  assert.equal(reportingWindow(new Date('2027-01-03T23:59:59Z')).since, '2026-12-21T00:00:00.000Z')
  assert.equal(reportingWindow(new Date('2027-01-03T23:59:59Z')).isoWeek, '2026-W52')
})

test('computes ISO week key across year boundaries', () => {
  assert.equal(isoWeekKey('2026-10-26T00:00:00.000Z'), '2026-W44')
  assert.equal(isoWeekKey('2026-12-21T00:00:00.000Z'), '2026-W52')
  assert.equal(isoWeekKey('2027-01-01T00:00:00.000Z'), '2026-W53')
  assert.equal(isoWeekKey('2026-01-01T00:00:00.000Z'), '2026-W01')
  assert.equal(isoWeekKey(new Date('2026-11-02T00:00:00.000Z')), '2026-W45')
  assert.throws(() => isoWeekKey('invalid-date'), /Invalid date for ISO week key/)
})

test('classifies merged pull requests against published releases', () => {
  const releases = [
    { tag_name: 'v0.1.0', published_at: '2026-10-27T07:46:34Z', draft: false },
    { tag_name: 'v0.2.0-draft', published_at: '2026-10-30T00:00:00Z', draft: true }
  ]
  const items = [
    { number: 127, title: 'docs: claude agents', merged_at: '2026-10-27T03:35:10Z' },
    { number: 194, title: 'fix: table markdown', merged_at: '2026-10-28T08:35:29Z' },
    { number: 200, title: 'unmerged PR', merged_at: null }
  ]
  const classified = classifyMergedPulls(items, releases)
  assert.equal(classified[0].releaseStatus, 'released in v0.1.0; user outcome unverified')
  assert.equal(classified[1].releaseStatus, 'merged to main, unreleased; user outcome unverified')
  assert.equal(classified[2].releaseStatus, 'merged to main, unreleased; user outcome unverified')
})

test('summarizes author concentration and flags single-account bursts', () => {
  const balanced = [
    { user: { login: 'alice' } },
    { user: { login: 'bob' } },
    { user: { login: 'carol' } }
  ]
  assert.equal(
    summarizeAuthorConcentration(balanced),
    'Independent reporters: 3 across 3 issues.'
  )

  const burstItems = [
    ...Array.from({ length: 10 }, () => ({ user: { login: 'neilgreyjoy-commits' } })),
    { user: { login: 'alice' } },
    { user: { login: 'bob' } }
  ]
  assert.equal(
    summarizeAuthorConcentration(burstItems),
    'Independent reporters: 3 across 12 issues (single-account bursts: @neilgreyjoy-commits filed 10).'
  )
  assert.equal(summarizeAuthorConcentration([]), null)
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

test('escapes source titles, shows isoWeek, releaseCutline, authorNote, and explicitly labels missing outcomes', () => {
  const packet = {
    since: '2026-10-26T00:00:00.000Z',
    until: '2026-11-02T00:00:00.000Z',
    isoWeek: '2026-W44',
    collectedAt: '2026-11-03T00:00:00.000Z',
    latestRelease: {
      tag_name: 'v0.1.0',
      published_at: '2026-10-27T07:46:34Z',
      html_url: 'https://github.com/google/elephant-goldfish-model/releases/tag/v0.1.0'
    },
    groups: [
      {
        name: 'New issues',
        url: 'https://github.com',
        authorNote: 'Independent reporters: 1 across 1 issues.',
        items: [
          {
            number: 1,
            title: '[do this](evil)\n# heading',
            html_url: 'https://github.com/google/elephant-goldfish-model/issues/1'
          }
        ]
      },
      {
        name: 'Merged PRs (user outcome unverified)',
        url: 'https://github.com/pulls',
        items: [
          {
            number: 10,
            title: 'feature: pr',
            html_url: 'https://github.com/google/elephant-goldfish-model/pull/10',
            releaseStatus: 'released in v0.1.0; user outcome unverified'
          }
        ]
      }
    ]
  }
  const text = renderEvidence(packet)
  assert.ok(text.includes('\\[do this\\]\\(evil\\) \\# heading'))
  assert.ok(text.includes('ISO week: 2026-W44.'))
  assert.ok(text.includes('Latest release: [v0.1.0]'))
  assert.ok(text.includes('Independent reporters: 1 across 1 issues.'))
  assert.ok(text.includes('— _released in v0.1.0; user outcome unverified_'))
  assert.match(text, /Missing evidence is unknown/)
  assert.match(text, /Merged does not mean released/)
})
