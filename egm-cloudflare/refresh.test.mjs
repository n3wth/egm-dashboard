import test from 'node:test'
import assert from 'node:assert/strict'
import {refreshEnabled,refreshSnapshot} from './refresh.mjs'

test('standalone GitHub refresh requires an explicit continuation flag after paid expiry',async()=>{
  for(const REFRESH_UNTIL of [undefined,'invalid','2020-01-01']) {
    assert.equal(refreshEnabled({REFRESH_UNTIL,GITHUB_COLLECTION_ENABLED:'true'}),true)
    assert.equal(refreshEnabled({REFRESH_UNTIL,GITHUB_COLLECTION_ENABLED:true}),false)
    await assert.rejects(refreshSnapshot({REFRESH_UNTIL,GITHUB_COLLECTION_ENABLED:'true'},()=>assert.fail('no credential')),/GitHub credential unavailable/)
  }
})
import {readFile} from 'node:fs/promises'
import seed from '../egm-performance/src/data.json' with {type:'json'}
const root=new URL('./test-fixtures/',import.meta.url)
const load=async name=>JSON.parse(await readFile(new URL(name+'.json',root),'utf8'))
test('seven-day cutoff disables refresh without reading sources or writing',async()=>{
  assert.equal(refreshEnabled({REFRESH_UNTIL:'2026-11-04T06:33:01Z'},Date.parse('2026-11-04T06:33:01Z')),false)
  assert.equal(refreshEnabled({REFRESH_UNTIL:'invalid'}),false)
  assert.deepEqual(await refreshSnapshot({REFRESH_UNTIL:'2020-01-01'},()=>{throw Error('must not fetch')}),{status:'expired'})
})
test('a source error retains the previous snapshot',async()=>{
  const env={REFRESH_UNTIL:'2099-01-01',GITHUB_TOKEN:'test',DB:{prepare(){throw Error('must not write')}}}
  await assert.rejects(refreshSnapshot(env,async()=>new Response('{}',{status:403})),/GitHub source failed/)
})
test('complete refresh reconciles traffic and writes once with fresh provenance',async()=>{
  const names={ '':'repo','/traffic/views':'views','/traffic/clones':'clones','/traffic/popular/referrers':'referrers','/traffic/popular/paths':'paths','/issues':'issues','/pulls':'pulls','/releases':'releases','/pages':'pages','/commits':'commits'}
  let writes=0,saved,readFailure=false
  const repo=await load('repo')
  const env={REFRESH_UNTIL:'2099-01-01',GITHUB_TOKEN:'test',DB:{prepare(){return {async first(){if(readFailure)throw Error('history unavailable');return {body:JSON.stringify({githubHistory:{daily:{traffic:[{date:'2026-09-01',views:7}]},windows:[]}})}},bind(body){saved=JSON.parse(body);return {async run(){writes++}}}}}}}
  let emptyReferrers=false
  const request=async url=>{
    const u=new URL(url),path=u.pathname.replace('/repos/google/elephant-goldfish-model','')
    const page=Number(u.searchParams.get('page')??1)
    let data
    if(path==='/traffic/popular/referrers' && emptyReferrers) data=[]
    else if(path==='/stargazers') data=Array.from({length:repo.stargazers_count},()=>({starred_at:'2026-10-27T00:00:00Z'})).slice((page-1)*100,page*100)
    else {data=await load(names[path]);if(['issues','pulls','releases','commits'].includes(names[path])) data=data.slice((page-1)*100,page*100)}
    return Response.json(data)
  }
  const result=await refreshSnapshot(env,request,async()=>({}))
  assert.equal(writes,1)
  assert.equal(saved.githubHistory.daily.traffic[0].date,'2026-09-01','standalone writes retain the existing archive too')
  assert.equal(result.status,'refreshed')
  assert.equal(saved.queries.traffic.rows.reduce((s,r)=>s+r.views,0),saved.queries.reach.rows[0].views)
  assert.equal(saved.queries.star_history.rows.at(-1).stars,repo.stargazers_count)
  assert.equal(saved.queries.reach.source.executedAt,saved.generatedAt)
  assert.equal(saved.id,'dashboard:92f69d5e-0c66-4fc5-be7d-2e5465004e2f')
  const staged=await refreshSnapshot(env,request,async()=>({}),{persist:false})
  assert.equal(writes,1)
  assert.equal(staged.snapshot.queries.reach.source.executedAt,staged.snapshot.generatedAt)
  assert.deepEqual(staged.snapshot.queries.traffic.rows,saved.queries.traffic.rows)
  for(const id of ['mentions','exa_mentions','research_evidence','youtube_videos','seo_backlinks']) {
    if(!seed.queries[id])continue
    assert.deepEqual(staged.snapshot.queries[id].source,seed.queries[id].source,'GitHub must not restamp '+id)
  }
  emptyReferrers=true
  const empty=await refreshSnapshot(env,request,async()=>({}),{persist:false})
  assert.deepEqual(empty.snapshot.queries.referrers.rows,[])
  assert.equal(empty.snapshot.queries.website.rows[0].referralViews,null)
  readFailure=true
  await assert.rejects(refreshSnapshot(env,request,async()=>({})),/history unavailable/)
  assert.equal(writes,1,'do not overwrite stored history when the historical read fails')
})

