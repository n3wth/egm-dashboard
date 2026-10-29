import test from 'node:test'
import assert from 'node:assert/strict'
import { filterUsageEvent } from './usage-filter.mjs'

test('only section events are sent and private properties are removed', () => {
  assert.equal(filterUsageEvent({ event: '$autocapture', properties: {} }), null)
  const event = filterUsageEvent({ event: 'dashboard_section_viewed', properties: { distinct_id: 'id', section: 'reach', $current_url: 'https://example.com/?secret=1', $referrer: 'private', text: 'private' } })
  assert.equal(event.properties.section, 'reach')
  assert.equal(event.properties.distinct_id, 'id')
  assert.equal(event.properties.$current_url, undefined)
  assert.equal(event.properties.$referrer, undefined)
  assert.equal(event.properties.text, undefined)
  const ask = filterUsageEvent({ event: 'dashboard_ask', properties: { distinct_id: 'id', outcome: 'completed', question: 'private', answer: 'private' } })
  assert.equal(ask.properties.outcome, 'completed')
  assert.equal(ask.properties.question, undefined)
  assert.equal(ask.properties.answer, undefined)
})
test('the starter event keeps only the starter id', () => {
  const event = filterUsageEvent({ event: 'dashboard_ask_starter', properties: { distinct_id: 'id', starter: 'distribution', question: 'private', $current_url: 'https://example.com/?secret=1' } })
  assert.equal(event.properties.starter, 'distribution')
  assert.equal(event.properties.question, undefined)
  assert.equal(event.properties.$current_url, undefined)
})
