import test from 'node:test'
import assert from 'node:assert/strict'
import {dashboardTab} from './ask-tabs.mjs'

test('snapshot queries point at the dashboard tab that shows them', () => {
  assert.deepEqual(dashboardTab('youtube_videos'), {tab: '/mentions', tabLabel: 'Mentions'})
  assert.deepEqual(dashboardTab('referrers'), {tab: '/acquisition', tabLabel: 'Acquisition'})
  assert.deepEqual(dashboardTab('issue_queue'), {tab: '/development', tabLabel: 'Development'})
  assert.deepEqual(dashboardTab('not_a_query'), {})
})
