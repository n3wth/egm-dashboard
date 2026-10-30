import test from 'node:test'
import assert from 'node:assert/strict'
import {cachedSiteIcon,validSiteHost} from './favicon-cache.mjs'
const origin='https://egm.n3wth.com'
const icon=()=>new Response(new Uint8Array([137,80,78,71,13,10,26,10,1]),{headers:{'content-type':'image/png'}})
function cache(){const saved=new Map();return {async match(request){return saved.get(request.url)?.clone()},async put(request,response){saved.set(request.url,response.clone())}}}
test('invalid, private, protocol and unknown hosts are rejected without fetch',async()=>{
  for(const host of ['127.0.0.1','[::1]','localhost','metadata.google.internal','https://github.com','github.com:443','x.local','x.invalid','unknown.org']) {
    const result=await cachedSiteIcon(new Request(origin+'/api/site-icon?host='+encodeURIComponent(host)),{}, {snapshot:{},request:async()=>assert.fail('must not fetch')})
    assert.ok([400,404].includes(result.status))
  }
  assert.equal(validSiteHost('2130706433'),null)
})
test('known icons use fixed redirect-disabled upstream and cached private responses',async()=>{
  let calls=0
  const options={cache:cache(),request:async(url,init)=>{calls++;assert.equal(new URL(url).origin,'https://favicon.vemetric.com');assert.equal(new URL(url).pathname,'/github.com');assert.equal(new URL(url).searchParams.get('format'),'png');assert.equal(init.redirect,'manual');return icon()}}
  const request=new Request(origin+'/api/site-icon?host=github.com')
  const first=await cachedSiteIcon(request,{},options)
  assert.equal(first.status,200)
  assert.equal(first.headers.get('cache-control'),'private, max-age=604800')
  assert.equal((await cachedSiteIcon(request,{},options)).status,200)
  assert.equal(calls,1)
})
test('cache failures do not prevent icon delivery or the upstream fallback',async()=>{
  const request=new Request(origin+'/api/site-icon?host=github.com')
  for(const failure of ['match','put']) {
    for(const upstream of [icon,()=>{throw Error('upstream unavailable')}]) {
      const store={async match(){if(failure==='match')throw Error('cache unavailable');return null},async put(){if(failure==='put')throw Error('cache unavailable')}}
      const result=await cachedSiteIcon(request,{}, {cache:store,request:async()=>upstream()})
      assert.equal(result.status,upstream===icon?200:204)
      assert.match(result.headers.get('cache-control'),/^private, max-age=/)
    }
  }
})
test('snapshot URLs permit relevant public publishers',async()=>{
  const result=await cachedSiteIcon(new Request(origin+'/api/site-icon?host=publisher.org'),{}, {snapshot:{queries:{mentions:{rows:[{url:'https://publisher.org/egm'}]}}},cache:cache(),request:async()=>icon()})
  assert.equal(result.status,200)
})
test('versioned key bypasses previously cached empty provider icons',async()=>{
  const stored=cache()
  await stored.put(new Request(origin+'/api/site-icon?v=4&host=exa.ai'),new Response(null,{status:204}))
  let calls=0
  const result=await cachedSiteIcon(new Request(origin+'/api/site-icon?v=3&host=exa.ai'),{}, {cache:stored,request:async()=>{calls++;return icon()}})
  assert.equal(result.status,200)
  assert.equal(calls,1)
})
test('bad MIME, oversized bodies and upstream failures cache fallback without repeated fetch',async()=>{
  for(const upstream of [()=>new Response('<svg/>',{headers:{'content-type':'image/svg+xml'}}),()=>new Response(new Uint8Array(32769),{headers:{'content-type':'image/png'}}),()=>{throw Error('network')}]) {
    let calls=0
    const options={cache:cache(),request:async()=>{calls++;return upstream()}}
    const request=new Request(origin+'/api/site-icon?host=google.com')
    const fallback=await cachedSiteIcon(request,{},options)
    assert.equal(fallback.status,204)
    assert.equal(fallback.headers.get('cache-control'),'private, max-age=300')
    assert.equal(fallback.headers.get('x-icon-error'),null)
    assert.equal(fallback.headers.get('x-icon-upstream-status'),null)
    assert.equal((await cachedSiteIcon(request,{},options)).status,204)
    assert.equal(calls,1)
  }
})

test('redirects are inspected manually and never followed or cached as success',async()=>{
  for(const status of [301,302,307,308]) {
    let calls=0
    const stored=cache()
    const result=await cachedSiteIcon(new Request(origin+'/api/site-icon?v=5&host=github.com'),{}, {cache:stored,request:async(url,init)=>{
      calls++
      assert.equal(init.redirect,'manual')
      assert.equal(new URL(url).origin,'https://favicon.vemetric.com')
      return new Response(null,{status,headers:{location:'https://other.example/icon.png'}})
    }})
    assert.equal(calls,1)
    assert.equal(result.status,204)
    assert.equal(result.headers.get('cache-control'),'private, max-age=300')
    const cached=await stored.match(new Request(origin+'/api/site-icon?v=5&host=github.com'))
    assert.equal(cached.headers.get('cache-control'),'public, max-age=300')
    assert.equal(result.headers.get('x-icon-error'),null)
    assert.equal(result.headers.get('x-icon-upstream-status'),null)
  }
})
