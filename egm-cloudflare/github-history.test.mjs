import test from 'node:test'
import assert from 'node:assert/strict'
import {retainGithubHistory} from './github-history.mjs'

const snapshot=(date,rows)=>({generatedAt:date,queries:{traffic:{rows,source:{executedAt:date}},referrers:{rows:[{referrer:'example.com',count:5}],source:{executedAt:date}}}})
test('daily history survives window rollover and corrects overlapping dates without adding counts',()=>{
  const first=snapshot('2026-10-01T10:00:00Z',[{date:'2026-09-17',views:3},{date:'2026-09-18',views:4}])
  const next=snapshot('2026-10-02T10:00:00Z',[{date:'2026-09-18',views:6},{date:'2026-09-19',views:8}])
  const history=retainGithubHistory({...first,githubHistory:retainGithubHistory({},first)},next)
  assert.deepEqual(history.daily.traffic.map(row=>row.views),[3,6,8])
  assert.equal(history.daily.traffic[1].observedAt,next.generatedAt)
  assert.equal(history.windows.length,2)
  assert.equal(first.queries.traffic.rows[1].views,4)
})
test('rolling observations retain one latest snapshot per collection day and never expire',()=>{
  let previous={}
  for(let day=1;day<=20;day++) {
    const next=snapshot(`2026-10-${String(day).padStart(2,'0')}T10:00:00Z`,[])
    previous={...next,githubHistory:retainGithubHistory(previous,next)}
  }
  const later=snapshot('2026-10-20T12:00:00Z',[])
  const history=retainGithubHistory(previous,later)
  assert.equal(history.windows.length,20)
  assert.equal(history.windows.at(-1).observedAt,later.generatedAt)
  assert.equal(history.windows[0].queries.referrers.rows[0].count,5)
})
