import test from 'node:test'
import assert from 'node:assert/strict'
import {starObservations} from './star-observations.mjs'

const reach=(stars,executedAt)=>({rows:[{stars}],source:{executedAt}})

test('bootstraps only actual dated reach observations and keeps the latest Pacific-date sample',()=>{
  const previous={queries:{
    star_observations:{rows:[{date:'2026-10-29',stars:70,observedAt:'2026-10-30T06:00:00Z'}]},
    reach:reach(90,'2026-11-01T06:00:00Z'),
    star_history:{rows:[{date:'2026-10-01',stars:1}]}
  },githubHistory:{windows:[
    {observedAt:'2026-10-31T23:00:00Z',queries:{reach:reach(80,'2026-10-31T06:00:00Z')}},
    {observedAt:'2026-10-31T23:30:00Z',queries:{reach:reach(75,'2026-10-31T05:00:00Z')}},
    {observedAt:'2026-10-28T23:00:00Z',queries:{reach:{rows:[{stars:60}]}}}
  ]}}
  const result=starObservations(previous,100,'2026-11-02T08:15:00Z')
  assert.deepEqual(result.rows.map(row=>[row.date,row.stars]),[['2026-10-29',70],['2026-10-30',80],['2026-10-31',90],['2026-11-02',100]])
  assert.equal(result.source.coverage.startDate,'2026-10-29')
  assert.equal(result.source.executedAt,'2026-11-02T08:15:00.000Z')
  assert.equal(previous.queries.star_observations.rows.length,1)
})

test('same-day samples replace only older timestamps, including the repeated DST hour',()=>{
  const previous={queries:{star_observations:{rows:[
    {date:'2026-10-31',stars:122,observedAt:'2026-11-01T06:30:00Z'},
    {date:'2026-11-01',stars:120,observedAt:'2026-11-01T08:30:00Z'}
  ]},reach:reach(119,'2026-11-01T09:30:00Z')},githubHistory:{windows:[{queries:{reach:reach(999,'2026-11-01T08:45:00Z')}},{queries:{reach:reach(999,'2026-11-01T09:30:00Z')}}]}}
  const result=starObservations(previous,118,'2026-11-02T08:15:00Z')
  assert.deepEqual(result.rows.map(row=>row.stars),[122,119,118],'decreases remain valid observations')
  const later={queries:{star_observations:result}}
  assert.deepEqual(starObservations(later,999,'2026-11-02T08:15:00Z').rows,result.rows)
})

test('future legacy observations cannot replace the current sample or move source freshness forward',()=>{
  const previous={queries:{star_observations:{rows:[{date:'2026-11-03',stars:999999,observedAt:'2026-11-03T09:00:00Z'}]},reach:reach(999999,'2026-11-02T09:00:00Z')},githubHistory:{windows:[{queries:{reach:reach(999999,'2026-11-04T09:00:00Z')}}]}}
  const result=starObservations(previous,300000,'2026-11-02T08:15:00Z')
  assert.deepEqual(result.rows,[{date:'2026-11-02',stars:300000,observedAt:'2026-11-02T08:15:00.000Z'}])
  assert.equal(result.source.executedAt,'2026-11-02T08:15:00.000Z')
})

test('invalid historical samples are ignored and invalid current totals fail closed',()=>{
  const previous={queries:{star_observations:{rows:[
    {date:'2026-11-01',stars:-1,observedAt:'2026-11-01T09:30:00Z'},
    {date:'2026-11-01',stars:'100',observedAt:'2026-11-01T09:30:00Z'},
    {date:'2026-11-01',stars:1.5,observedAt:'2026-11-01T09:30:00Z'},
    {date:'2026-11-01',stars:100,observedAt:'invalid'},
    {date:'2026-11-01',stars:100,observedAt:'2026-11-01'},
    {date:'2026-03-02',stars:100,observedAt:'2026-02-30T09:30:00Z'},
    {date:'2026-10-31',stars:100,observedAt:'2026-11-01T09:30:00Z'},
    null
  ]}}}
  assert.equal(starObservations(previous,300000,'2026-11-02T08:15:00Z').rows.length,1)
  for(const value of [-1,NaN,Infinity,'300000',1.5])assert.throws(()=>starObservations({},value,'2026-11-02T08:15:00Z'),/Invalid observed/)
  assert.throws(()=>starObservations({},300000,'invalid'),/Invalid observed/)
  assert.throws(()=>starObservations({},300000,'2026-02-30T09:30:00Z'),/Invalid observed/)
})

test('observed daily history is retained beyond the traffic window without filling gaps',()=>{
  const rows=Array.from({length:400},(_,index)=>{
    const time=new Date(Date.UTC(2024,0,1+index,20)).toISOString()
    return {date:time.slice(0,10),stars:200000+index,observedAt:time}
  })
  const result=starObservations({queries:{star_observations:{rows}}},300000,'2026-11-02T08:15:00Z')
  assert.equal(result.rows.length,401)
  assert.equal(result.rows[0].stars,200000)
  assert.equal(result.rows.at(-1).stars,300000)
})
