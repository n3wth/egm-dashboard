import test from 'node:test'
import assert from 'node:assert/strict'
import {collectTavily,tavilyQueries} from './tavily.mjs'
const now=Date.parse('2026-10-28T20:00:00Z')
const env={TAVILY_API_KEY:'test-key',REFRESH_UNTIL:'2026-11-04T20:00:00Z'}
const item={url:'https://www.example-news.org/egm?utm_source=test',title:'Elephant Goldfish Model',content:'Elephant Goldfish Model '+Array.from({length:40},(_,i)=>'word'+i).join(' '),published_date:'Tue, 27 Oct 2026 17:00:00 GMT'}
test('exactly three fixed basic queries have bounded output and actual usage',async()=>{
  const seen=[]
  const result=await collectTavily(env,async(url,init)=>{
    assert.equal(url,'https://api.tavily.com/search');assert.equal(init.redirect,'error')
    const body=JSON.parse(init.body);seen.push(body.query)
    assert.equal(body.search_depth,'basic');assert.equal(body.max_results,5);assert.equal(body.auto_parameters,false)
    assert.equal(body.include_answer,false);assert.equal(body.include_raw_content,false)
    return Response.json({results:[item],usage:{credits:1}})
  },{},now)
  assert.deepEqual(seen,tavilyQueries)
  assert.equal(result.tavily_mentions.rows.length,1)
  assert.equal(result.tavily_mentions.rows[0].excerpt.split(' ').length,25)
  assert.equal(result.tavily_mentions.rows[0].published,'2026-10-27T17:00:00.000Z')
  assert.deepEqual(result.tavily_mentions.rows[0].queries,tavilyQueries)
  assert.equal(result.tavily_status.rows[0].creditsUsed,3)
  assert.equal(result.tavily_status.rows[0].successfulBatches,1)
})
test('successful and failed batches are cached for24hours preserving evidence freshness',async()=>{
  const first=await collectTavily(env,async()=>Response.json({results:[item]}),{},now)
  const cached=await collectTavily(env,async()=>assert.fail('cached'),first,now+1000)
  assert.deepEqual(cached,first)
  const failed=await collectTavily(env,async()=>new Response('blocked',{status:429}),first,now+86400000)
  assert.equal(failed.tavily_status.rows[0].status,'stale')
  assert.deepEqual(failed.tavily_mentions,first.tavily_mentions)
  assert.equal(failed.tavily_status.rows[0].successfulBatches,1)
  await collectTavily(env,async()=>assert.fail('failed cached'),failed,now+86401000)
})
test('malformed and over-limit responses do not publish partially collected rows',async()=>{
  let calls=0
  const result=await collectTavily(env,async()=>Response.json(++calls===1?{results:[item]}:{results:Array(6).fill(item)}),{},now)
  assert.equal(result.tavily_status.rows[0].reason,'invalid_provider_response')
  assert.equal(result.tavily_status.rows[0].successfulBatches,0)
  assert.deepEqual(result.tavily_mentions.rows,[])
})
test('later observations preserve firstSeen and only actual matching query lineage',async()=>{
  const first=await collectTavily(env,async()=>Response.json({results:[item]}),{},now)
  let call=0
  const next=await collectTavily(env,async()=>Response.json({results:++call===2?[{...item,url:'https://example-news.org/egm',published_date:'yesterday'}]:[]}),first,now+86400000)
  const row=next.tavily_mentions.rows[0]
  assert.equal(row.firstSeen,first.tavily_mentions.rows[0].firstSeen)
  assert.deepEqual(row.queries,tavilyQueries)
  assert.equal(row.published,'2026-10-27T17:00:00.000Z')
})
test('credential, cutoff, and seven successful batches block further network calls',async()=>{
  const never=async()=>assert.fail('must not request')
  assert.equal((await collectTavily({},never,{},now)).tavily_status.rows[0].reason,'collection_window_ended')
  assert.equal((await collectTavily({REFRESH_UNTIL:env.REFRESH_UNTIL},never,{},now)).tavily_status.rows[0].reason,'credential_unavailable')
  const capped=await collectTavily(env,never,{tavily_status:{rows:[{successfulBatches:7}]}},now)
  assert.equal(capped.tavily_status.rows[0].reason,'lifetime_batch_limit')
})
test('generic EGM acronym and unsafe URLs are excluded without invented dates',async()=>{
  const result=await collectTavily(env,async()=>Response.json({results:[{url:'javascript:alert(1)',title:'Elephant Goldfish Model',content:''},{url:'https://example-news.org/other',title:'EGM games',content:'Gaming'},{...item,published_date:'2 days ago'}]}),{},now)
  assert.equal(result.tavily_mentions.rows.length,1)
  assert.equal(result.tavily_mentions.rows[0].published,null)
})
