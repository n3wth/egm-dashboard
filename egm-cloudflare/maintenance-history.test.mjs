import test from 'node:test'
import assert from 'node:assert/strict'
import {maintenanceHistory} from './maintenance-history.mjs'

const counts=(openIssues,openPRs,draftPRs=0)=>({openIssues,openPRs,draftPRs})
const query=(row,executedAt)=>({rows:[row],source:{executedAt}})

test('maintenance history starts with actual dated observations and preserves missing dates',()=>{
  const previous={queries:{maintenance:query(counts(7,4,1),'2026-10-28T06:00:00Z'),issue_queue:{rows:[{created_at:'2026-01-01T00:00:00Z'}]}}}
  const before=structuredClone(previous)
  const result=maintenanceHistory(previous,counts(5,2,1),'2026-11-02T19:00:00Z')
  assert.deepEqual(result.rows,[
    {date:'2026-10-27',...counts(7,4,1),observedAt:'2026-10-28T06:00:00.000Z'},
    {date:'2026-11-02',...counts(5,2,1),observedAt:'2026-11-02T19:00:00.000Z'}
  ])
  assert.equal(result.source.coverage.startDate,'2026-10-27')
  assert.equal(result.source.coverage.endDate,'2026-11-02')
  assert.equal(result.source.executedAt,'2026-11-02T19:00:00.000Z')
  assert.deepEqual(previous,before)
})

test('retains the latest Pacific-date totals through DST and allows decreases to zero',()=>{
  const previous={queries:{maintenance_history:{rows:[
    {date:'2026-10-31',...counts(9,6,2),observedAt:'2026-11-01T06:30:00Z'},
    {date:'2026-11-01',...counts(8,5,2),observedAt:'2026-11-01T08:30:00Z'}
  ]},maintenance:query(counts(7,4,1),'2026-11-01T09:30:00Z')}}
  const result=maintenanceHistory(previous,counts(0,0,0),'2026-11-02T19:00:00Z')
  assert.deepEqual(result.rows.map(row=>[row.date,row.openIssues,row.openPRs]),[['2026-10-31',9,6],['2026-11-01',7,4],['2026-11-02',0,0]])
  assert.deepEqual(maintenanceHistory({queries:{maintenance_history:result}},counts(99,99),'2026-11-02T19:00:00Z').rows,result.rows,'equal timestamps do not replace saved observations')
  const later=maintenanceHistory({queries:{maintenance_history:result}},counts(2,1),'2026-11-02T20:00:00Z')
  assert.equal(later.rows.length,3)
  assert.deepEqual(later.rows.at(-1),{date:'2026-11-02',...counts(2,1),observedAt:'2026-11-02T20:00:00.000Z'})
})

test('ignores invalid or future history and rejects invalid current totals',()=>{
  const previous={queries:{maintenance_history:{rows:[
    {date:'2026-11-01',...counts(-1,1),observedAt:'2026-11-01T19:00:00Z'},
    {date:'2026-11-01',...counts('1',1),observedAt:'2026-11-01T19:00:00Z'},
    {date:'2026-11-01',...counts(1,1,2),observedAt:'2026-11-01T19:00:00Z'},
    {date:'2026-11-01',...counts(1,1),observedAt:'2026-11-01'},
    {date:'2026-10-31',...counts(1,1),observedAt:'2026-11-01T19:00:00Z'},
    {date:'2026-03-02',...counts(1,1),observedAt:'2026-02-30T19:00:00Z'},
    {date:'2026-11-03',...counts(1,1),observedAt:'2026-11-03T19:00:00Z'},
    null
  ]},maintenance:query(counts(99,99),'2026-11-03T19:00:00Z')}}
  const result=maintenanceHistory(previous,counts(2,1),'2026-11-02T19:00:00Z')
  assert.equal(result.rows.length,1)
  for(const value of [-1,1.5,NaN,Infinity,'1',undefined])assert.throws(()=>maintenanceHistory({},counts(value,1),'2026-11-02T19:00:00Z'),/Invalid observed/)
  assert.throws(()=>maintenanceHistory({},counts(1,1,2),'2026-11-02T19:00:00Z'),/Invalid observed/)
  assert.throws(()=>maintenanceHistory({},counts(1,1),'2026-02-30T19:00:00Z'),/Invalid observed/)
  assert.throws(()=>maintenanceHistory({},counts(1,1),'invalid'),/Invalid observed/)
})

test('observed queue history survives beyond the traffic retention window',()=>{
  const rows=Array.from({length:400},(_,index)=>{
    const observedAt=new Date(Date.UTC(2024,0,1+index,20)).toISOString()
    return {date:observedAt.slice(0,10),...counts(index,0),observedAt}
  })
  const result=maintenanceHistory({queries:{maintenance_history:{rows}}},counts(2,1),'2026-11-02T19:00:00Z')
  assert.equal(result.rows.length,401)
  assert.equal(result.rows[0].date,'2024-01-01')
  assert.equal(result.rows.at(-1).date,'2026-11-02')
})
