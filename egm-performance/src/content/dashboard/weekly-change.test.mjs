import test from 'node:test'
import assert from 'node:assert/strict'
import {weeklyChange,starWeeklyChange,observedStarChange,weeklyChangeLabel,weeklyDelta} from './weekly-change.mjs'
const days=Array.from({length:14},(_,index)=>({date:new Date(Date.UTC(2026,9,13+index)).toISOString().slice(0,10),views:index<7?10:20,clones:5,visitors:3,mergedPRs:index<7?1:2}))
test('compares additive counts across two complete consecutive weeks',()=>{assert.equal(weeklyChange(days,'views').change,100);assert.equal(weeklyChange(days,'clones').change,0);assert.equal(weeklyChange(days,'mergedPRs').current,14)})
test('never calculates weekly unique visitors from daily uniques',()=>{assert.equal(weeklyChange(days,'visitors'),null);assert.equal(weeklyChange(days,'cloners'),null)})
test('missing days or counts do not become a growth number',()=>{assert.equal(weeklyChange(days.slice(1),'views'),null);assert.equal(weeklyChange(days.map((row,i)=>i===4?{...row,views:null}:row),'views'),null)})
test('a zero baseline keeps both counts but has no percentage',()=>{
  const surge=weeklyChange(days.map((row,i)=>({...row,views:i<7?0:30})),'views')
  assert.equal(surge.change,null)
  assert.equal(surge.previous,0)
  assert.equal(surge.current,210)
})
test('star growth compares reconstructed new stars across complete weeks, excluding partial day',()=>{
  const history=Array.from({length:16},(_,i)=>({date:new Date(Date.UTC(2026,9,12+i)).toISOString().slice(0,10),stars:i<=7?100+i*10:170+(i-7)*20}))
  const result=starWeeklyChange(history,'2026-10-28T02:00:00Z')
  assert.equal(result.previous,70)
  assert.equal(result.current,140)
  assert.equal(result.change,100)
  assert.equal(result.end,'2026-10-26')
  assert.equal(result.reconstructed,true)
  assert.equal(starWeeklyChange(history.slice(2),'2026-10-28T02:00:00Z'),null)
  assert.equal(starWeeklyChange(history.map((row,i)=>i===6?{...row,stars:0}:row),'2026-10-28T02:00:00Z'),null)
})
test('star growth from an empty baseline week still reports the new stars',()=>{
  const history=Array.from({length:16},(_,i)=>({date:new Date(Date.UTC(2026,9,12+i)).toISOString().slice(0,10),stars:i<=7?5:5+(i-7)*270}))
  const result=starWeeklyChange(history,'2026-10-28T02:00:00Z')
  assert.equal(result.previous,0)
  assert.equal(result.current,1890)
  assert.equal(result.change,null)
  assert.deepEqual(weeklyDelta(result),{direction:'up',text:'+1,890'})
})
test('label reports both weeks as counts',()=>{
  assert.equal(weeklyChangeLabel({change:100,previous:1200,current:2400},''),'2,400 last 7d · 1,200 prior 7d')
  assert.equal(weeklyChangeLabel({change:null,previous:0,current:1909},'new'),'1,909 new last 7d · 0 prior 7d')
  assert.equal(weeklyChangeLabel(null,'views'),null)
})
test('delta shows a percentage only when the baseline week can support one',()=>{
  assert.deepEqual(weeklyDelta({change:100,previous:1200,current:2400}),{direction:'up',text:'+100%'})
  assert.deepEqual(weeklyDelta({change:-25,previous:400,current:300}),{direction:'down',text:'−25%'})
  assert.deepEqual(weeklyDelta({change:51119,previous:51,current:26122}),{direction:'up',text:'+26,071'})
  assert.deepEqual(weeklyDelta({change:2400,previous:200,current:5000}),{direction:'up',text:'+4,800'})
  assert.deepEqual(weeklyDelta({change:-50,previous:4,current:2}),{direction:'down',text:'−2'})
  assert.deepEqual(weeklyDelta({change:0,previous:7,current:7}),{direction:'flat',text:'No change'})
  assert.equal(weeklyDelta(null),null)
})

const observedDays=Array.from({length:16},(_,index)=>{
  const midnight=Date.UTC(2026,9,18+index),date=new Date(midnight).toISOString().slice(0,10)
  const offset=date>='2026-11-01'?8:7
  return {date,stars:index<=7?100+index*10:170+(index-7)*20,observedAt:new Date(midnight+(23.5+offset)*3600000).toISOString()}
})
test('observed comparison uses closed daily snapshots and preserves actual DST-spanning bounds',()=>{
  const observedAt=observedDays.at(-1).observedAt
  const result=observedStarChange(observedDays,observedAt)
  assert.equal(result.previous,70)
  assert.equal(result.current,140)
  assert.equal(result.change,100)
  assert.equal(result.start,'2026-10-18')
  assert.equal(result.mid,'2026-10-25')
  assert.equal(result.end,'2026-11-01')
  assert.equal(result.startObservedAt,observedDays[0].observedAt)
  assert.equal(result.midObservedAt,observedDays[7].observedAt)
  assert.equal(result.endObservedAt,observedDays[14].observedAt)
  assert.equal(Date.parse(result.endObservedAt)-Date.parse(result.midObservedAt),169*3600000)
  assert.equal(result.observed,true)
  assert.equal(result.reconstructed,false)
  assert.deepEqual(observedStarChange([...observedDays].reverse(),observedAt),result)
  assert.deepEqual(observedStarChange(observedDays.map((row,index)=>index===15?{...row,stars:999999}:row),observedAt),result)
})

test('observed comparison allows negative net totals without a misleading percentage baseline',()=>{
  const declining=observedDays.map((row,index)=>({...row,stars:index<=7?1000-index*2:986-(index-7)}))
  const result=observedStarChange(declining,declining.at(-1).observedAt)
  assert.equal(result.previous,-14)
  assert.equal(result.current,-7)
  assert.equal(result.change,null)
})

test('observed comparison needs fifteen valid consecutive closed sampling dates',()=>{
  const observedAt=observedDays.at(-1).observedAt
  assert.equal(observedStarChange(observedDays.slice(1),observedAt),null)
  assert.equal(observedStarChange(observedDays.filter((_,index)=>index!==6),observedAt),null)
  assert.equal(observedStarChange(observedDays.map((row,index)=>index===6?{...row,observedAt:observedDays[7].observedAt}:row),observedAt),null)
  assert.equal(observedStarChange(observedDays,null),null)
  assert.equal(observedStarChange([],observedAt),null)
})
