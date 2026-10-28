import test from 'node:test'
import assert from 'node:assert/strict'
import {canonicalMentionUrl,collectMentions,mentionQueries,mentionsCacheMs,mentionsQueryRecords,normalizeMentions} from './mentions.mjs'
const at='2026-10-28T05:00:00.000Z'
const time=Date.parse(at)
const video={url:'https://youtu.be/xxf6D9jynFw?si=tracking',title:'Elephant-Goldfish Model demo'}
const env={FIRECRAWL_API_KEY:'test-only',REFRESH_UNTIL:'2026-11-05T00:00:00Z'}
test('canonical URLs deduplicate YouTube variants and tracking parameters',()=>{
  const expected='https://www.youtube.com/watch?v=xxf6D9jynFw'
  assert.equal(canonicalMentionUrl(video.url),expected)
  assert.equal(canonicalMentionUrl('https://m.youtube.com/shorts/xxf6D9jynFw?utm_source=x'),expected)
  assert.equal(canonicalMentionUrl('https://www.youtube.com/watch?v=xxf6D9jynFw&t=4'),expected)
  assert.equal(canonicalMentionUrl('https://twitter.com/test/status/1?utm_source=foo'),'https://x.com/test/status/1')
  assert.equal(canonicalMentionUrl('javascript:alert(1)'),null)
})
test('normalization excludes unrelated EGM and owned pages; never invents publication time',()=>{
  const rows=normalizeMentions([video,{...video,url:'https://www.youtube.com/watch?v=xxf6D9jynFw',published:'2 days ago'},{url:'https://example.com/egm',title:'EGM gaming machines'},{url:'https://egm.dev/',title:'Elephant Goldfish Model'},{url:'https://example.com/news',title:'Elephant-Goldfish Model launch',published:'2026-10-23'}],[],at)
  assert.equal(rows.length,2)
  assert.equal(rows.find(row=>row.kind==='Video').published,null)
  assert.equal(rows.find(row=>row.kind==='Video').firstSeen,at)
  assert.equal(rows.find(row=>row.kind==='Media / web').published,'2026-10-23')
  const next=normalizeMentions([video],rows,'2026-10-28T07:00:00Z')
  assert.equal(next.find(row=>row.kind==='Video').firstSeen,at)
})
test('collector runs exactly three queries and uses last-good cache for two hours',async()=>{
  let requests=0
  const provider=async()=>{requests++;return Response.json({success:true,data:{web:[video]},creditsUsed:2})}
  const first=await collectMentions(env,provider,{},time)
  assert.equal(requests,3)
  assert.equal(first.mentions.rows.length,1)
  assert.equal(first.mentions_status.rows[0].creditsUsed,6)
  const cached=await collectMentions(env,provider,first,time+mentionsCacheMs-1)
  assert.equal(requests,3)
  assert.deepEqual(cached,first)
})
test('provider failure retains complete prior data and failed attempts are also cached',async()=>{
  const prior=mentionsQueryRecords(normalizeMentions([video],[],at),at)
  let requests=0
  const failure=async()=>{requests++;return new Response('no units',{status:402})}
  const failed=await collectMentions(env,failure,prior,time+mentionsCacheMs)
  assert.equal(failed.mentions_status.rows[0].status,'stale')
  assert.equal(failed.mentions_status.rows[0].reason,'provider_http_402')
  assert.deepEqual(failed.mentions,prior.mentions)
  await collectMentions(env,failure,failed,time+mentionsCacheMs+1000)
  assert.equal(requests,1)
})
test('no credential or expired collection window never calls provider',async()=>{
  const never=async()=>assert.fail('must not fetch')
  assert.equal((await collectMentions({},never,{},time)).mentions_status.rows[0].reason,'credential_unavailable')
  assert.equal((await collectMentions({...env,REFRESH_UNTIL:'2026-10-01'},never,{},time)).mentions_status.rows[0].reason,'collection_window_ended')
})
test('canonical mentions retain actual query lineage across duplicate results and observations',()=>{
  const initial=normalizeMentions([{...video,query:'executed broad query'},{...video,url:'https://www.youtube.com/watch?v=xxf6D9jynFw',query:'executed video query'},{...video,query:'executed broad query'}],[],at)
  assert.deepEqual(initial[0].queries,['executed broad query','executed video query'])
  assert.equal(initial[0].query,'executed broad query')
  const next=normalizeMentions([{...video,query:'executed later query'}],initial,'2026-10-29T05:00:00Z')
  assert.deepEqual(next[0].queries,['executed broad query','executed video query','executed later query'])
  assert.equal(next[0].firstSeen,at)
  assert.ok(mentionQueries.every(query=>!next[0].queries.includes(query)))
})
test('legacy query provenance migrates without fabricating unknown discovery queries',()=>{
  const legacy={...normalizeMentions([video],[],at)[0],query:'legacy executed query'}
  delete legacy.queries
  const rows=normalizeMentions([], [legacy], at)
  assert.deepEqual(rows[0].queries,['legacy executed query'])
  const unknown=normalizeMentions([video],[],at)[0]
  assert.deepEqual(unknown.queries,[])
  assert.equal(unknown.query,null)
})
test('collector attributes a result only to queries that returned it',async()=>{
  let call=0
  const records=await collectMentions(env,async()=>Response.json({success:true,data:{web:++call===2?[video]:[]}}),{},time)
  assert.deepEqual(records.mentions.rows[0].queries,[mentionQueries[1]])
  assert.equal(records.mentions.rows[0].query,mentionQueries[1])
  assert.ok(records.mentions.source.caveats.some(text=>text.includes('site operators loosely')))
})
