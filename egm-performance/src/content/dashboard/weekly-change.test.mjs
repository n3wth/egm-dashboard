import test from 'node:test'
import assert from 'node:assert/strict'
import {weeklyChange,starWeeklyChange,weeklyChangeLabel} from './weekly-change.mjs'
const days=Array.from({length:14},(_,index)=>({date:new Date(Date.UTC(2026,9,13+index)).toISOString().slice(0,10),views:index<7?10:20,clones:5,visitors:3}))
test('compares additive counts across two complete consecutive weeks',()=>{assert.equal(weeklyChange(days,'views').change,100);assert.equal(weeklyChange(days,'clones').change,0)})
test('never calculates weekly unique visitors from daily uniques',()=>{assert.equal(weeklyChange(days,'visitors'),null);assert.equal(weeklyChange(days,'cloners'),null)})
test('missing days, counts and zero baseline do not become a growth number',()=>{assert.equal(weeklyChange(days.slice(1),'views'),null);assert.equal(weeklyChange(days.map((row,i)=>i===4?{...row,views:null}:row),'views'),null);assert.equal(weeklyChange(days.map(row=>({...row,views:0})),'views'),null)})
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
test('label shows a percentage only when the baseline week can support one',()=>{
  assert.equal(weeklyChangeLabel({change:100,previous:1200,current:2400},'views'),'+100% · 2,400 views in the last 7 days vs 1,200 in the 7 before')
  assert.equal(weeklyChangeLabel({change:-25,previous:400,current:300},'clones'),'-25% · 300 clones in the last 7 days vs 400 in the 7 before')
  assert.equal(weeklyChangeLabel({change:51119,previous:51,current:26122},'views'),'26,122 views in the last 7 days vs 51 in the 7 before')
  assert.equal(weeklyChangeLabel({change:2400,previous:200,current:5000},'views'),'5,000 views in the last 7 days vs 200 in the 7 before')
  assert.equal(weeklyChangeLabel(null,'views'),null)
})
