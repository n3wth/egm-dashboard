import test from 'node:test'
import assert from 'node:assert/strict'
import {overviewSummary,reportingRangeLabel,pacificReportingRangeLabel,trafficCoverageNote} from './overview-summary.mjs'

test('uses exact recorded traffic and distinct referral denominators',()=>{
  const summary=overviewSummary({reach:{rows:[{stars:3624,views:29252}]},traffic:{rows:[{date:'2026-10-23',views:3406},{date:'2026-10-24',views:6000},{date:'2026-10-25',views:8000},{date:'2026-10-26',views:11846}]},referrers:{rows:[{referrer:'Google',count:5481},{referrer:'youtube.com',count:3313},{referrer:'other',count:4970}]}})
  assert.match(summary.sentences[1],/88% of 29,252 repo views arrived in the last 3 reported UTC days/)
  assert.match(summary.sentences[2],/64% of the views GitHub attributes to its top ten referrers \(30% of all repo views\)/)
  assert.equal(summary.sentences.length,3)
  assert.deepEqual(new Set(summary.queryIds),new Set(['reach','traffic','referrers']))
  assert.equal(summary.headline,'EGM has about 3.6k recorded stars.')
  assert.deepEqual(summary.facts,['About 196k stars to the 200k team target'])
  assert.ok(summary.notes.includes('29.3k repo views · 88% in the last three reported UTC days'))
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

const history=Array.from({length:16},(_,index)=>({date:new Date(Date.UTC(2026,9,12+index)).toISOString().slice(0,10),stars:index<=7?100+index*10:170+(index-7)*20}))
const starQuery={rows:history,source:{executedAt:'2026-10-28T02:00:00Z',caveats:[]}}

test('traffic coverage distinguishes reported UTC days from the actual Pacific collection time',()=>{
  const queries={traffic:{rows:[{date:'2026-10-30'},{date:'2026-10-31'}],source:{executedAt:'2026-11-02T08:49:00Z'}}}
  assert.equal(trafficCoverageNote(queries),'Traffic available through Oct 31 (UTC source day). Collected Nov 2, 2026, 12:49 AM PST; newer days were not included in GitHub’s response.')
  assert.equal(trafficCoverageNote({...queries,traffic:{...queries.traffic,source:{executedAt:'2026-10-31T12:00:00Z'}}}),null)
  for(const executedAt of [null,undefined,'invalid'])assert.equal(trafficCoverageNote({traffic:{...queries.traffic,source:{executedAt}}}),null)
  assert.equal(trafficCoverageNote({traffic:{rows:[{date:'2026-02-30'}],source:queries.traffic.source}}),null)
})

test('leads with comparable complete Pacific weeks and arithmetic distance to the team target',()=>{
  const summary=overviewSummary({reach:{rows:[{stars:330}]},star_history:starQuery})
  assert.equal(summary.headline,'Star growth accelerated in the latest complete week.')
  assert.match(summary.sentences[0],/complete Pacific-date weeks reconstructed from current stargazers/)
  assert.deepEqual(summary.facts,['140 new stars vs 70 the prior week · Oct 20–Oct 26 Pacific'])
  assert.ok(summary.notes.includes('About 200k stars to the 200k team target'))
  assert.deepEqual(summary.queryIds,['reach','star_history'])
  assert.doesNotMatch(JSON.stringify(summary),/forecast|will reach|on track/i)
})

test('stale star history cannot produce a current momentum claim',()=>{
  const summary=overviewSummary({reach:{rows:[{stars:10010}]},star_history:{...starQuery,source:{...starQuery.source,caveats:['Star history is stale: collection was incomplete.']}}})
  assert.equal(summary.headline,'Weekly star momentum is not available yet.')
  assert.deepEqual(summary.facts,['10k recorded stars'])
  assert.ok(summary.notes.includes('About 190k stars to the 200k team target'))
  assert.doesNotMatch(JSON.stringify(summary),/140 new stars|70 the prior/)
  assert.deepEqual(summary.queryIds,['reach','star_history'])
})

test('missing or duplicate traffic dates do not become a last-three-days claim',()=>{
  for(const dates of [['2026-10-23','2026-10-25','2026-10-26'],['2026-10-24','2026-10-25','2026-10-25'],['invalid','2026-10-25','2026-10-26']]) {
    const summary=overviewSummary({reach:{rows:[{stars:10,views:20}]},traffic:{rows:dates.map(date=>({date,views:5}))}})
    assert.doesNotMatch(JSON.stringify(summary),/last 3|last three/)
    assert.match(summary.sentences[1],/20 repo views in its two-week traffic window/)
    assert.deepEqual(summary.queryIds,['reach'])
  }
})

test('target distance never turns negative after either target is reached',()=>{
  assert.deepEqual(overviewSummary({reach:{rows:[{stars:250000}]}}).facts,['200k target reached · about 50k stars to 300k'])
  assert.deepEqual(overviewSummary({reach:{rows:[{stars:300001}]}}).facts,['Team target of 200k–300k stars reached.'])
})
