import test from 'node:test'
import assert from 'node:assert/strict'
import {userActivity} from './user-activity.mjs'

const environment=()=>({POSTHOG_HOST:'https://us.i.posthog.com',POSTHOG_PROJECT_ID:'223560',POSTHOG_QUERY_KEY:'private-test-key'})
const users=[{id:'user_ABC'},{id:"user_bad' OR 1=1"},{id:'user_DEF'}]
test('activity reads one bounded project query, maps only dashboard identities and caches',async()=>{
  const env=environment(),lastSeen=new Date(Date.now()-60000).toISOString()
  let calls=0
  const fetcher=async(url,options)=>{
    calls++
    assert.equal(url,'https://us.posthog.com/api/projects/223560/query/')
    assert.equal(options.headers.authorization,'Bearer private-test-key')
    assert.equal(options.redirect,'manual')
    const query=JSON.parse(options.body).query
    assert.equal(query.kind,'HogQLQuery')
    assert.match(query.query,/timestamp >= now\(\) - INTERVAL 30 DAY/)
    assert.match(query.query,/LIMIT 200/)
    assert.doesNotMatch(query.query,/OR 1=1/)
    return Response.json({results:[['user_ABC',lastSeen,12,2,1],['user_other',lastSeen,90,9,8]]})
  }
  const result=await userActivity(env,users,fetcher)
  assert.equal(result.status,'available')
  assert.deepEqual(result.users,{user_ABC:{lastSeen,pageViews:12,activeDays:2,questions:1}})
  assert.equal(await userActivity(env,users,fetcher),result)
  assert.equal(calls,1)
  await userActivity(env,[...users,{id:'user_NEW'}],fetcher)
  assert.equal(calls,2)
})
test('missing configuration and untrusted hosts never send a credential',async()=>{
  for(const env of [{}, {...environment(),POSTHOG_HOST:'https://us.i.posthog.com.evil.test'}, {...environment(),POSTHOG_PROJECT_ID:'223560/elsewhere'}]) {
    assert.equal((await userActivity(env,users,()=>assert.fail('must not fetch'))).status,'unavailable')
  }
})
test('provider failures, partial and malformed results are unavailable rather than zero activity',async()=>{
  for(const fetcher of [async()=>{throw Error('offline')},async()=>new Response('',{status:403}),async()=>Response.json({results:[],hasMore:true}),async()=>Response.json({query_status:{complete:false},results:[]}),async()=>Response.json({results:[['user_ABC','not-a-date',1,1,1]]}),async()=>Response.json({results:[['user_ABC',new Date().toISOString(),-1,1,1]]})]) {
    assert.equal((await userActivity(environment(),users,fetcher)).status,'unavailable')
  }
  const empty=await userActivity(environment(),users,async()=>Response.json({results:[]}))
  assert.equal(empty.status,'available')
  assert.deepEqual(empty.users,{})
})
