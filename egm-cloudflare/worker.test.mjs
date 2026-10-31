import test from 'node:test'
import assert from 'node:assert/strict'
import {seal,open,handle,profilePhoto} from './worker.mjs'
const secret='a'.repeat(64)
test('oversized presentation requests are rejected before a write',async()=>{
  const token=await seal({sid:'owner'},secret,'session')
  const env={APP_URL:'https://egm.n3wth.com',OWNER_EMAIL:'owner@example.org',SESSION_SECRET:secret,DB:{prepare(sql){assert.match(sql,/SELECT users/);return {bind(){return {first:async()=>({id:'owner',email:'owner@example.org',verified:1,status:'approved'})}}}}}}
  const body=new ReadableStream({start(controller){controller.enqueue(new Uint8Array(130001));controller.close()}})
  const request=new Request(env.APP_URL+'/api/presentation',{method:'PUT',headers:{cookie:'__Host-egm_session='+token,origin:env.APP_URL,'content-type':'application/json'},body,duplex:'half'})
  assert.equal((await handle(request,env)).status,413)
})
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
test('outline email marks are public png assets',async()=>{
  const seen=[]
  const env={APP_URL:'https://egm.n3wth.com',SESSION_SECRET:secret,ASSETS:{fetch(request){seen.push(new URL(request.url).pathname);return new Response('png',{headers:{'content-type':'image/png'}})}}}
  for(const path of ['/email/egm-mark-black.png','/email/egm-mark-white.png']){
    const response=await handle(new Request(env.APP_URL+path),env)
    assert.equal(response.status,200,path)
    assert.equal(response.headers.get('content-type'),'image/png',path)
  }
  assert.deepEqual(seen,['/email/egm-mark-black.png','/email/egm-mark-white.png'])
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
test('the old growth advice links land on Overview', async () => {
  const env={APP_URL:'https://egm.n3wth.com',SESSION_SECRET:secret}
  for (const path of ['/growth','/reach','/?tab=growth','/?tab=reach']) {
    const redirect=await handle(new Request(env.APP_URL+path),env)
    assert.equal(redirect.status,302,path)
    assert.equal(new URL(redirect.headers.get('location'),env.APP_URL).pathname,'/overview',path)
  }
  const kept=await handle(new Request(env.APP_URL+'/?tab=website'),env)
  assert.equal(new URL(kept.headers.get('location'),env.APP_URL).pathname,'/website')
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
test('unknown browser routes get an HTML 404 and API paths keep JSON',async()=>{
  const token=await seal({sid:'s'},secret,'session')
  const env={APP_URL:'https://egm.n3wth.com',SESSION_SECRET:secret,DB:{prepare(){return {bind(){return {first:async()=>({id:'u',email:'a@example.com',verified:1,status:'approved'})}}}}},ASSETS:{fetch(){throw Error('must not read')}}}
  for(const headers of [{},{cookie:'__Host-egm_session='+token}]) {
    const page=await handle(new Request(env.APP_URL+'/no-such-page',{headers}),env)
    assert.equal(page.status,404)
    assert.match(page.headers.get('content-type'),/^text\/html/)
    assert.equal(page.headers.get('cache-control'),'private, no-store')
    assert.match(await page.text(),/Page not found/)
  }
  const api=await handle(new Request(env.APP_URL+'/api/nope',{headers:{cookie:'__Host-egm_session='+token}}),env)
  assert.equal(api.status,404)
  assert.deepEqual(await api.json(),{error:'not_found'})
  assert.equal((await handle(new Request(env.APP_URL+'/api/nope'),env)).status,401)
})
test('a session cookie without a live session shows the session ended page',async()=>{
  const token=await seal({sid:'gone'},secret,'session')
  const env={APP_URL:'https://egm.n3wth.com',SESSION_SECRET:secret,DB:{prepare(){return {bind(){return {first:async()=>null}}}}}}
  const response=await handle(new Request(env.APP_URL+'/overview',{headers:{cookie:'__Host-egm_session='+token}}),env)
  assert.equal(response.status,401)
  assert.match(await response.text(),/Your session ended/)
})
test('a session cookie sealed with the previous secret still shows the session ended page',async()=>{
  const previous='b'.repeat(64)
  const token=await seal({sid:'gone'},previous,'session')
  const env={APP_URL:'https://egm.n3wth.com',SESSION_SECRET:secret,SESSION_SECRET_PREVIOUS:previous,DB:{prepare(){return {bind(){return {first:async()=>null}}}}}}
  const response=await handle(new Request(env.APP_URL+'/overview',{headers:{cookie:'__Host-egm_session='+token}}),env)
  assert.equal(response.status,401)
  assert.match(await response.text(),/Your session ended/)
})
test('sign-in callback failures render pages instead of plain text',async()=>{
  const env={APP_URL:'https://egm.n3wth.com',SESSION_SECRET:secret,WORKOS_CLIENT_ID:'client'}
  const flow=await seal({verifier:'v',state:'good'},secret,'login',600)
  const get=(query,cookie=flow)=>handle(new Request(env.APP_URL+'/auth/callback?'+query,{headers:cookie?{cookie:'__Host-egm_flow='+cookie}:{}}),env)
  const cancelled=await get('error=access_denied&state=good')
  assert.equal(cancelled.status,401)
  assert.match(await cancelled.text(),/Sign-in cancelled/)
  for(const response of [await get('code=x&state=bad'),await get('code=x&state=good',null),await get('error=access_denied&state=bad')]) {
    assert.equal(response.status,400)
    assert.match(response.headers.get('set-cookie'),/__Host-egm_flow=;/)
    assert.match(await response.text(),/Sign-in expired/)
  }
  const priorFetch=globalThis.fetch
  try {
    for(const [status,title,expected] of [[429,'Too many attempts',429],[502,'Something went wrong',503],[400,'Sign-in did not complete',401]]) {
      globalThis.fetch=async()=>new Response('{}',{status})
      const response=await get('code=x&state=good')
      assert.equal(response.status,expected)
      const html=await response.text()
      assert.match(html,new RegExp(title))
      assert.match(html,/href="\/auth\/login"/)
    }
  } finally { globalThis.fetch=priorFetch }
})
test('internal failures return the unavailable page for navigations only',async()=>{
  const env={APP_URL:'https://egm.n3wth.com',SESSION_SECRET:'short'}
  const page=await handle(new Request(env.APP_URL+'/overview'),env)
  assert.equal(page.status,503)
  assert.match(await page.text(),/Something went wrong/)
  const api=await handle(new Request(env.APP_URL+'/api/snapshot'),env)
  assert.equal(api.status,503)
  assert.doesNotMatch(await api.text(),/<html/)
})
test('signed-out HTML deep links show sign-in while data requests keep JSON 401',async()=>{
  const env={APP_URL:'https://egm.n3wth.com',SESSION_SECRET:secret}
  const link=env.APP_URL+'/_data/charts/abc'
  const page=await handle(new Request(link,{headers:{accept:'text/html,*/*'}}),env)
  assert.equal(page.status,200)
  assert.match(await page.text(),/Continue with Google/)
  assert.equal((await handle(new Request(link,{headers:{accept:'application/json'}}),env)).status,401)
})
test('a storage failure during sign-in shows the unavailable page with a retry that restarts sign-in',async()=>{
  const flow=await seal({verifier:'v',state:'good'},secret,'login',600)
  const env={APP_URL:'https://egm.n3wth.com',SESSION_SECRET:secret,WORKOS_CLIENT_ID:'client',DB:{prepare(){throw Error('d1 down')}}}
  const priorFetch=globalThis.fetch
  try {
    globalThis.fetch=async()=>Response.json({user:{id:'u',email:'a@example.com',email_verified:true}})
    const response=await (await import('./worker.mjs')).default.fetch(new Request(env.APP_URL+'/auth/callback?code=x&state=good',{headers:{cookie:'__Host-egm_flow='+flow}}),env,{})
    assert.equal(response.status,503)
    const html=await response.text()
    assert.match(html,/href="\/auth\/login" class="action">Try again/)
    assert.doesNotMatch(html,/d1 down/)
  } finally { globalThis.fetch=priorFetch }
})
