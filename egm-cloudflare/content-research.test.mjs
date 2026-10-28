import test from 'node:test'
import assert from 'node:assert/strict'
import {collectContentResearch,extractDiscussionEvidence,publicMentionUrl} from './content-research.mjs'

const now=Date.parse('2026-10-28T20:00:00Z')
const env={FIRECRAWL_API_KEY:'test-key',REFRESH_UNTIL:'2026-11-04T20:00:00Z'}
const mention=i=>({url:`https://example-news.org/story-${i}`,title:'Elephant Goldfish Model'})
const queries=count=>({mentions:{rows:Array.from({length:count},(_,i)=>mention(i))}})
const provider=async()=>Response.json({success:true,data:{markdown:'Elephant-Goldfish Model uses a workflow review protocol. The installation tutorial demonstrates the process.',metadata:{title:'Observed article',author:'A writer','article:published_time':'2026-10-27',statusCode:200,scrapeId:'test-id'}},creditsUsed:1})

test('only known public HTTPS names are accepted; private IP and reserved hosts fail',()=>{
  const bad=['https://127.0.0.1/','https://[::1]/','https://localhost/','https://local.internal/x','https://news.example/x','https://example-news.org:444/a','http://example-news.org/a','https://egm.dev/','https://github.com/a']
  for(const url of bad)assert.equal(publicMentionUrl(url,new Set([url])),null)
  assert.equal(publicMentionUrl(mention(0).url,new Set()),null)
  assert.equal(publicMentionUrl(mention(0).url,new Set([mention(0).url])),mention(0).url)
})
test('body relevance, short literal quotes and themes are evidence checks only',()=>{
  assert.equal(extractDiscussionEvidence('EGM gaming machines are difficult to install.','https://example-news.org/').status,'unverified')
  const body='Elephant Goldfish Model workflow installation tutorial limitation'
  const result=extractDiscussionEvidence(body,'https://example-news.org/')
  assert.equal(result.status,'verified')
  assert.equal(result.themes.length,2)
  for(const theme of result.themes){assert.ok(body.includes(theme.quote));assert.ok(theme.quote.split(' ').length<=5)}
  assert.ok(result.contentExcerpt.split(' ').length<=14)
})
test('at most five fixed-provider requests; raw retained content is bounded',async()=>{
  let count=0
  const result=await collectContentResearch(env,async(url,init)=>{
    count++;assert.equal(url,'https://api.firecrawl.dev/v2/scrape')
    assert.equal(init.redirect,'error')
    assert.ok(JSON.parse(init.body).url.startsWith('https://example-news.org/'))
    return Response.json({success:true,data:{markdown:'Elephant-Goldfish Model workflow. '+'x'.repeat(8000),metadata:{title:'Title'}},creditsUsed:1})
  },queries(10),now)
  assert.equal(count,5)
  assert.equal(result.research_evidence.rows.length,5)
  assert.equal(result.research_evidence.rows[0].rawMarkdown.length,6000)
  assert.equal(result.research_status.rows[0].creditsUsed,5)
})
test('failures and successful attempts are cached for24hours and preserve provenance',async()=>{
  const first=await collectContentResearch(env,provider,queries(1),now)
  const row=first.research_evidence.rows[0]
  assert.equal(row.author,'A writer')
  assert.equal(row.published,'2026-10-27')
  assert.equal(row.scrapeId,'test-id')
  const cached=await collectContentResearch(env,async()=>assert.fail('cached'),{...queries(1),...first},now+1000)
  assert.deepEqual(cached.research_evidence.rows,first.research_evidence.rows)
  assert.deepEqual(cached.research_evidence.source,first.research_evidence.source)
  assert.equal(cached.research_status.source.executedAt,new Date(now+1000).toISOString())
  const failed=await collectContentResearch(env,async()=>new Response('blocked',{status:403}),{...queries(1),...first},now+86400000)
  assert.equal(failed.research_evidence.rows[0].status,'inaccessible')
  assert.equal(failed.research_evidence.rows[0].attempts,2)
  assert.equal(failed.research_evidence.rows[0].previousVerifiedEvidence.contentExcerpt,row.contentExcerpt)
  await collectContentResearch(env,async()=>assert.fail('failed attempt cached'),{...queries(1),...failed},now+86401000)
})
test('35 lifetime attempts cannot be bypassed with a retry or new URLs',async()=>{
  const old=Array.from({length:35},(_,i)=>({...mention(i),status:'inaccessible',attempts:1,lastAttemptAt:'2026-10-20T00:00:00Z'}))
  const result=await collectContentResearch(env,async()=>assert.fail('budget exhausted'),{...queries(40),research_evidence:{rows:old}},now)
  assert.equal(result.research_status.rows[0].reason,'lifetime_attempt_limit')
  assert.equal(result.research_status.rows[0].urlsAttempted,0)
})
test('no credential, expired window and source error do not claim verified evidence',async()=>{
  const never=async()=>assert.fail('not allowed')
  assert.equal((await collectContentResearch({},never,queries(1),now)).research_status.rows[0].reason,'credential_unavailable')
  assert.equal((await collectContentResearch({...env,REFRESH_UNTIL:'2026-10-01'},never,queries(1),now)).research_status.rows[0].status,'expired')
  const sourceError=await collectContentResearch(env,async()=>Response.json({success:true,data:{markdown:'Elephant Goldfish Model access denied',metadata:{statusCode:403}}}),queries(1),now)
  assert.equal(sourceError.research_evidence.rows[0].status,'inaccessible')
  assert.equal(sourceError.research_evidence.rows[0].reason,'source_http_403')
})
test('daily global budget excludes new URLs until next UTC day',async()=>{
  const first=await collectContentResearch(env,provider,queries(5),now)
  const cached=await collectContentResearch(env,async()=>assert.fail('daily budget exhausted'),{...queries(10),...first},now+1000)
  assert.equal(cached.research_status.rows[0].status,'cached')
  assert.equal(cached.research_status.rows[0].dailyAttempts,5)
  assert.deepEqual(cached.research_evidence.source,first.research_evidence.source)
  const next=await collectContentResearch(env,provider,{...queries(10),...cached},now+86400000)
  assert.equal(next.research_status.rows[0].urlsAttempted,5)
  assert.equal(next.research_status.rows[0].dailyAttempts,5)
  assert.equal(next.research_status.rows[0].totalAttempts,10)
})
