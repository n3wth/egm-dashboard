import test from 'node:test'
import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {readFileSync} from 'node:fs'
import {createHmac} from 'node:crypto'
import {approvalEventsRpc,callbackUrl,encryptSecret,flushApprovalEvents,sendWebhook,webhookSignature} from './approval-events.mjs'

const owner = {id:'owner',email:'oliver@newth.ai',verified:1,status:'approved'}
const secret = 'whsec_' + Buffer.alloc(32,7).toString('base64')
function environment() {
  const sql = new DatabaseSync(':memory:')
  sql.exec('CREATE TABLE users(id TEXT PRIMARY KEY,email TEXT,name TEXT,verified INTEGER,status TEXT,created_at TEXT)')
  sql.exec(readFileSync(new URL('./approval-events-schema.sql',import.meta.url),'utf8'))
  sql.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run(owner.id,owner.email,'Oliver',1,'approved',new Date().toISOString())
  const DB = {prepare(query) {
    let values = []
    return {bind(...args){values=args; return this},async first(){return sql.prepare(query).get(...values) || null},async all(){return {results:sql.prepare(query).all(...values)}},async run(){return sql.prepare(query).run(...values)}}
  }}
  return {DB,sql,OWNER_EMAIL:owner.email,APP_URL:'https://egm.n3wth.com',SESSION_SECRET:'s'.repeat(64),APPROVAL_WEBHOOK_HOSTS:'connectors.api.openai.com'}
}
const subscription = {method:'events/subscribe',params:{name:'access.requested',arguments:{},delivery:{mode:'webhook',url:'https://connectors.api.openai.com/events/test',secret}}}
const challengeEcho = async (_url,options) => new Response(JSON.stringify({challenge:JSON.parse(options.body).challenge}))
test('callback URL requires exact trusted HTTPS host without credentials or redirects',async()=>{
  for(const url of ['http://connectors.api.openai.com/x','https://127.0.0.1/x','https://connectors.api.openai.com.attacker.test/x','https://a@connectors.api.openai.com/x','https://connectors.api.openai.com:444/x','https://connectors.api.openai.com/x#fragment']) assert.throws(()=>callbackUrl(url,'connectors.api.openai.com'))
  await assert.rejects(sendWebhook('https://evil.test/','{}',{},'connectors.api.openai.com'))
  let mode
  await sendWebhook(subscription.params.delivery.url,'{}',{},'connectors.api.openai.com',async(_url,options)=>{mode=options.redirect; return new Response('')})
  assert.equal(mode,'manual')
})
test('Standard Webhooks signature matches independent HMAC and secrets are encrypted at rest',async()=>{
  const expected = 'v1,' + createHmac('sha256',Buffer.alloc(32,7)).update('id.123.body').digest('base64')
  assert.equal(await webhookSignature(secret,'id',123,'body'),expected)
  const encrypted = await encryptSecret(secret,'x'.repeat(64))
  assert.ok(!encrypted.includes(secret))
  assert.notEqual(encrypted,await encryptSecret(secret,'x'.repeat(64)))
})
test('unverified, unapproved, and non-owner identities cannot subscribe',async()=>{
  const env = environment()
  for(const identity of [null,{...owner,email:'friend@example.com'},{...owner,verified:0},{...owner,status:'pending'}]) {
    assert.equal((await approvalEventsRpc(subscription,identity,env)).error.code,-32001)
  }
  assert.equal(env.sql.prepare('SELECT count(*) n FROM approval_subscriptions').get().n,0)
})
test('subscription is persisted only after successful signed challenge',async()=>{
  const env = environment()
  const bad = await approvalEventsRpc(subscription,owner,env,async()=>new Response('{"challenge":"wrong"}'))
  assert.equal(bad.error.code,-32015)
  assert.equal(env.sql.prepare('SELECT count(*) n FROM approval_subscriptions').get().n,0)
  const result = await approvalEventsRpc(subscription,owner,env,challengeEcho)
  assert.match(result.result.id,/^sub_/)
  const row = env.sql.prepare('SELECT * FROM approval_subscriptions').get()
  assert.ok(!JSON.stringify(row).includes(secret))
  assert.equal(row.active,1)
})
test('pending request delivery is signed, deduplicated, and does not approve anyone',async()=>{
  const env = environment()
  await approvalEventsRpc(subscription,owner,env,challengeEcho)
  env.sql.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run('friend','friend@example.com','Untrusted name',1,'pending',new Date().toISOString())
  const calls = []
  const deliver = async(_url,options)=>{calls.push(options); return new Response('ok')}
  await Promise.all([flushApprovalEvents(env,deliver),flushApprovalEvents(env,deliver)])
  await flushApprovalEvents(env,deliver)
  assert.equal(calls.length,1)
  const payload = JSON.parse(calls[0].body)
  assert.equal(payload.name,'access.requested')
  assert.equal(payload.data.request_id,'friend')
  assert.equal(calls[0].headers['webhook-signature'],await webhookSignature(secret,calls[0].headers['webhook-id'],calls[0].headers['webhook-timestamp'],calls[0].body))
  assert.equal(env.sql.prepare('SELECT status FROM users WHERE id=?').get('friend').status,'pending')
})
test('delivery failures retain bounded retry state, 410 unsubscribes, owner revocation blocks delivery',async()=>{
  const env = environment()
  await approvalEventsRpc(subscription,owner,env,challengeEcho)
  env.sql.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run('friend','friend@example.com','Friend',1,'pending',new Date().toISOString())
  let calls = 0
  await flushApprovalEvents(env,async()=>{calls++; return new Response('error',{status:500})})
  await flushApprovalEvents(env,async()=>{calls++; return new Response('error',{status:500})})
  assert.equal(calls,1)
  assert.equal(env.sql.prepare('SELECT complete FROM approval_receipts').get().complete,0)
  env.sql.exec('UPDATE approval_receipts SET next_attempt=0')
  await flushApprovalEvents(env,async()=>new Response('gone',{status:410}))
  assert.equal(env.sql.prepare('SELECT active FROM approval_subscriptions').get().active,0)
  env.sql.exec("UPDATE approval_subscriptions SET active=1; UPDATE users SET status='denied' WHERE id='owner'; UPDATE approval_receipts SET complete=0,next_attempt=0")
  await flushApprovalEvents(env,async()=>{throw Error('must not deliver')})
  assert.equal(env.sql.prepare('SELECT attempts FROM approval_receipts').get().attempts,2)
})
test('expired subscriptions, unsubscribe and exhausted retries prevent further delivery',async()=>{
  const env = environment()
  await approvalEventsRpc(subscription,owner,env,challengeEcho)
  env.sql.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run('friend','friend@example.com','Friend',1,'pending',new Date().toISOString())
  env.sql.exec('UPDATE approval_subscriptions SET expires_at=0')
  const never = async()=>assert.fail('must not deliver')
  await flushApprovalEvents(env,never)
  await approvalEventsRpc(subscription,owner,env,challengeEcho)
  const sub = env.sql.prepare('SELECT id FROM approval_subscriptions').get()
  env.sql.prepare('INSERT INTO approval_receipts(subscription_id,request_id,attempts) VALUES(?,?,12)').run(sub.id,'friend')
  await flushApprovalEvents(env,never)
  assert.deepEqual(await approvalEventsRpc({...subscription,method:'events/unsubscribe'},owner,env),{result:{}})
  env.sql.exec('UPDATE approval_receipts SET attempts=0')
  await flushApprovalEvents(env,never)
})
