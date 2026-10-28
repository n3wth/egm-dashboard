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
