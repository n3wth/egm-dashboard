import test from 'node:test'
import assert from 'node:assert/strict'
import {ANALYSIS_QUESTION,analyzeObservedStars} from './ask-analysis.mjs'

const day=(start,offset)=>new Date(Date.parse(start+'T00:00:00Z')+offset*86400000).toISOString().slice(0,10)
// Totals 100, 170 and 205 on the three boundaries; +10 per interval then +5 per interval.
const knownStars=Array.from({length:15},(_,i)=>i<=7?100+i*10:170+(i-7)*5)
const series=(start,stars,hour='20')=>stars.map((value,i)=>({date:day(start,i),stars:value,observedAt:day(start,i)+`T${hour}:00:00Z`}))
const definition={label:'Observed net star change',definition:'Stored source definition.'}
const query=(rows,executedAt='2026-10-28T18:00:00Z',extra={})=>({rows,source:{label:'GitHub · observed repository star totals',executedAt,metricDefinitions:[{label:'Observed stars',definition:'Other.'},definition],...extra}})
const now=Date.parse('2026-10-28T19:00:00Z')
const rows=series('2026-10-13',knownStars)
const sum=values=>values.reduce((total,row)=>total+row.netStars,0)
const numeric=['previous','current','difference']

test('exports the exact supported starter question',()=>{
  assert.equal(ANALYSIS_QUESTION,'Compare EGM net star growth over the last 7 complete sampling days with the previous 7?')
})

test('known boundary totals 100, 170 and 205 give 70, 35 and a signed -35',()=>{
  const {calculation,rows:result}=analyzeObservedStars(query(rows),now)
  assert.equal(calculation.id,'observed-net-stars-7d')
  assert.equal(calculation.status,'complete')
  assert.equal(calculation.timeZone,'America/Los_Angeles')
  assert.equal(calculation.definition,'Stored source definition.')
  assert.equal(calculation.observedAt,'2026-10-28T18:00:00.000Z')
  assert.equal(calculation.reason,null)
  assert.deepEqual(calculation.availableRange,{startDate:'2026-10-13',endDate:'2026-10-27'})
  assert.deepEqual(calculation.boundaries,[
    {label:'Previous start',date:'2026-10-13',observedAt:'2026-10-13T20:00:00Z',stars:100},
    {label:'Period boundary',date:'2026-10-20',observedAt:'2026-10-20T20:00:00Z',stars:170},
    {label:'Latest end',date:'2026-10-27',observedAt:'2026-10-27T20:00:00Z',stars:205}
  ])
  assert.equal(calculation.previous,70)
  assert.equal(calculation.current,35)
  assert.equal(calculation.difference,-35)
  assert.equal(result.length,14)
  assert.equal(sum(result.slice(0,7)),calculation.previous)
  assert.equal(sum(result.slice(7)),calculation.current)
  assert.equal(result[0].date,'2026-10-14')
  assert.equal(result.at(-1).date,'2026-10-27')
})

test('rows and boundaries are projected to reviewed fields only',()=>{
  const tainted=rows.map(row=>({...row,secret:'token',rawMarkdown:'body',coverage:'forged'}))
  const {calculation,rows:result}=analyzeObservedStars(query(tainted),now)
  for(const row of result)assert.deepEqual(Object.keys(row),['date','netStars'])
  for(const boundary of calculation.boundaries)assert.deepEqual(Object.keys(boundary),['label','date','observedAt','stars'])
  assert.ok(!JSON.stringify(calculation).includes('token'))
})

test('zero and negative nets are signed values without percentages',()=>{
  const stars=Array.from({length:15},(_,i)=>i<=7?100:100-(i-7))
  const {calculation,rows:result}=analyzeObservedStars(query(series('2026-10-13',stars)),now)
  assert.equal(calculation.previous,0)
  assert.equal(calculation.current,-7)
  assert.equal(calculation.difference,-7)
  assert.ok(!('change' in calculation))
  assert.ok(!/percent|%/i.test(JSON.stringify(calculation)))
  assert.equal(sum(result.slice(7)),-7)
})

test('the current source sampling day is excluded',()=>{
  const partial=[...rows,{date:'2026-10-28',stars:9000,observedAt:'2026-10-28T17:00:00Z'}]
  const {calculation,rows:result}=analyzeObservedStars(query(partial),now)
  assert.equal(calculation.status,'complete')
  assert.equal(calculation.current,35)
  assert.equal(result.at(-1).date,'2026-10-27')
  assert.equal(calculation.boundaries[2].stars,205)
})

