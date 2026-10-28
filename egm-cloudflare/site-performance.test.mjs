import test from 'node:test'
import assert from 'node:assert/strict'
import {collectSitePerformance} from './site-performance.mjs'

const now=Date.parse('2026-10-28T12:00:00Z')
const env={GOOGLE_PERFORMANCE_API_KEY:'test',REFRESH_UNTIL:'2026-11-04T00:00:00Z'}
test('collects lab and phone field metrics and caches them for a day',async()=>{
  let calls=0
  const first=await collectSitePerformance(env,async url=>{
    calls++
    return url.includes('pagespeedonline') ? Response.json({lighthouseResult:{categories:{performance:{score:0.93}}}}) : Response.json({record:{collectionPeriod:{firstDate:{year:2026,month:10,day:1},lastDate:{year:2026,month:10,day:28}},metrics:{largest_contentful_paint:{percentiles:{p75:1200}},cumulative_layout_shift:{percentiles:{p75:'0.07'}}}}})
  },{},now)
  assert.equal(calls,2)
  assert.equal(first.site_performance.rows[0].score,93)
  assert.equal(first.site_performance.rows[1].cls,0.07)
  assert.equal(first.site_performance.rows[1].periodStart,'2026-10-01')
  await collectSitePerformance(env,async()=>assert.fail('cached'),first,now+1000)
})
test('failure preserves old data and timestamp, and missing keys never make requests',async()=>{
  const old={site_performance:{rows:[{kind:'Lab',score:80,observedAt:'2026-10-01T00:00:00Z'}],source:{executedAt:'2026-10-01T00:00:00Z'}}}
  const result=await collectSitePerformance(env,async()=>new Response('',{status:429}),old,now)
  assert.equal(result.site_performance.rows[0].score,80)
  assert.equal(result.site_performance.rows[0].status,'unavailable')
  assert.equal(result.site_performance.rows[0].observedAt,'2026-10-01T00:00:00Z')
  await collectSitePerformance({...env,GOOGLE_PERFORMANCE_API_KEY:''},async()=>assert.fail('unconfigured'),{},now)
  await collectSitePerformance({...env,REFRESH_UNTIL:'2020-01-01'},async()=>assert.fail('expired'),{},now)
})
