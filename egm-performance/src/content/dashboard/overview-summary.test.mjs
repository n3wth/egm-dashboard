import test from 'node:test'
import assert from 'node:assert/strict'
import {overviewSummary,reportingRangeLabel,pacificReportingRangeLabel} from './overview-summary.mjs'

test('uses exact recorded traffic and distinct referral denominators',()=>{
  const summary=overviewSummary({reach:{rows:[{stars:3624,views:29252}]},traffic:{rows:[{date:'2026-10-23',views:3406},{date:'2026-10-24',views:6000},{date:'2026-10-25',views:8000},{date:'2026-10-26',views:11846}]},referrers:{rows:[{referrer:'Google',count:5481},{referrer:'youtube.com',count:3313},{referrer:'other',count:4970}]}})
  assert.match(summary.sentences[0],/3,624 recorded stars; 88% of the 29,252 repo views between Oct 23 and Oct 26 \(UTC\) arrived in the last three days, Oct 24–Oct 26; an even spread would be 75%\./)
  assert.match(summary.sentences[1],/64% of the views GitHub attributes to its top ten referrers \(30% of all repo views\)/)
  assert.equal(summary.sentences.length,2)
  assert.deepEqual(new Set(summary.queryIds),new Set(['reach','traffic','referrers']))
  assert.equal(summary.headline,'88% of 29,252 repo views arrived in the last 3 days.')
  assert.deepEqual(summary.facts,['vs 75% if evenly spread','3,624 recorded stars','Google + YouTube = 64% of attributed views'])
  assert.deepEqual(summary.range,{label:'Oct 22, 5 PM PDT – Oct 26, 5 PM PDT',note:'Pacific Time'})
})
test('one compact label for the traffic dates',()=>{
  assert.equal(reportingRangeLabel(['2026-10-29','2026-10-16']),'Oct 16 – 29')
  assert.equal(reportingRangeLabel(['2026-10-30','2026-11-02']),'Oct 30 – Nov 2')
  assert.equal(reportingRangeLabel(['2026-10-16']),null)
})
test('Pacific reporting bounds preserve UTC bucket instants across daylight saving',()=>{
  assert.equal(pacificReportingRangeLabel(['2026-10-30','2026-11-02']),'Oct 29, 5 PM PDT – Nov 2, 4 PM PST')
  assert.equal(pacificReportingRangeLabel(['2026-10-16']),null)
})
test('no canned recommendation is appended to the summary',()=>{
  const summary=overviewSummary({reach:{rows:[{stars:5,views:10}]}})
  assert.ok(summary.sentences.every(sentence=>!/first-run/.test(sentence)))
})
test('missing data does not become zero or fabricated insight',()=>{
  assert.equal(overviewSummary({}),null)
  const summary=overviewSummary({youtube_videos:{rows:[{views:null},{views:150399}]}})
  assert.match(summary.sentences[0],/150,399 views/)
  assert.deepEqual(summary.queryIds,['youtube_videos'])
})
test('incomplete traffic omits the burst percentage',()=>{
  const summary=overviewSummary({reach:{rows:[{stars:10}]},traffic:{rows:[{date:'2026-10-24',views:5},{date:'2026-10-25',views:null},{date:'2026-10-26',views:8}]}})
  assert.equal(summary.sentences[0],'EGM has 10 recorded stars.')
  assert.deepEqual(summary.queryIds,['reach'])
})
