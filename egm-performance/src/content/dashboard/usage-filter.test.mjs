import test from 'node:test'
import assert from 'node:assert/strict'
import { filterUsageEvent } from './usage-filter.mjs'

test('only section events are sent and private properties are removed', () => {
  assert.equal(filterUsageEvent({ event: '$autocapture', properties: {} }), null)
  const event = filterUsageEvent({ event: 'dashboard_section_viewed', properties: { distinct_id: 'id', section: 'reach', $current_url: 'https://example.com/?secret=1', $referrer: 'private', text: 'private' } })
  assert.equal(event.properties.section, 'reach')
  assert.equal(event.properties.distinct_id, 'id')
  assert.equal(event.properties.$current_url, 'https://example.com/')
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
  assert.equal(event.properties.$current_url, 'https://example.com/')
})
test('page views keep the path and drop query strings', () => {
  const event = filterUsageEvent({ event: '$pageview', properties: { distinct_id: 'user_1', $pathname: '/overview', $current_url: 'https://egm.n3wth.com/auth/callback?code=secret&state=secret', token: 'phc' } })
  assert.equal(event.properties.$pathname, '/overview')
  assert.equal(event.properties.$current_url, 'https://egm.n3wth.com/auth/callback')
  assert.equal(JSON.stringify(event).includes('secret'), false)
  const identify = filterUsageEvent({ event: '$identify', properties: { distinct_id: 'user_1', $set: { email: 'a@example.com', name: 'A', plan: 'hidden' }, $current_url: 'https://egm.n3wth.com/overview?token=secret' } })
  assert.deepEqual(identify.properties.$set, { email: 'a@example.com', name: 'A' })
  assert.equal(identify.properties.$current_url, 'https://egm.n3wth.com/overview')
  assert.equal(filterUsageEvent({ event: '$autocapture', properties: { $pathname: '/overview' } }), null)
})
