import test from 'node:test'
import assert from 'node:assert/strict'
import {engagementSignals} from '../src/content/dashboard/engagement-signals.mjs'
test('only actual nonnegative integer counts with observation times appear; zero is legitimate',()=>{
  const rows=engagementSignals({views:1200,likes:0,comments:null,reactions:'5',reposts:-1,points:NaN,statsObservedAt:'2026-10-28T10:00:00Z'})
  assert.deepEqual(rows.map(row=>[row.kind,row.value]),[['views',1200],['likes',0]])
  assert.deepEqual(engagementSignals({views:12,firstSeen:'2026-10-28T10:00:00Z'}),[])
  assert.deepEqual(engagementSignals({views:1.5,observedAt:'bad'}),[])
})