test('bounded or failed stargazer collection preserves dated history while traffic and total stars refresh',async()=>{
  const names={'':'repo','/traffic/views':'views','/traffic/clones':'clones','/traffic/popular/referrers':'referrers','/traffic/popular/paths':'paths','/issues':'issues','/pulls':'pulls','/releases':'releases','/pages':'pages','/commits':'commits'}
  const oldHistory={rows:[{date:'2026-10-20',stars:100,newStars:1}],source:{executedAt:'2026-10-20T12:00:00Z',coverage:{startDate:'2026-10-19',endDate:'2026-10-20'},caveats:['Original observation']}}
  const priorHistory=Array.from({length:337},(_,i)=>({observedAt:new Date(Date.parse('2026-10-10T00:00:00Z')+i*1800000).toISOString(),referralViews:i,referralVisitors:i}))
  for(const total of [300000,10001,10000,3500]) {
    let starCalls=0,repoCalls=0,writes=0
    const env={REFRESH_UNTIL:'2099-01-01',GITHUB_TOKEN:'test',DB:{prepare(){return {async first(){return {body:JSON.stringify({queries:{star_history:oldHistory,website_referral_history:{rows:priorHistory}}})}},bind(){return {async run(){writes++}}}}}}}
    const result=await refreshSnapshot(env,async url=>{
      const u=new URL(url),path=u.pathname.replace('/repos/google/elephant-goldfish-model',''),page=Number(u.searchParams.get('page')??1)
      if(path==='/stargazers'){starCalls++;return new Response('{}',{status:403})}
      let value=await load(names[path])
      if(path===''){repoCalls++;value={...value,stargazers_count:total}}
      if(['issues','pulls','releases','commits'].includes(names[path]))value=value.slice((page-1)*100,page*100)
      return Response.json(value)
    },async()=>({}),{persist:false})
    const data=result.snapshot
    assert.equal(result.status,'refreshed')
    assert.equal(result.starHistoryStatus,'stale')
    assert.equal(starCalls,total>=10000?0:1)
    assert.equal(repoCalls,1,'observed totals reuse the repository request')
    assert.equal(data.queries.reach.rows[0].stars,total)
    assert.equal(data.queries.star_observations.rows.length,1,'reconstructed history does not become observed totals')
    assert.equal(data.queries.star_observations.rows[0].stars,total)
    assert.equal(data.queries.star_observations.source.executedAt,data.generatedAt)
    assert.equal(data.queries.reach.source.executedAt,data.generatedAt)
    assert.deepEqual(data.queries.star_history.rows,oldHistory.rows)
    assert.equal(data.queries.star_history.source.executedAt,oldHistory.source.executedAt)
    assert.deepEqual(data.queries.star_history.source.coverage,oldHistory.source.coverage)
    assert.match(data.queries.star_history.source.caveats.at(-1),/history is stale/)
    assert.equal(data.queries.website_referral_history.rows.length,336)
    assert.equal(data.queries.website_referral_history.rows.at(-1).observedAt,data.generatedAt)
    assert.match(data.queries.website_referral_history.source.metricDefinitions[0].definition,/not daily traffic/)
    assert.equal(writes,0)
  }
})
