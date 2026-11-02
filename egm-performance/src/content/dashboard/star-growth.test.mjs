import test from 'node:test'
import assert from 'node:assert/strict'
import {starGrowth} from './star-growth.mjs'

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
