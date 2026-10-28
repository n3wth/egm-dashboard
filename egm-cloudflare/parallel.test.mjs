import test from 'node:test'
import assert from 'node:assert/strict'
import {collectParallel,parallelQueries} from './parallel.mjs'
const time=Date.parse('2026-10-28T00:00:00Z')
const env={PARALLEL_API_KEY:'fixture-key',REFRESH_UNTIL:'2026-11-04T06:33:00Z'}
test('two fixed bounded fast calls preserve exact executed query lineage and canonical dedup',async()=>{
  const calls=[]
  const result=await collectParallel(env,async(url,init)=>{
    assert.equal(url,'https://api.parallel.ai/v1/search')
    assert.equal(init.headers['x-api-key'],'fixture-key')
    assert.equal(init.redirect,'error')
    const body=JSON.parse(init.body);calls.push(body.search_queries[0])
    assert.equal(body.mode,'fast');assert.equal(body.advanced_settings.max_results,5)
    return Response.json({search_id:'request-'+calls.length,results:[{title:'Elephant-Goldfish Model',url:'https://example.com/article?utm_source=a',publish_date:'2026-10-27',excerpts:['Elephant Goldfish Model '+Array(40).fill('word').join(' ')]},{title:'Unrelated animals',url:'https://example.com/fish',excerpts:['Ocean fish']}]})
  },{},time)
  assert.deepEqual(calls,parallelQueries)
  assert.equal(result.parallel_mentions.rows.length,1)
  assert.equal(result.parallel_mentions.rows[0].url,'https://example.com/article')
  assert.deepEqual(result.parallel_mentions.rows[0].queries,parallelQueries)
  assert.equal(result.parallel_mentions.rows[0].excerpt.split(/\s+/).length,25)
  assert.equal(result.parallel_status.rows[0].successfulBatches,1)
})
test('success and failure cache both prevent immediate repeated requests',async()=>{
  for(const ok of [true,false]) {
    const first=await collectParallel(env,async()=>ok?Response.json({results:[]}):new Response(null,{status:401}),{},time)
    assert.deepEqual(await collectParallel(env,()=>{throw Error('must not call')},first,time+1800000),first)
  }
})
test('cutoff, invalid cutoff and seven-batch cap prevent calls',async()=>{
  const never=()=>{throw Error('must not call')}
  assert.equal((await collectParallel(env,never,{},Date.parse(env.REFRESH_UNTIL))).parallel_status.rows[0].status,'expired')
  assert.equal((await collectParallel({...env,REFRESH_UNTIL:'invalid'},never,{},time)).parallel_status.rows[0].status,'expired')
  assert.equal((await collectParallel(env,never,{parallel_status:{rows:[{successfulBatches:7}]}},time)).parallel_status.rows[0].reason,'lifetime_batch_limit')
})
test('partial failure retains old source and budget without publishing incomplete rows or secrets',async()=>{
  const old={rows:[{url:'https://example.com/old',title:'EGM',queries:['old'],firstSeen:'old'}],source:{executedAt:'old'}}
  let calls=0
  const result=await collectParallel(env,async()=>{if(++calls===2)throw Error('fixture-key private error');return Response.json({results:[]})},{parallel_mentions:old,parallel_status:{rows:[{successfulBatches:3,totalRequests:6}]}},time)
  assert.deepEqual(result.parallel_mentions,old)
  assert.equal(result.parallel_status.rows[0].successfulBatches,3)
  assert.equal(result.parallel_status.rows[0].totalRequests,8)
  assert.equal(result.parallel_status.rows[0].status,'stale')
  assert.equal(JSON.stringify(result).includes('fixture-key'),false)
})
test('unsafe URLs and malformed provider results cannot become evidence',async()=>{
  const invalid=await collectParallel(env,async()=>Response.json({results:[{title:'Elephant Goldfish',url:'https://example.com',excerpts:[{}]}]}),{},time)
  assert.equal(invalid.parallel_status.rows[0].reason,'invalid_provider_response')
  const safe=await collectParallel(env,async()=>Response.json({results:[{title:'Elephant Goldfish',url:'javascript:alert(1)',excerpts:[]}]}),{},time)
  assert.deepEqual(safe.parallel_mentions.rows,[])
})
