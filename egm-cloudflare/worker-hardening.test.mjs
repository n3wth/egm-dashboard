import assert from 'node:assert/strict'
import test from 'node:test'
import {readFileSync} from 'node:fs'
import {DatabaseSync} from 'node:sqlite'
import worker,{handle,secured} from './worker.mjs'
import {createUnsubscribeToken,verifyUnsubscribeToken} from './growth-update-email.mjs'

const secret='s'.repeat(64)
function database() {
  const db=new DatabaseSync(':memory:')
  db.exec(readFileSync(new URL('./schema.sql',import.meta.url),'utf8'))
  const statement=(sql,args=[])=>({
    bind:(...next)=>statement(sql,next),
    first:async()=>db.prepare(sql).get(...args)??null,
    all:async()=>({results:db.prepare(sql).all(...args)}),
    run:async()=>({meta:{changes:db.prepare(sql).run(...args).changes}})
  })
  return {db,DB:{prepare:sql=>statement(sql)}}
}

test('public assets ignore query parameters and never send mail',async()=>{
  const {db,DB}=database()
  try {
    db.prepare("INSERT INTO users(id,email,name,verified,status,created_at) VALUES('u1','member@example.com','Member',1,'approved','2026-10-01T00:00:00Z')").run()
    const background=[],fetched=[]
    const original=globalThis.fetch
    globalThis.fetch=async(...args)=>{fetched.push(args[0]);return new Response('{}')}
    try {
      const env={APP_URL:'https://egm.n3wth.com',SESSION_SECRET:secret,RESEND_API_KEY:'re_secret',DB,ASSETS:{fetch:async()=>new Response('<svg/>',{headers:{'content-type':'image/svg+xml'}})}}
      for(const query of ['flush_growth_email=1','flush_growth_email=force','flush_growth_email=preview','flush_growth_email=x&preview=1']) {
        const response=await handle(new Request('https://egm.n3wth.com/favicon.svg?'+query),env,{waitUntil:promise=>background.push(promise)})
        assert.equal(response.status,200,query)
      }
      await Promise.all(background)
    } finally {globalThis.fetch=original}
    assert.equal(background.length,0)
    assert.deepEqual(fetched,[])
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM growth_update_emails').get().n,0)
  } finally {db.close()}
})

test('unsubscribe changes state only on POST and keeps the one-click JSON reply',async()=>{
  const {db,DB}=database()
  try {
    const env={APP_URL:'https://egm.n3wth.com',SESSION_SECRET:secret,DB}
    const url='https://egm.n3wth.com/email/unsubscribe?token='+encodeURIComponent(await createUnsubscribeToken('member@example.com',secret))
    const unsubscribed=()=>db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name='growth_email_unsubscribes'").get().n?db.prepare('SELECT email FROM growth_email_unsubscribes').all().map(row=>row.email):[]

    const confirm=await handle(new Request(url),env)
    assert.equal(confirm.status,200)
    assert.match(confirm.headers.get('content-security-policy'),/form-action 'self'/)
    assert.match(await confirm.text(),/<h1>Unsubscribe from the weekly brief\?<\/h1>/)
    assert.deepEqual(unsubscribed(),[])

    const invalid=await handle(new Request('https://egm.n3wth.com/email/unsubscribe?token="><script>alert(1)</script>'),env)
    assert.equal(invalid.status,400)
    assert.doesNotMatch(await invalid.text(),/<script>alert/)
    const forged=await handle(new Request(url+'x',{method:'POST'}),env)
    assert.equal(forged.status,400)
    assert.deepEqual(await forged.json(),{status:'invalid_token'})
    assert.deepEqual(unsubscribed(),[])

    const oneClick=await handle(new Request(url,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:'List-Unsubscribe=One-Click'}),env)
    assert.equal(oneClick.status,200)
    assert.deepEqual(await oneClick.json(),{status:'unsubscribed'})
    assert.deepEqual(unsubscribed(),['member@example.com'])

    const failing={...env,DB:{prepare(){throw Error('d1 down')}}}
    assert.equal((await handle(new Request(url,{method:'POST'}),failing)).status,503)
    const page=await handle(new Request(url,{method:'POST',headers:{accept:'text/html'}}),failing)
    assert.equal(page.status,503)
    assert.match(await page.text(),/href="\/email\/unsubscribe\?token=/)
  } finally {db.close()}
})

test('unsubscribe tokens have no built-in signing secret',async()=>{
  await assert.rejects(createUnsubscribeToken('member@example.com',[]),/unsubscribe_secret_missing/)
  await assert.rejects(createUnsubscribeToken('member@example.com',undefined),/unsubscribe_secret_missing/)
  const guessed=await createUnsubscribeToken('member@example.com','egm-growth-unsubscribe-default')
  assert.equal(await verifyUnsubscribeToken(guessed,[]),null)
  assert.equal(await verifyUnsubscribeToken(guessed,undefined),null)
  assert.equal(await verifyUnsubscribeToken(guessed,secret),null)
})

test('every response carries baseline security headers without replacing stricter ones',async()=>{
  const plain=secured(new Response('{}',{status:404,headers:{'content-type':'application/json'}}))
  assert.equal(plain.status,404)
  assert.equal(plain.headers.get('strict-transport-security'),'max-age=31536000')
  assert.equal(plain.headers.get('x-content-type-options'),'nosniff')
  assert.equal(plain.headers.get('x-frame-options'),'DENY')
  assert.equal(plain.headers.get('referrer-policy'),'same-origin')
  assert.equal(await plain.text(),'{}')
  assert.equal(secured(new Response(null,{headers:{'referrer-policy':'no-referrer'}})).headers.get('referrer-policy'),'no-referrer')
  assert.equal(secured(new Response(null,{status:204})).status,204)
  const upgrade={status:101,webSocket:{}}
  assert.equal(secured(upgrade),upgrade)

  const response=await worker.fetch(new Request('https://other.example/overview'),{APP_URL:'https://egm.n3wth.com'})
  assert.equal(response.status,404)
  assert.equal(response.headers.get('strict-transport-security'),'max-age=31536000')
  // No ASSETS binding makes the handler throw, which exercises the error path.
  const failed=await worker.fetch(new Request('https://egm.n3wth.com/favicon.svg'),{APP_URL:'https://egm.n3wth.com',SESSION_SECRET:secret})
  assert.equal(failed.status,503)
  assert.equal(failed.headers.get('x-content-type-options'),'nosniff')
})

test('the scheduled run removes expired sessions and keeps live ones',async()=>{
  const {db,DB}=database()
  try {
    const at=Math.floor(Date.now()/1000)
    db.prepare("INSERT INTO users(id,email,name,verified,status,created_at) VALUES('u1','member@example.com','Member',1,'approved','2026-10-01T00:00:00Z')").run()
    db.prepare('INSERT INTO sessions VALUES(?,?,?)').run('expired','u1',at-60)
    db.prepare('INSERT INTO sessions VALUES(?,?,?)').run('live','u1',at+3600)
    // The refresh that follows has no snapshot bindings here and is expected to fail after cleanup.
    await worker.scheduled({},{APP_URL:'https://egm.n3wth.com',SESSION_SECRET:secret,DB}).catch(()=>{})
    assert.deepEqual(db.prepare('SELECT id FROM sessions').all().map(row=>row.id),['live'])
  } finally {db.close()}
})
