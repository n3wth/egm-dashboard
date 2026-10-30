import test from 'node:test'
import assert from 'node:assert/strict'
import {count,staleness} from './states.mjs'

const now=Date.parse('2026-10-29T12:00:00Z')
test('a fresh snapshot is not flagged',()=>{
  assert.equal(staleness('2026-10-29T06:00:00Z',now),null)
  assert.equal(staleness('2026-10-28T01:00:00Z',now),null)
})
test('an old snapshot reports its age in hours, then days',()=>{
  assert.deepEqual(staleness('2026-10-27T22:00:00Z',now),{hours:38,label:'38 hours ago'})
  assert.equal(staleness('2026-10-25T12:00:00Z',now).label,'4 days ago')
})
test('a missing, invalid or future timestamp is not flagged',()=>{
  for(const value of [undefined,null,'','yesterday','2026-11-30T00:00:00Z'])assert.equal(staleness(value,now),null,String(value))
})
test('count formats numbers and never prints NaN',()=>{
  assert.equal(count(12345),'12,345')
  assert.equal(count('7'),'7')
  assert.equal(count(0),'0')
  for(const value of [null,undefined,NaN,'','abc'])assert.equal(count(value),'Unavailable',String(value))
})
