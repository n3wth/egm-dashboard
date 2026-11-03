import test from 'node:test'
import assert from 'node:assert/strict'
import {alignedTrendValues,sampledTrendValues,dailySnapshotValues,chartDates} from './metric-trend.mjs'
import {sparklineSegments} from './sparkline-path.mjs'
test('chart dates extend through the current Pacific day without inventing values',()=>{
  const dates=chartDates([{date:'2026-10-30'},{date:'2026-10-31'}],Date.parse('2026-11-02T18:00:00Z'))
  assert.deepEqual(dates,['2026-10-30','2026-10-31','2026-11-01','2026-11-02'])
  assert.deepEqual(alignedTrendValues([{date:'2026-10-31',views:7}],'views',dates),[null,7,null,null])
  assert.deepEqual(chartDates([],Date.now()),[])
})

test('metric trends use the requested calendar interval instead of the full source history',()=>{
  const history=[
    {date:'2026-10-17',stars:100},
    {date:'2026-10-18',stars:110},
    {date:'2026-10-19',stars:120},
    {date:'2026-10-20',stars:130},
    {date:'2026-10-21',stars:140}
  ]
  const before=structuredClone(history)
  assert.deepEqual(alignedTrendValues(history,'stars',['2026-10-18','2026-10-19','2026-10-20']),[110,120,130])
  assert.deepEqual(history,before)
})

test('missing sampling dates split the sparkline rather than connecting distant observations',()=>{
  const history=[{date:'2026-10-27',stars:5000},{date:'2026-11-02',stars:10000}]
  const dates=['2026-10-27','2026-10-28','2026-10-29','2026-10-30','2026-10-31','2026-11-01','2026-11-02']
  const values=alignedTrendValues(history,'stars',dates)
  assert.deepEqual(values,[5000,null,null,null,null,null,10000])
  assert.deepEqual(sparklineSegments(values).map(segment=>segment.length),[1,1])
})

test('zero remains measured while invalid or absent values stay unknown',()=>{
  const history=[{date:'2026-10-18',views:0},{date:'2026-10-19',views:'12'},{date:'2026-10-20',views:Infinity}]
  assert.deepEqual(alignedTrendValues(history,'views',['2026-10-18','2026-10-19','2026-10-20','2026-10-21']),[0,null,null,null])
})

test('sampled trends anchor fourteen calendar slots at the last real observation',()=>{
  const single=sampledTrendValues([{date:'2026-11-02',openIssues:0}],'openIssues')
  assert.deepEqual(single,[...Array(13).fill(null),0])
  assert.deepEqual(sampledTrendValues([],'openIssues'),[])
  assert.deepEqual(sampledTrendValues([{date:'2026-02-30',openIssues:1}],'openIssues'),[])
})

test('long sampling gaps stay bounded and do not compress calendar spacing',()=>{
  const values=sampledTrendValues([
    {date:'2026-11-02',openIssues:8},
    {date:'2025-01-01',openIssues:9},
    {date:'2026-10-31',openIssues:0}
  ],'openIssues')
  assert.equal(values.length,14)
  assert.deepEqual(values.slice(-3),[0,null,8])
  assert.ok(values.slice(0,-3).every(value=>value===null))
})

test('rolling referral trends use the latest real observation each Pacific day and keep missing days blank',()=>{
  const rows=[{observedAt:'2026-11-01T20:00:00Z',views:10},{observedAt:'2026-11-01T21:00:00Z',views:12},{observedAt:'2026-11-03T20:00:00Z',views:16}]
  assert.deepEqual(dailySnapshotValues(rows,'views').slice(-3),[12,null,16])
  assert.deepEqual(dailySnapshotValues([...rows].reverse(),'views'),dailySnapshotValues(rows,'views'))
})
