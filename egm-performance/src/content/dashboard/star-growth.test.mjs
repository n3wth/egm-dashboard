import test from 'node:test'
import assert from 'node:assert/strict'
import {starGrowth,observedStarGrowth,hasObservedDailyChange} from './star-growth.mjs'

test('excludes the partial day from complete growth',()=>{
  const rows=[0,0,0,3,8,12].map((stars,index)=>({date:`2026-10-${20+index}`,stars}))
  const result=starGrowth(rows,'2026-10-25T18:00:00Z')
  assert.equal(result.hiddenDays,0)
  assert.equal(result.recent[0].date,'2026-10-20')
  assert.deepEqual(result.daily.map(row=>row.newStars),[null,0,0,3,5,null])
  assert.equal(result.daily.at(-1).partialStars,4)
  assert.equal(rows.length,6)
})

test('missing dates, invalid totals and decreases do not become daily gains',()=>{
  const rows=[{date:'2026-10-20',stars:2},{date:'2026-10-22',stars:8},{date:'2026-10-23',stars:7},{date:'2026-10-24',stars:null}]
  assert.deepEqual(starGrowth(rows,'2026-10-25T18:00:00Z').daily.map(row=>row.newStars),[null,null,null,null])
  assert.ok(starGrowth(rows,null).daily.every(row=>row.newStars===null))
  assert.deepEqual(starGrowth([],null).recent,[])
})

test('recent view retains exactly the latest fourteen observed dates',()=>{
  const rows=Array.from({length:25},(_,index)=>({date:`2026-10-${String(index+1).padStart(2,'0')}`,stars:index}))
  const result=starGrowth(rows,'2026-10-26T18:00:00Z')
  assert.equal(result.recent.length,14)
  assert.equal(result.recent[0].date,'2026-10-12')
  assert.equal(result.hiddenDays,11)
})

test('observed net changes keep decreases, exact sample bounds and the partial sampling day separate',()=>{
  const rows=[
    {date:'2026-11-02',stars:118,observedAt:'2026-11-02T08:15:00Z'},
    {date:'2026-11-01',stars:120,observedAt:'2026-11-01T08:30:00Z'},
    {date:'2026-10-31',stars:122,observedAt:'2026-11-01T06:30:00Z'},
    {date:'2026-11-01',stars:119,observedAt:'2026-11-01T09:30:00Z'}
  ]
  const result=observedStarGrowth(rows,'2026-11-02T08:15:00Z')
  assert.deepEqual(result.daily.map(row=>row.stars),[122,119,118])
  assert.deepEqual(result.daily.map(row=>row.netStars),[null,-3,null])
  assert.deepEqual(result.daily.map(row=>row.partialNetStars),[null,null,-1])
  assert.equal(result.daily[1].fromObservedAt,'2026-11-01T06:30:00Z')
  assert.equal(result.daily[2].observedAt,rows[0].observedAt)
  assert.equal(result.daily[2].coverage,'Partial sampling day')
  assert.equal(rows.length,4)
})

test('observed gaps and invalid samples stay unknown instead of becoming daily gains',()=>{
  const rows=[
    {date:'2026-10-31',stars:100,observedAt:'2026-11-01T06:30:00Z'},
    {date:'2026-11-01',stars:'110',observedAt:'2026-11-01T09:30:00Z'},
    {date:'2026-11-01',stars:110,observedAt:'2026-11-01'},
    {date:'2026-11-01',stars:110,observedAt:'2026-11-02T09:30:00Z'},
    {date:'2026-11-02',stars:120,observedAt:'2026-11-02T08:15:00Z'},
    {date:'2026-11-03',stars:130,observedAt:'2026-11-03T09:30:00Z'}
  ]
  const result=observedStarGrowth(rows,'2026-11-02T08:15:00Z')
  assert.deepEqual(result.daily.map(row=>row.date),['2026-10-31','2026-11-01','2026-11-02'])
  assert.deepEqual(result.daily.map(row=>row.stars),[100,null,120])
  assert.deepEqual(result.daily.map(row=>row.netStars),[null,null,null])
  assert.deepEqual(result.daily.map(row=>row.partialNetStars),[null,null,null])
  assert.equal(result.daily[1].coverage,'Not sampled')
  assert.ok(observedStarGrowth(rows,null).daily.every(row=>row.netStars===null&&row.partialNetStars===null&&['Coverage unknown','Not sampled'].includes(row.coverage)))
  assert.deepEqual(observedStarGrowth([],null).recent,[])
})

test('observed recent view uses calendar bounds and keeps a measured zero distinct from unknown',()=>{
  const rows=Array.from({length:20},(_,index)=>({date:`2026-10-${String(index+1).padStart(2,'0')}`,stars:10,observedAt:`2026-10-${String(index+1).padStart(2,'0')}T20:00:00Z`}))
  const result=observedStarGrowth(rows,'2026-10-20T20:00:00Z')
  assert.equal(result.recent.length,14)
  assert.equal(result.hiddenDays,6)
  assert.equal(result.recent[0].date,'2026-10-07')
  assert.equal(result.recent[0].netStars,0)
  assert.equal(result.daily[0].netStars,null)
  assert.equal(result.daily.at(-1).partialNetStars,0)
})

test('daily observations become usable before a full weekly comparison exists',()=>{
  const rows=[{date:'2026-11-01',stars:100,observedAt:'2026-11-02T07:30:00Z'},{date:'2026-11-02',stars:100,observedAt:'2026-11-02T19:00:00Z'}]
  assert.equal(hasObservedDailyChange(rows,rows[1].observedAt),true)
  assert.equal(hasObservedDailyChange(rows.slice(1),rows[1].observedAt),false)
  assert.equal(hasObservedDailyChange([{...rows[0],date:'2026-10-31',observedAt:'2026-11-01T06:30:00Z'},rows[1]],rows[1].observedAt),false)
  assert.equal(hasObservedDailyChange([...rows,{date:'2026-11-04',stars:120,observedAt:'2026-11-04T19:00:00Z'}],'2026-11-04T19:00:00Z'),false)
})
