import test from 'node:test'
import assert from 'node:assert/strict'
import {seal,open,handle,profilePhoto} from './worker.mjs'
const secret='a'.repeat(64)
test('pending badge endpoint and live connection require an approved admin and same origin',async()=>{
  const env={APP_URL:'https://egm.n3wth.com',OWNER_EMAIL:'oliver@newth.ai',SESSION_SECRET:secret}
  let user={id:'owner',email:env.OWNER_EMAIL,verified:1,status:'approved'}
  env.DB={prepare(sql){return sql.includes('EXISTS')?{first:async()=>({pending:1})}:{bind(){return {first:async()=>user}}}}}
  const token=await seal({sid:'session'},secret,'session')
  const headers={cookie:'__Host-egm_session='+token}
  const read=()=>handle(new Request(env.APP_URL+'/api/access-pending',{headers}),env)
  assert.deepEqual(await (await read()).json(),{pending:true})
  const socket=(origin)=>handle(new Request(env.APP_URL+'/api/access-live',{headers:{...headers,origin,upgrade:'websocket'}}),env)
  assert.equal((await socket('https://evil.example')).status,400)
  user={...user,email:'guest@example.com'}
  assert.equal((await read()).status,403)
  assert.equal((await socket(env.APP_URL)).status,403)
})
test('WorkOS avatar accepts exact HTTPS CDN only',()=>{
  assert.equal(profilePhoto('https://workoscdn.com/images/v1/photo'),'https://workoscdn.com/images/v1/photo')
  for(const value of ['http://workoscdn.com/photo','https://workoscdn.com.evil.example/photo','https://user:pass@workoscdn.com/photo','https://workoscdn.com:444/photo','data:image/png;base64,AA',null])assert.equal(profilePhoto(value),null)
})
test('authenticated viewer photo comes only from the signed session and legacy sessions fall back',async()=>{
  for(const photo of [undefined,'https://workoscdn.com/images/v1/photo','https://evil.example/photo']) {
    const token=await seal({sid:'owner',profilePictureUrl:photo},secret,'session')
    const env={APP_URL:'https://egm.n3wth.com',OWNER_EMAIL:'oliver@newth.ai',SESSION_SECRET:secret,DB:{prepare(sql){return {bind(){return {first:async()=>({id:'owner',email:'oliver@newth.ai',name:'Oliver',verified:1,status:'approved'})}},first:async()=>({body:'{}',revision:0})}}}}
    const response=await handle(new Request(env.APP_URL+'/api/presentation',{headers:{cookie:'__Host-egm_session='+token}}),env)
    const data=await response.json()
    assert.equal(data.viewer.profilePictureUrl,profilePhoto(photo))
  }
})
test('session token is bound to key, audience, expiry, and signature',async()=>{
  const token=await seal({sid:'session'},secret,'session')
  assert.equal((await open(token,secret,'session')).sid,'session')
  assert.equal(await open(token,secret,'login'),null)
  assert.equal(await open(token,'b'.repeat(64),'session'),null)
  assert.equal(await open(token+'x',secret,'session'),null)
  assert.equal(await open(await seal({},secret,'session',-1),secret,'session'),null)
})
test('anonymous requests cannot access html, data, APIs, or approval tools',async()=>{
  let assetReads=0
  const env={APP_URL:'https://egm.n3wth.com',SESSION_SECRET:secret,ASSETS:{fetch(){assetReads++;return new Response('private')}}}
  for(const path of ['/index.html','/snapshot.data.json','/api/snapshot','/mcp']){
    const response=await handle(new Request(env.APP_URL+path),env)
    assert.equal(response.status,401,path)
  }
  const response=await handle(new Request(env.APP_URL),env)
  assert.equal(response.status,200)
  assert.equal(assetReads,0)
  assert.match(await response.text(),/Continue with Google/)
})
test('pending users cannot read private assets',async()=>{
  const token=await seal({sid:'pending-session'},secret,'session')
  const env={APP_URL:'https://egm.n3wth.com',SESSION_SECRET:secret,DB:{prepare(){return {bind(){return {first:async()=>({id:'user',email:'test@example.com',status:'pending'})}}}}},ASSETS:{fetch(){throw Error('must not read')}}}
  const response=await handle(new Request(env.APP_URL+'/index.html',{headers:{cookie:'__Host-egm_session='+token}}),env)
  assert.equal(response.status,403)
})
test('spoofed identity headers do not authorize asset reads',async()=>{
  const env={APP_URL:'https://egm.n3wth.com',SESSION_SECRET:secret}
  const response=await handle(new Request(env.APP_URL+'/index.html',{headers:{'oai-authenticated-user-email':'oliver@newth.ai'}}),env)
  assert.equal(response.status,401)
})
test('approved guests cannot publish even with a valid session',async()=>{
  const token=await seal({sid:'guest'},secret,'session')
  const env={APP_URL:'https://egm.n3wth.com',OWNER_EMAIL:'oliver@newth.ai',SESSION_SECRET:secret,DB:{prepare(){return {bind(){return {first:async()=>({email:'guest@example.com',verified:1,status:'approved'})}}}}}}
  const response=await handle(new Request(env.APP_URL+'/api/presentation',{method:'PUT',headers:{cookie:'__Host-egm_session='+token,origin:env.APP_URL,'content-type':'application/json'},body:'{}'}),env)
  assert.equal(response.status,403)
})
test('owner publishing rejects cross-origin requests',async()=>{
  const token=await seal({sid:'owner'},secret,'session')
  const env={APP_URL:'https://egm.n3wth.com',OWNER_EMAIL:'oliver@newth.ai',SESSION_SECRET:secret,DB:{prepare(){return {bind(){return {first:async()=>({email:'oliver@newth.ai',verified:1,status:'approved'})}}}}}}
  const response=await handle(new Request(env.APP_URL+'/api/presentation',{method:'PUT',headers:{cookie:'__Host-egm_session='+token,origin:'https://example.com','content-type':'application/json'},body:'{}'}),env)
  assert.equal(response.status,403)
})
test('logout revokes the server session and expires the cookie',async()=>{
  const token=await seal({sid:'logout-session'},secret,'session')
  let revoked
  const env={APP_URL:'https://egm.n3wth.com',SESSION_SECRET:secret,DB:{prepare(sql){assert.match(sql,/DELETE FROM sessions/);return {bind(sid){revoked=sid;return {run:async()=>({})}}}}}}
  const response=await handle(new Request(env.APP_URL+'/auth/logout',{method:'POST',headers:{cookie:'__Host-egm_session='+token,origin:env.APP_URL}}),env)
  assert.equal(response.status,303)
  assert.equal(revoked,'logout-session')
  assert.match(response.headers.get('set-cookie'),/__Host-egm_session=;.*Max-Age=0/)
  assert.equal((await handle(new Request(env.APP_URL+'/auth/logout'),env)).status,405)
  assert.equal((await handle(new Request(env.APP_URL+'/auth/logout',{method:'POST',headers:{origin:'https://example.com'}}),env)).status,403)
})
