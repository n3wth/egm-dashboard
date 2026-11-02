import test from 'node:test'
import assert from 'node:assert/strict'
import {handle,seal} from './worker.mjs'

const secret='a'.repeat(64)
const hashed='/assets/index-DG-E-lQ-.js'
async function fixture() {
  const token=await seal({sid:'session'},secret,'session')
  const user={id:'viewer',email:'viewer@example.com',verified:1,status:'approved'}
  const reads=[]
  const files={
    [hashed]:['text/javascript; charset=utf-8',200],
    '/assets/style-_3lr_CiF.css':['text/css',200],
    '/assets/font-ABCD1234.woff2':['font/woff2',200],
    '/assets/icon-ABCD1234.svg':['image/svg+xml',200],
    '/assets/image-ABCD1234.png':['image/png',200],
    '/assets/module-ABCD1234.wasm':['application/wasm',200],
    '/index.html':['text/html',200],
    '/snapshot.data.json':['application/json',200],
    '/assets/index.js':['text/javascript',200],
    '/assets/fallback-AAAAAAAA.js':['text/html',200],
    '/assets/mismatch-AAAAAAAA.js':['application/json',200],
    '/assets/error-AAAAAAAA.js':['text/javascript',503]
  }
  const env={APP_URL:'https://dashboard.example',SESSION_SECRET:secret,DB:{prepare(){return {bind(){return {async first(){return env.user}}}}}},user,ASSETS:{async fetch(request){
    const path=new URL(request.url).pathname
    reads.push(path)
    const [type,status]=files[path]??['text/plain',404]
    return new Response('asset',{status,headers:{'content-type':type,etag:'"asset-version"'}})
  }}}
  return {env,reads,read:(path,headers={cookie:'__Host-egm_session='+token},method='GET')=>handle(new Request(env.APP_URL+path,{headers,method}),env)}
}

test('approved users cache only successful content-hashed assets with matching media types',async()=>{
  const f=await fixture()
  const rewriter=globalThis.HTMLRewriter
  globalThis.HTMLRewriter=class {on(){return this}transform(response){return response}}
  try {
    for(const path of [hashed,'/assets/style-_3lr_CiF.css','/assets/font-ABCD1234.woff2','/assets/icon-ABCD1234.svg','/assets/image-ABCD1234.png','/assets/module-ABCD1234.wasm']) {
      const response=await f.read(path)
      assert.equal(response.status,200,path)
      assert.equal(response.headers.get('cache-control'),'private, max-age=31536000, immutable',path)
      assert.equal(response.headers.get('etag'),'"asset-version"')
      assert.equal(response.headers.get('x-content-type-options'),'nosniff')
    }
    for(const path of ['/overview','/index.html','/snapshot.data.json','/assets/index.js','/assets/fallback-AAAAAAAA.js','/assets/mismatch-AAAAAAAA.js','/assets/missing-AAAAAAAA.js','/assets/error-AAAAAAAA.js','/api/missing']) {
      const response=await f.read(path)
      assert.equal(response.headers.get('cache-control'),'private, no-store',path)
    }
    assert.equal((await f.read('/assets/missing-AAAAAAAA.js')).status,404)
    assert.equal((await f.read(hashed,undefined,'HEAD')).headers.get('cache-control'),'private, max-age=31536000, immutable')
  } finally {globalThis.HTMLRewriter=rewriter}
})

test('anonymous, pending, denied and revoked sessions cannot read hashed assets',async()=>{
  const f=await fixture()
  assert.equal((await f.read(hashed,{})).status,401)
  for(const status of ['pending','denied']) {
    f.env.user={...f.env.user,status}
    const response=await f.read(hashed)
    assert.equal(response.status,403)
    assert.equal(response.headers.get('cache-control'),'private, no-store')
  }
  f.env.user=null
  const revoked=await f.read(hashed)
  assert.equal(revoked.status,401)
  assert.equal(revoked.headers.get('cache-control'),'private, no-store')
  assert.deepEqual(f.reads,[],'authorization completes before any private asset is fetched')
})
