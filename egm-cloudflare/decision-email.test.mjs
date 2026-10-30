import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { manageAccess } from './access-management.mjs'
import { decisionEmail, decisionEmailPreview, decisionSender, notifyAccessDecision } from './decision-email.mjs'
import { decideAccessRequest } from './mcp-server.mjs'
import { handle, seal } from './worker.mjs'

const owner = { id: 'owner', email: 'owner@example.org', verified: 1, status: 'approved' }
const secret = 'a'.repeat(64)

function database() {
  const db = new DatabaseSync(':memory:')
  db.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'))
  db.exec(readFileSync(new URL('./decision-email-schema.sql', import.meta.url), 'utf8'))
  const DB = {
    prepare(sql) {
      const statement = {
        sql,
        args: [],
        bind(...args) { return { ...this, args } },
        async run() {
          const result = db.prepare(sql).run(...this.args)
          return { meta: { changes: Number(result.changes) } }
        },
        async all() { return { results: db.prepare(sql).all(...this.args) } },
        async first() { return db.prepare(sql).get(...this.args) ?? null }
      }
      return statement
    },
    async batch(statements) {
      db.exec('BEGIN')
      try {
        const out = []
        for (const statement of statements) out.push(await statement.run())
        db.exec('COMMIT')
        return out
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    }
  }
  return { db, DB }
}

function environment(extra = {}) {
  const { db, DB } = database()
  const insert = db.prepare('INSERT INTO users(id,email,name,verified,status,created_at) VALUES(?,?,?,1,?,?)')
  insert.run(owner.id, owner.email, 'Owner', 'approved', '2026-10-28T00:00:00.000Z')
  insert.run('guest', 'guest@example.org', 'Guest', 'pending', '2026-10-28T00:00:00.000Z')
  insert.run('other', 'other@example.org', 'Other', 'pending', '2026-10-28T00:00:00.000Z')
  return {
    db,
    env: {
      DB,
      APP_URL: 'https://egm.n3wth.com',
      OWNER_EMAIL: owner.email,
      SESSION_SECRET: secret,
      RESEND_API_KEY: 'test-secret',
      DECISION_EMAIL_ENABLED: 'true',
      ...extra
    }
  }
}

function mailbox() {
  const sent = []
  const fetcher = async (url, init) => {
    sent.push({ url, init, body: JSON.parse(init.body) })
    return Response.json({ id: 'email_1' })
  }
  const context = () => {
    const pending = []
    return { pending, waitUntil(promise) { pending.push(promise) }, decisionEmailFetcher: fetcher }
  }
  return { sent, fetcher, context }
}

const post = body => new Request('https://egm.n3wth.com/api/access', {
  method: 'POST',
  headers: { origin: 'https://egm.n3wth.com', 'content-type': 'application/json' },
  body: JSON.stringify(body)
})

async function capturing(run) {
  const errors = []
  const original = console.error
  console.error = (...args) => errors.push(args.join(' '))
  try {
    await run()
  } finally {
    console.error = original
  }
  return errors
}

test('decision mail is flat and transparent in light and dark', () => {
  const approved = decisionEmail('approved')
  assert.equal(approved.subject, "You're in to the EGM Growth Dashboard")
  assert.match(approved.text, /Open the dashboard: https:\/\/egm\.n3wth\.com/)
  assert.match(approved.text, /same Google account/)
  assert.match(approved.html, /name="color-scheme" content="light dark"/)
  assert.match(approved.html, /name="supported-color-schemes" content="light dark"/)
  assert.match(approved.html, /prefers-color-scheme:dark/)
  assert.match(approved.html, /#f5f5f5/)
  assert.match(approved.html, /#7cacf8/)
  assert.match(approved.html, /background-color:transparent/)
  const backgrounds = approved.html.match(/background(?:-color)?:\s*[^;}"]+/g) ?? []
  assert.ok(backgrounds.length > 0)
  assert.ok(backgrounds.every(value => value.endsWith('transparent')))
  assert.doesNotMatch(approved.html, /linear-gradient|box-shadow|font-style:\s*italic|<em|<i[\s>]/i)
  assert.match(approved.html, /<h1[^>]*>You're in<\/h1>/)
  assert.match(approved.html, /lang="en" dir="ltr"/)
  const light = decisionEmailPreview('approved', 'light')
  const dark = decisionEmailPreview('approved', 'dark')
  assert.match(light, /html\{background-color:#ffffff\}/)
  assert.match(light, /background-color:transparent/)
  assert.match(dark, /html\{background-color:#181818\}/)
  assert.match(dark, /background-color:transparent/)
  assert.match(dark, /#f5f5f5 !important/)
  const denied = decisionEmail('denied')
  assert.equal(denied.subject, 'Your EGM Growth Dashboard request was not approved')
  assert.match(denied.text, /does not have access/)
  assert.doesNotMatch(denied.html, /egm\.n3wth\.com/)
  assert.doesNotMatch(denied.text, /egm\.n3wth\.com/)
  assert.match(decisionEmailPreview('denied', 'dark'), /html\{background-color:#181818\}/)
  assert.match(decisionEmailPreview('denied', 'light'), /background-color:transparent/)
})

test('dashboard approval emails once, and a repeat, revoke, or reinstate does not', async () => {
  const { db, env } = environment()
  const mail = mailbox()
  const ctx = mail.context()
  const first = await manageAccess(post({ id: 'guest', decision: 'approved' }), env, owner, fetch, ctx)
  assert.equal(first.status, 200)
  await Promise.all(ctx.pending)
  assert.equal(mail.sent.length, 1)
  assert.equal(mail.sent[0].url, 'https://api.resend.com/emails')
  assert.equal(mail.sent[0].init.redirect, 'manual')
  assert.equal(mail.sent[0].init.headers.authorization, 'Bearer test-secret')
  assert.equal(mail.sent[0].init.headers['idempotency-key'], 'egm-decision/guest/approved')
  assert.equal(mail.sent[0].body.from, decisionSender)
  assert.deepEqual(mail.sent[0].body.to, ['guest@example.org'])
  assert.equal(mail.sent[0].body.subject, "You're in to the EGM Growth Dashboard")
  assert.match(mail.sent[0].body.text, /https:\/\/egm\.n3wth\.com/)
  assert.equal(db.prepare("SELECT state,provider_id FROM decision_notifications WHERE user_id='guest'").get().state, 'sent')

  assert.equal((await manageAccess(post({ id: 'guest', decision: 'approved' }), env, owner, fetch, ctx)).status, 409)
  await notifyAccessDecision(env, { userId: 'guest', decision: 'approved', fromStatus: 'pending' }, mail.fetcher)
  const revoked = await manageAccess(post({ id: 'guest', decision: 'denied' }), env, owner, fetch, ctx)
  assert.equal((await revoked.json()).action, 'revoked')
  const restored = await manageAccess(post({ id: 'guest', decision: 'approved' }), env, owner, fetch, ctx)
  assert.equal((await restored.json()).action, 'reinstated')
  await Promise.all(ctx.pending)
  assert.equal(mail.sent.length, 1)
  assert.equal(db.prepare("SELECT status FROM users WHERE id='guest'").get().status, 'approved')
})

test('MCP decide_access_request emails once and a retry does not', async () => {
  const { db, env } = environment()
  const mail = mailbox()
  const ctx = mail.context()
  assert.deepEqual(await decideAccessRequest(env, owner, 'guest', 'approved', ctx), { request_id: 'guest', status: 'approved' })
  await Promise.all(ctx.pending)
  assert.equal(mail.sent.length, 1)
  assert.equal(mail.sent[0].init.headers['idempotency-key'], 'egm-decision/guest/approved')
  assert.equal(await decideAccessRequest(env, owner, 'guest', 'approved', ctx), null)
  await Promise.all(ctx.pending)
  assert.equal(mail.sent.length, 1)
  assert.equal(db.prepare("SELECT action FROM audit WHERE user_id='guest'").get().action, 'approved')
})

test('dashboard and MCP deciding one pending request send one email', async () => {
  const { env } = environment()
  const mail = mailbox()
  const dashboard = mail.context()
  const tool = mail.context()
  const [http, decided] = await Promise.all([
    manageAccess(post({ id: 'guest', decision: 'approved' }), env, owner, fetch, dashboard),
    decideAccessRequest(env, owner, 'guest', 'approved', tool)
  ])
  assert.equal([http.status === 200, Boolean(decided)].filter(Boolean).length, 1)
  await Promise.all([...dashboard.pending, ...tool.pending])
  assert.equal(mail.sent.length, 1)
})

test('flags default off, and turning one on later does not backfill', async () => {
  const { db, env } = environment({ DECISION_EMAIL_ENABLED: 'false' })
  const mail = mailbox()
  const ctx = mail.context()
  assert.equal((await manageAccess(post({ id: 'guest', decision: 'approved' }), env, owner, fetch, ctx)).status, 200)
  await Promise.all(ctx.pending)
  assert.equal(mail.sent.length, 0)
  assert.equal(db.prepare("SELECT state FROM decision_notifications WHERE user_id='guest'").get().state, 'skipped')
  env.DECISION_EMAIL_ENABLED = 'true'
  await notifyAccessDecision(env, { userId: 'guest', decision: 'approved', fromStatus: 'pending' }, mail.fetcher)
  assert.equal(mail.sent.length, 0)
  await notifyAccessDecision(env, { userId: 'other', decision: 'approved' }, mail.fetcher)
  assert.equal(mail.sent.length, 0)
  assert.equal(db.prepare('SELECT count(*) AS n FROM decision_notifications').get().n, 1)
})

test('denial mail uses its own flag and both decision paths', async () => {
  const { db, env } = environment()
  const mail = mailbox()
  const dashboard = mail.context()
  assert.equal((await manageAccess(post({ id: 'guest', decision: 'denied' }), env, owner, fetch, dashboard)).status, 200)
  await Promise.all(dashboard.pending)
  assert.equal(mail.sent.length, 0)
  assert.equal(db.prepare("SELECT state FROM decision_notifications WHERE user_id='guest'").get().state, 'skipped')
  env.DECISION_DENY_EMAIL_ENABLED = 'true'
  const tool = mail.context()
  assert.deepEqual(await decideAccessRequest(env, owner, 'other', 'denied', tool), { request_id: 'other', status: 'denied' })
  await Promise.all(tool.pending)
  assert.equal(mail.sent.length, 1)
  assert.equal(mail.sent[0].body.subject, 'Your EGM Growth Dashboard request was not approved')
  assert.equal(mail.sent[0].body.from, decisionSender)
  assert.equal(mail.sent[0].init.headers['idempotency-key'], 'egm-decision/other/denied')
  assert.doesNotMatch(mail.sent[0].body.html, /egm\.n3wth\.com/)
  assert.equal(await decideAccessRequest(env, owner, 'other', 'denied', tool), null)
  await Promise.all(tool.pending)
  assert.equal(mail.sent.length, 1)
})

test('a provider failure leaves the decision in place and does not retry', async () => {
  const { db, env } = environment()
  const sent = []
  const fetcher = async () => {
    sent.push(1)
    return new Response('no', { status: 503 })
  }
  const pending = []
  const ctx = { waitUntil(promise) { pending.push(promise) }, decisionEmailFetcher: fetcher }
  const errors = await capturing(async () => {
    const response = await manageAccess(post({ id: 'guest', decision: 'approved' }), env, owner, fetch, ctx)
    assert.equal(response.status, 200)
    await Promise.all(pending)
  })
  assert.equal(db.prepare("SELECT status FROM users WHERE id='guest'").get().status, 'approved')
  assert.equal(db.prepare("SELECT state FROM decision_notifications WHERE user_id='guest'").get().state, 'failed')
  assert.match(errors.join('\n'), /Decision email failed approved 503/)
  await notifyAccessDecision(env, { userId: 'guest', decision: 'approved', fromStatus: 'pending' }, fetcher)
  assert.equal(sent.length, 1)
})

test('a missing notification table does not undo the decision', async () => {
  const { db, env } = environment()
  db.exec('DROP TABLE decision_notifications')
  const pending = []
  const fetcher = async () => { throw Error('must not send') }
  const ctx = { waitUntil(promise) { pending.push(promise) }, decisionEmailFetcher: fetcher }
  const errors = await capturing(async () => {
    assert.equal((await decideAccessRequest(env, owner, 'guest', 'approved', ctx)).status, 'approved')
    await Promise.all(pending)
  })
  assert.equal(db.prepare("SELECT status FROM users WHERE id='guest'").get().status, 'approved')
  assert.match(errors.join('\n'), /Decision email failed approved unavailable/)
})

test('the access route returns while the email is still in flight', async () => {
  const { db, env } = environment()
  db.prepare('INSERT INTO sessions(id,user_id,expires_at) VALUES(?,?,?)').run('sess', owner.id, Math.floor(Date.now() / 1000) + 86400)
  const token = await seal({ sid: 'sess' }, secret, 'session')
  let release
  const gate = new Promise(resolve => { release = resolve })
  let started = false
  const pending = []
  const ctx = {
    waitUntil(promise) { pending.push(promise) },
    decisionEmailFetcher: async () => {
      started = true
      await gate
      return Response.json({ id: 'email_1' })
    }
  }
  const request = new Request(`${env.APP_URL}/api/access`, {
    method: 'POST',
    headers: { origin: env.APP_URL, 'content-type': 'application/json', cookie: `__Host-egm_session=${token}` },
    body: JSON.stringify({ id: 'guest', decision: 'approved' })
  })
  const response = await Promise.race([
    handle(request, env, ctx),
    new Promise((_, reject) => setTimeout(() => reject(Error('decision blocked on email')), 500))
  ])
  assert.equal(response.status, 200)
  assert.equal(db.prepare("SELECT status FROM users WHERE id='guest'").get().status, 'approved')
  release()
  await Promise.all(pending)
  assert.equal(started, true)
  assert.equal(db.prepare("SELECT state FROM decision_notifications WHERE user_id='guest'").get().state, 'sent')
})

test('MCP scheduling returns while the email is still in flight', async () => {
  const { db, env } = environment()
  let release
  const gate = new Promise(resolve => { release = resolve })
  let started = false
  const pending = []
  const ctx = {
    waitUntil(promise) { pending.push(promise) },
    decisionEmailFetcher: async () => {
      started = true
      await gate
      return Response.json({ id: 'email_2' })
    }
  }
  const decided = await Promise.race([
    decideAccessRequest(env, owner, 'guest', 'approved', ctx),
    new Promise((_, reject) => setTimeout(() => reject(Error('decision blocked on email')), 500))
  ])
  assert.equal(decided.status, 'approved')
  assert.equal(db.prepare("SELECT status FROM users WHERE id='guest'").get().status, 'approved')
  release()
  await Promise.all(pending)
  assert.equal(started, true)
  assert.equal(db.prepare("SELECT state,provider_id FROM decision_notifications WHERE user_id='guest'").get().provider_id, 'email_2')
})
