import test from 'node:test'
import assert from 'node:assert/strict'
import {collectEngagement} from './engagement.mjs'
const now=Date.parse('2026-10-28T12:00:00Z'),env={REFRESH_UNTIL:'2026-11-04T12:00:00Z'}
test('only known exact HN URLs are checked, actual zero kept and success cached',async()=>{
  const mentions={rows:[{url:'https://news.ycombinator.com/item?id=123'},{url:'https://evil.example/item?id=123'},{url:'https://news.ycombinator.com/item?id=abc'}]}
  const result=await collectEngagement(env,async(url,init)=>{assert.equal(url,'https://hacker-news.firebaseio.com/v0/item/123.json');assert.equal(init.redirect,'manual');return Response.json({id:123,type:'story',score:0,descendants:12})},{mentions},now)
  assert.equal(result.mention_engagement.rows[0].hnPoints,0)
  assert.equal(result.mention_engagement.rows[0].comments,12)
  const cached=await collectEngagement(env,async()=>assert.fail('cached'),{mentions,...result},now+1000)
  assert.deepEqual(cached.mention_engagement.source,result.mention_engagement.source)
})
test('failures cached, wrong item rejected and daily attempts bounded five',async()=>{
  const mentions={rows:Array.from({length:9},(_,i)=>({url:'https://news.ycombinator.com/item?id='+(i+1)}))}
  let calls=0
  const result=await collectEngagement(env,async()=>{calls++;return Response.json({id:999,type:'story',score:30})},{mentions},now)
  assert.equal(calls,5)
  assert.ok(result.mention_engagement.rows.every(row=>row.status==='unavailable'&&row.hnPoints===undefined))
  await collectEngagement(env,async()=>assert.fail('negative cached'),{mentions,...result},now+1000)
})
test('cached stories do not prevent later discovered stories from being checked',async()=>{
  const mentions={rows:Array.from({length:7},(_,i)=>({url:'https://news.ycombinator.com/item?id='+(i+1)}))}
  const mention_engagement={rows:Array.from({length:5},(_,i)=>({hnId:String(i+1),lastAttemptAt:new Date(now-1000).toISOString()}))}
  const checked=[]
  const result=await collectEngagement(env,async url=>{
    const id=Number(url.match(/(\d+)\.json$/)[1]);checked.push(id)
    return Response.json({id,type:'story',score:1,descendants:0})
  },{mentions,mention_engagement},now)
  assert.deepEqual(checked,[6,7])
  assert.equal(result.mention_engagement_status.rows[0].dailyAttempts,2)
})
test('unchecked stories are prioritized even after earlier stories expire',async()=>{
  const mentions={rows:Array.from({length:7},(_,i)=>({url:'https://news.ycombinator.com/item?id='+(i+1)}))}
  const mention_engagement={rows:Array.from({length:5},(_,i)=>({hnId:String(i+1),lastAttemptAt:new Date(now-86400001).toISOString()}))}
  const checked=[]
  await collectEngagement(env,async url=>{
    const id=Number(url.match(/(\d+)\.json$/)[1]);checked.push(id)
    return Response.json({id,type:'story',score:1,descendants:0})
  },{mentions,mention_engagement},now)
  assert.deepEqual(checked.slice(0,2),[6,7])
  assert.equal(checked.length,5)
})