test('a stale final boundary is unavailable with the known range and no numbers',()=>{
  const stale=series('2026-10-12',knownStars)
  const {calculation,rows:result}=analyzeObservedStars(query([...stale,{date:'2026-10-27',stars:300,observedAt:'2026-10-27T17:00:00Z'}],'2026-10-27T17:00:00Z'),now)
  assert.equal(calculation.status,'unavailable')
  assert.match(calculation.reason,/2026-10-26.*2026-10-27 is required/)
  assert.deepEqual(calculation.availableRange,{startDate:'2026-10-12',endDate:'2026-10-27'})
  assert.equal(calculation.observedAt,'2026-10-27T17:00:00.000Z')
  for(const key of numeric)assert.ok(!(key in calculation))
  assert.deepEqual(calculation.boundaries,[])
  assert.deepEqual(result,[])
})

test('future or invalid source timestamps are rejected',()=>{
  for(const executedAt of ['2026-10-28T19:00:01Z','2026-02-30T10:00:00Z','yesterday',null,42]) {
    const {calculation,rows:result}=analyzeObservedStars(query(rows,executedAt),now)
    assert.equal(calculation.status,'unavailable')
    assert.match(calculation.reason,/invalid or later than the request time/)
    assert.equal(calculation.observedAt,null)
    assert.equal(calculation.availableRange,null)
    for(const key of numeric)assert.ok(!(key in calculation))
    assert.deepEqual(result,[])
  }
})

test('missing queries or rows report missing observations',()=>{
  for(const value of [undefined,null,'rows',{},{rows:[]},{rows:'x'},{rows:{0:rows[0]}},{rows:null,source:{executedAt:'2026-10-28T18:00:00Z'}}]) {
    const {calculation,rows:result}=analyzeObservedStars(value,now)
    assert.equal(calculation.status,'unavailable')
    assert.match(calculation.reason,/No retained repository star observations/)
    assert.equal(calculation.availableRange,null)
    assert.deepEqual(calculation.boundaries,[])
    assert.deepEqual(result,[])
  }
})

test('gaps, short history and malformed rows are insufficient history, never zero-filled',()=>{
  const gapped=rows.filter((_,i)=>i!==5)
  const short=rows.slice(1)
  const malformed=rows.map((row,i)=>i===5?{...row,stars:'130'}:i===9?{...row,observedAt:'2026-10-22T25:00:00Z'}:row)
  for(const value of [gapped,short,malformed,[null,1,'x',...rows.slice(3)]]) {
    const {calculation,rows:result}=analyzeObservedStars(query(value),now)
    assert.equal(calculation.status,'unavailable')
    assert.match(calculation.reason,/Fewer than 15 consecutive/)
    assert.ok(calculation.availableRange)
    for(const key of numeric)assert.ok(!(key in calculation))
    assert.deepEqual(result,[])
  }
})

test('an invalid duplicate does not displace a valid sample on the same date',()=>{
  const duplicated=[...rows,{date:'2026-10-20',stars:-1,observedAt:'2026-10-20T23:00:00Z'},{date:'2026-10-20',stars:999,observedAt:'2026-10-21T23:00:00Z'},null,7]
  const {calculation}=analyzeObservedStars(query(duplicated),now)
  assert.equal(calculation.status,'complete')
  assert.equal(calculation.boundaries[1].stars,170)
  assert.equal(calculation.difference,-35)
})

test('freshness uses the Pacific calendar date across DST',()=>{
  // 2026-03-09T07:30Z is 00:30 PDT on March 9; subtracting 24 hours would land on March 7 PST.
  const spring=series('2026-02-22',knownStars)
  const {calculation}=analyzeObservedStars(query(spring,'2026-03-09T07:10:00Z'),Date.parse('2026-03-09T07:30:00Z'))
  assert.equal(calculation.status,'complete')
  assert.equal(calculation.boundaries[2].date,'2026-03-08')
  // 2026-11-02T07:30Z is 23:30 PST on November 1, so October 31 is the required end.
  const fall=series('2026-10-17',knownStars)
  assert.equal(analyzeObservedStars(query(fall,'2026-11-02T07:10:00Z'),Date.parse('2026-11-02T07:30:00Z')).calculation.status,'complete')
})

test('uses every retained row in any stored order and falls back to the collector definition',()=>{
  const long=series('2026-08-01',Array.from({length:88},(_,i)=>i<=73?i:i<=80?73+(i-73)*10:143+(i-80)*5))
  const shuffled=[...long].reverse()
  const {calculation,rows:result}=analyzeObservedStars({rows:shuffled,source:{executedAt:'2026-10-28T18:00:00Z'}},now)
  assert.equal(calculation.status,'complete')
  assert.deepEqual(calculation.availableRange,{startDate:'2026-08-01',endDate:'2026-10-27'})
  assert.equal(calculation.boundaries[0].date,'2026-10-13')
  assert.equal(calculation.previous,70)
  assert.equal(calculation.current,35)
  assert.equal(result.length,14)
  assert.match(calculation.definition,/^The difference between dated repository-total samples/)
})

test('does not mutate the source query',()=>{
  const value=query(rows)
  const before=JSON.stringify(value)
  analyzeObservedStars(value,now)
  assert.equal(JSON.stringify(value),before)
})
