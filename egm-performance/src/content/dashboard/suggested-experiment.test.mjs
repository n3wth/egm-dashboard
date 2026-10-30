import test from 'node:test'
import assert from 'node:assert/strict'
import { experimentRule, suggestExperiment } from './suggested-experiment.mjs'

test('the highest discussed problem wins and ties break in a fixed order', () => {
  const result = suggestExperiment({
    issue_queue: { rows: [
      { title: 'Quiet bug', comments: 1, url: 'https://github.com/google/elephant-goldfish-model/issues/1' },
      { title: 'Loud bug', comments: 4, url: 'https://github.com/google/elephant-goldfish-model/issues/9' }
    ] },
    research_evidence: { rows: [
      { status: 'verified', title: 'A quote', url: 'https://example.com/quote', contentExcerpt: 'Install failed' },
      { status: 'unverified', title: 'Skip', url: 'https://example.com/skip', contentExcerpt: 'no' }
    ] },
    mentions: { rows: [
      { title: 'A mention', url: 'https://example.com/mention' },
      { title: 'Same score later url', url: 'https://example.com/zzz' }
    ] }
  })
  assert.equal(result.winner.title, 'Loud bug')
  assert.equal(result.winner.score, 4)
  assert.equal(result.evidence[0].url, result.winner.url)
  assert.equal(result.rule, experimentRule)
  assert.match(result.success, /Two of three/)
  const tied = suggestExperiment({
    research_evidence: { rows: [{ status: 'verified', title: 'Quote', url: 'https://example.com/b', contentExcerpt: 'stuck' }] },
    mentions: { rows: [{ title: 'Mention', url: 'https://example.com/a' }] }
  })
  assert.equal(tied.winner.kind, 'quote')
})
