import test from 'node:test'
import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {manageAccess} from './access-management.mjs'

const owner={id:'owner',email:'owner@example.org',verified:1,status:'approved'}
function environment() {
  const db=new DatabaseSync(':memory:')
  db.exec('CREATE TABLE users(id TEXT,name TEXT,email TEXT,status TEXT,created_at TEXT,decided_at TEXT,decided_by TEXT);CREATE TABLE audit(id TEXT,user_id TEXT,action TEXT,actor TEXT,created_at TEXT)')
  db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?,?)').run('pending','Guest','guest@example.org','pending','2026-10-28',null,null)
  return {APP_URL:'https://egm.n3wth.com',OWNER_EMAIL:owner.email,db,DB:{prepare(sql){return {bind(...args){return {async run(){const result=db.prepare(sql).run(...args);return {meta:{changes:Number(result.changes)}}},sql,args}},async all(){return {results:db.prepare(sql).all()}}}},async batch(statements){return statements.map(({sql,args})=>({meta:{changes:Number(db.prepare(sql).run(...args).changes)}}))}}}
}
const request=(body,origin='https://egm.n3wth.com')=>new Request('https://egm.n3wth.com/api/access',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)})
test('oversized streamed access requests are rejected before any mutation',async()=>{
  const env=environment()
  const body=new ReadableStream({start(controller){controller.enqueue(new Uint8Array(2049));controller.close()}})
  const req=new Request(env.APP_URL+'/api/access',{method:'POST',headers:{origin:env.APP_URL,'content-type':'application/json'},body,duplex:'half'})
  assert.equal((await manageAccess(req,env,owner)).status,413)
  assert.equal(env.db.prepare('SELECT status FROM users').get().status,'pending')
  assert.equal(env.db.prepare('SELECT count(*) AS count FROM audit').get().count,0)
})
test('owner-only endpoint rejects other identities and cross-origin writes without DB changes',async()=>{
  const env=environment()
  for(const user of [null,{...owner,email:'guest@example.org'},{...owner,verified:0},{...owner,status:'pending'}])assert.equal((await manageAccess(new Request(env.APP_URL+'/api/access'),env,user)).status,403)
  assert.equal((await manageAccess(request({id:'pending',decision:'approved'},'https://evil.example'),env,owner)).status,403)
  assert.equal(env.db.prepare('SELECT status FROM users').get().status,'pending')
})
test('pending approval is audited once, cannot be repeated or mutate owner; invite is only a share URL',async()=>{
  const env=environment()
  const list=await (await manageAccess(new Request(env.APP_URL+'/api/access'),env,owner)).json()
  assert.equal(list.shareUrl,env.APP_URL+'/overview')
  assert.equal(list.users.length,1)
  assert.equal((await manageAccess(request({id:'pending',decision:'approved'}),env,owner)).status,200)
  assert.equal((await manageAccess(request({id:'pending',decision:'denied'}),env,owner)).status,409)
  assert.equal(env.db.prepare('SELECT count(*) AS count FROM audit').get().count,1)
  assert.equal(env.db.prepare('SELECT status FROM users').get().status,'approved')
  assert.equal((await manageAccess(request({id:'owner',decision:'denied'}),env,owner)).status,400)
})
test('RBAC mode requires verified dashboard administration permission, including for the owner',async()=>{
  const env={...environment(),WORKOS_RBAC_ENABLED:'true'}
  env.db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?,?)').run(owner.id,'Owner',owner.email,'approved','2026-10-28',null,null)
  const read=new Request(env.APP_URL+'/api/access')
  assert.equal((await manageAccess(read,env,owner)).status,403)
  assert.equal((await manageAccess(read,env,{...owner,canManageAccess:true})).status,200)
  assert.equal((await manageAccess(read,env,{...owner,email:'other@example.org',canManageAccess:true})).status,200)
  assert.equal((await manageAccess(read,env,{...owner,verified:0,canManageAccess:true})).status,403)
  assert.equal((await manageAccess(read,env,{...owner,status:'pending',canManageAccess:true})).status,403)
  const otherAdmin={...owner,id:'admin',email:'admin@example.org',canManageAccess:true}
  assert.equal((await (await manageAccess(read,env,otherAdmin)).json()).ownerId,owner.id)
  assert.equal((await manageAccess(request({id:owner.id,decision:'denied'}),env,otherAdmin)).status,409)
})
test('user photos are bounded, limited to dashboard identities and validated',async()=>{
  const env={...environment(),WORKOS_API_KEY:'test-key'}
  env.db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?,?)').run('user_owner','Owner',owner.email,'approved','2026-10-28',null,null)
  const calls=[]
  const fetcher=async(url,options)=>{
    calls.push({url,options})
    return Response.json({data:[{id:'user_owner',profile_picture_url:'https://workoscdn.com/images/owner'},{id:'pending',profile_picture_url:'https://workoscdn.com.evil.example/p'},{id:'user_other',profile_picture_url:'https://workoscdn.com/images/other'}],list_metadata:{after:'another-page'}})
  }
  const result=await (await manageAccess(new Request(env.APP_URL+'/api/access'),env,{...owner,id:'user_owner'},fetcher)).json()
  assert.equal(calls.length,2)
  assert.equal(calls[0].options.redirect,'manual')
  assert.equal(result.users.find(user=>user.id==='user_owner').profilePictureUrl,'https://workoscdn.com/images/owner')
  assert.equal(result.users.find(user=>user.id==='pending').profilePictureUrl,null)
  assert.equal(result.users.some(user=>user.id==='user_other'),false)
})
test('redirects from the photo provider are not followed',async()=>{
  const env={...environment(),WORKOS_API_KEY:'test-key'}
  let calls=0
  const result=await (await manageAccess(new Request(env.APP_URL+'/api/access'),env,owner,async(_url,options)=>{
    calls++
    assert.equal(options.redirect,'manual')
    return new Response(null,{status:302,headers:{location:'https://other.example/'}})
  })).json()
  assert.equal(calls,1)
  assert.equal(result.users[0].profilePictureUrl,null)
})
test('provider outage preserves dashboard users and verified viewer photo',async()=>{
  const env={...environment(),WORKOS_API_KEY:'test-key'}
  env.db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?,?)').run('user_owner','Owner',owner.email,'approved','2026-10-28',null,null)
  const response=await manageAccess(new Request(env.APP_URL+'/api/access'),env,{...owner,id:'user_owner',profilePictureUrl:'https://workoscdn.com/images/owner'},async()=>{throw Error('unavailable')})
  assert.equal(response.status,200)
  const result=await response.json()
  assert.equal(result.users.find(user=>user.id==='user_owner').profilePictureUrl,'https://workoscdn.com/images/owner')
})
test('admin user-list photo lookups reuse a bounded cache and refresh when users change',async()=>{
  const env={...environment(),WORKOS_API_KEY:'test-key'}
  let calls=0
  const fetcher=async()=>{calls++;return Response.json({data:[{id:'pending',profile_picture_url:'https://workoscdn.com/images/pending'}],list_metadata:{after:null}})}
  const read=()=>manageAccess(new Request(env.APP_URL+'/api/access'),env,owner,fetcher)
  assert.equal((await (await read()).json()).users[0].profilePictureUrl,'https://workoscdn.com/images/pending')
  await read()
  assert.equal(calls,1)
  env.db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?,?)').run('new','New','new@example.org','pending','2026-10-28',null,null)
  await read()
  assert.equal(calls,2)
})
