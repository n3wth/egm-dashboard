import test from 'node:test'
import assert from 'node:assert/strict'
import {growthStarters, starterIds, startersFor, tabIdFromLocation} from './ask-starters.mjs'

const tabs = ['reach', 'acquisition', 'adoption', 'website', 'development', 'research', 'mentions']

test('every starter fits the Ask question limit and has a unique id', () => {
  assert.equal(new Set(starterIds).size, growthStarters.length)
  for (const starter of growthStarters) assert.ok(starter.question.length > 0 && starter.question.length <= 1200, starter.id)
  for (const tab of tabs) for (const question of startersFor(tab).questions) assert.ok(question.length <= 1200 && question.endsWith('?'), question)
})

test('each tab has its own short questions', () => {
  for (const tab of tabs) assert.equal(startersFor(tab).questions.length, 2, tab)
  assert.notDeepEqual(startersFor('website').questions, startersFor('research').questions)
})

test('the tab comes from the path, the tab query, or defaults to Overview', () => {
  assert.equal(tabIdFromLocation('/overview'), 'reach')
  assert.equal(tabIdFromLocation('/website'), 'website')
  assert.equal(tabIdFromLocation('/research/'), 'research')
  assert.equal(tabIdFromLocation('/', '?tab=mentions'), 'mentions')
  assert.equal(tabIdFromLocation('/'), 'reach')
  assert.equal(tabIdFromLocation('/growth'), 'reach')
  assert.equal(tabIdFromLocation('/__proto__'), 'reach')
  assert.equal(startersFor('nonsense').questions.length, 2)
})
