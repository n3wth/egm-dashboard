import test from 'node:test'
import assert from 'node:assert/strict'
import {trafficRangeSummary} from './traffic-range.mjs'

const row=(date,views,visitors=1)=>({date,views,visitors})
test('totals additive counts across the selected days',()=>{
  assert.deepEqual(trafficRangeSummary([row('2026-10-02',5),row('2026-10-01',4)],'views'),{start:'2026-10-01',end:'2026-10-02',days:2,missingDays:0,total:9})
})
test('counts days without an observation as missing, never zero',()=>{
  const summary=trafficRangeSummary([row('2026-10-01',4),row('2026-10-05',6)],'views')
  assert.equal(summary.missingDays,3)
  assert.equal(summary.total,10)
})
test('an unknown count makes the total unknown',()=>{
  assert.equal(trafficRangeSummary([row('2026-10-01',4),row('2026-10-02',null)],'views').total,null)
})
test('no dated rows has no summary',()=>{
  assert.equal(trafficRangeSummary([],'views'),null)
  assert.equal(trafficRangeSummary([{date:'Oct 1',views:1}],'views'),null)
})
