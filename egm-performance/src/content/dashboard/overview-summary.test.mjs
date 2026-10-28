import test from 'node:test'
import assert from 'node:assert/strict'
import {overviewSummary} from './overview-summary.mjs'

test('uses exact recorded traffic and distinct referral denominators',()=>{
  const summary=overviewSummary({reach:{rows:[{stars:3624,views:29252}]},traffic:{rows:[{date:'2026-10-23',views:3406},{date:'2026-10-24',views:6000},{date:'2026-10-25',views:8000},{date:'2026-10-26',views:11846}]},referrers:{rows:[{referrer:'Google',count:5481},{referrer:'youtube.com',count:3313},{referrer:'other',count:4970}]}})
  assert.match(summary.sentences[0],/3,624 recorded stars; 88.4%/)
  assert.match(summary.sentences[1],/63.9% of top reported referral views \(30.1% of all repo views\)/)
  assert.equal(summary.sentences.length,3)
  assert.deepEqual(new Set(summary.queryIds),new Set(['reach','traffic','referrers']))
})
test('missing data does not become zero or fabricated insight',()=>{
  assert.equal(overviewSummary({}),null)
  const summary=overviewSummary({youtube_videos:{rows:[{views:null},{views:150399}]}})
  assert.match(summary.sentences[0],/150,399 observed views/)
  assert.deepEqual(summary.queryIds,['youtube_videos'])
})
test('incomplete traffic omits the burst percentage',()=>{
  const summary=overviewSummary({reach:{rows:[{stars:10}]},traffic:{rows:[{date:'2026-10-24',views:5},{date:'2026-10-25',views:null},{date:'2026-10-26',views:8}]}})
  assert.equal(summary.sentences[0],'EGM has 10 recorded stars.')
  assert.deepEqual(summary.queryIds,['reach'])
})
