import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { feedbackEventsRpc, flushFeedbackEvents, flushFeedbackToPosthog, loadFeedbackSurvey, recordFeedbackActivity, submitFeedback } from './feedback-events.mjs'
import { webhookSignature } from './approval-events.mjs'

const owner = { id: 'owner', email: 'owner@example.com', verified: 1, status: 'approved' }
const secret = 'whsec_' + Buffer.alloc(32, 7).toString('base64')
const id = 'ad016c58-a2de-4fa2-9fd8-e921fced5c10'
function environment() {
  const sql = new DatabaseSync(':memory:')
  sql.exec('CREATE TABLE users(id TEXT PRIMARY KEY,email TEXT,verified INTEGER,status TEXT)')
  sql.exec(readFileSync(new URL('./feedback-schema.sql', import.meta.url), 'utf8'))
  sql.prepare('INSERT INTO users VALUES(?,?,?,?)').run(owner.id, owner.email, 1, 'approved')
  const DB = { prepare(query) { let values = []; return { bind(...args) { values = args; return this }, async first() { return sql.prepare(query).get(...values) || null }, async all() { return { results: sql.prepare(query).all(...values) } }, async run() { return sql.prepare(query).run(...values) } } } }
  return { DB, sql, OWNER_EMAIL: owner.email, APP_URL: 'https://egm.n3wth.com', SESSION_SECRET: 's'.repeat(64), APPROVAL_WEBHOOK_HOSTS: 'connectors.api.openai.com', POSTHOG_PROJECT_TOKEN: 'public-token', POSTHOG_HOST: 'https://us.i.posthog.com' }
}
function feedback(data = { id, kind: 'Bug report', message: 'Broken chart', surveyIteration: 0 }, origin = 'https://egm.n3wth.com') {
  return new Request('https://egm.n3wth.com/api/feedback', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(data) })
}
const subscription = { method: 'events/subscribe', params: { name: 'feedback.submitted', arguments: {}, delivery: { mode: 'webhook', url: 'https://connectors.api.openai.com/events/test', secret } } }
const challenge = async (_url, options) => new Response(JSON.stringify({ challenge: JSON.parse(options.body).challenge }))
const survey = async () => Response.json({ surveys: [{ id: '01a18370-8a68-0000-1acf-51d9327fb0e5', schedule: 'always', conditions: null, questions: [{ id: '9eb38e99-77ad-4fe5-89e8-aad38c4d120a', type: 'single_choice', choices: ['Bug report', 'Feature request'] }, { id: '73ca6d88-c8c5-4fa1-8ae0-2f6d0a0ba626', type: 'open' }] }] })

test('feedback requires an approved user and same-origin bounded input; retries are idempotent', async () => {
  const env = environment()
  assert.equal((await submitFeedback(feedback(), env, { ...owner, status: 'pending' }, survey)).status, 403)
  assert.equal((await submitFeedback(feedback(undefined, 'https://other.example'), env, owner, survey)).status, 403)
  assert.equal((await submitFeedback(feedback({ id, kind: 'Bug report', message: 'x'.repeat(2001), surveyIteration: 0 }), env, owner, survey)).status, 400)
  assert.equal((await submitFeedback(feedback(), env, owner, survey)).status, 200)
  assert.equal((await submitFeedback(feedback(), env, owner, survey)).status, 200)
  assert.equal((await submitFeedback(feedback({ id, kind: 'Feature request', message: 'Changed', surveyIteration: 0 }), env, owner, survey)).status, 409)
  assert.equal(env.sql.prepare('SELECT count(*) n FROM feedback_items').get().n, 1)
})

test('feedback subscriptions verify destinations and deliver signed events once', async () => {
  const env = environment()
  assert.equal((await feedbackEventsRpc(subscription, { ...owner, status: 'pending' }, env, challenge)).error.code, -32001)
  const rejected = await feedbackEventsRpc(subscription, owner, env, async () => new Response('{"challenge":"wrong"}'))
  assert.equal(rejected.error.code, -32015)
  const result = await feedbackEventsRpc(subscription, owner, env, challenge)
  assert.match(result.result.id, /^sub_/)
  env.sql.exec('UPDATE feedback_subscriptions SET created_at=0')
  assert.equal((await submitFeedback(feedback(), env, owner, survey)).status, 200)
  const calls = []
  await Promise.all([flushFeedbackEvents(env, async (_url, options) => { calls.push(options); return new Response('ok') }), flushFeedbackEvents(env, async (_url, options) => { calls.push(options); return new Response('ok') })])
  await flushFeedbackEvents(env, async () => assert.fail('duplicate delivery'))
  assert.equal(calls.length, 1)
  const body = JSON.parse(calls[0].body)
  assert.equal(body.name, 'feedback.submitted')
  assert.deepEqual(body.data, { feedback_id: id, kind: 'Bug report', message: 'Broken chart' })
  assert.equal(calls[0].headers['webhook-signature'], await webhookSignature(secret, calls[0].headers['webhook-id'], calls[0].headers['webhook-timestamp'], calls[0].body))
})

test('failed delivery is retried and a revoked owner receives no events', async () => {
  const env = environment()
  await feedbackEventsRpc(subscription, owner, env, challenge)
  env.sql.exec('UPDATE feedback_subscriptions SET created_at=0')
  await submitFeedback(feedback(), env, owner, survey)
  await flushFeedbackEvents(env, async () => new Response('error', { status: 500 }))
  assert.equal(env.sql.prepare('SELECT complete FROM feedback_receipts').get().complete, 0)
  env.sql.exec("UPDATE feedback_receipts SET next_attempt=0; UPDATE users SET status='denied' WHERE id='owner'")
  await flushFeedbackEvents(env, async () => assert.fail('revoked owner'))
  env.sql.exec("UPDATE users SET status='approved' WHERE id='owner'")
  await flushFeedbackEvents(env, async () => new Response('ok'))
  assert.equal(env.sql.prepare('SELECT complete FROM feedback_receipts').get().complete, 1)
})

test('rotated subscription signs with both keys during the overlap', async () => {
  const env = environment()
  await feedbackEventsRpc(subscription, owner, env, challenge)
  const nextSecret = 'whsec_' + Buffer.alloc(32, 8).toString('base64')
  const changed = { ...subscription, params: { ...subscription.params, delivery: { ...subscription.params.delivery, secret: nextSecret } } }
  let verification
  await feedbackEventsRpc(changed, owner, env, async (_url, options) => { verification = options; return challenge(_url, options) })
  const expected = await webhookSignature(nextSecret, verification.headers['webhook-id'], verification.headers['webhook-timestamp'], verification.body)
  const previous = await webhookSignature(secret, verification.headers['webhook-id'], verification.headers['webhook-timestamp'], verification.body)
  assert.equal(verification.headers['webhook-signature'], expected + ' ' + previous)
})

test('completed old deliveries do not starve newer feedback', async () => {
  const env = environment()
  await feedbackEventsRpc(subscription, owner, env, challenge)
  const sub = env.sql.prepare('SELECT id FROM feedback_subscriptions').get().id
  for (let index = 0; index < 101; index++) {
    const item = 'old-' + index
    env.sql.prepare('INSERT INTO feedback_items(id,author_id,kind,message,created_at) VALUES(?,?,?,?,?)').run(item, owner.id, 'Bug report', 'Old', index)
    env.sql.prepare('INSERT INTO feedback_receipts(subscription_id,feedback_id,complete) VALUES(?,?,1)').run(sub, item)
  }
  await submitFeedback(feedback(), env, owner, survey)
  const calls = []
  await flushFeedbackEvents(env, async (_url, options) => { calls.push(JSON.parse(options.body)); return new Response('ok') })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].data.feedback_id, id)
})

test('PostHog feedback is retried with one stable survey submission ID', async () => {
  const env = { ...environment(), POSTHOG_PROJECT_TOKEN: 'public-token', POSTHOG_HOST: 'https://us.i.posthog.com' }
  await submitFeedback(feedback(), env, owner, survey)
  let sent
  await flushFeedbackToPosthog(env, async (_url, options) => { sent = JSON.parse(options.body); return new Response('error', { status: 503 }) })
  assert.equal(sent.event, 'survey sent')
  assert.equal(sent.properties.$survey_submission_id, id)
  assert.equal(sent.properties['$survey_response_73ca6d88-c8c5-4fa1-8ae0-2f6d0a0ba626'], 'Broken chart')
  assert.equal(env.sql.prepare('SELECT posthog_complete FROM feedback_items').get().posthog_complete, 0)
  env.sql.exec('UPDATE feedback_items SET posthog_next_attempt=0')
  await flushFeedbackToPosthog(env, async (url, options) => { assert.equal(url, 'https://us.i.posthog.com/i/v0/e/'); assert.equal(options.redirect, 'manual'); return new Response('ok') })
  assert.equal(env.sql.prepare('SELECT posthog_complete FROM feedback_items').get().posthog_complete, 1)
  await flushFeedbackToPosthog(env, async () => assert.fail('duplicate delivery'))
})

test('feedback is stored when PostHog is down and rejected when the survey iteration changed', async () => {
  const env = environment()
  assert.equal((await loadFeedbackSurvey(env, survey)).status, 200)
  assert.equal((await submitFeedback(feedback(), env, owner, async () => new Response('error', { status: 503 }))).status, 200)
  assert.equal(env.sql.prepare('SELECT count(*) n FROM feedback_items').get().n, 1)
  assert.equal(env.sql.prepare('SELECT posthog_complete FROM feedback_items').get().posthog_complete, 0)
  assert.equal((await submitFeedback(feedback({ id, kind: 'Bug report', message: 'Broken chart', surveyIteration: 5 }), env, owner, survey)).status, 409)
})

test('shown and dismissed events are bounded and sent without message text', async () => {
  const env = environment()
  const request = () => new Request('https://egm.n3wth.com/api/feedback/activity', { method: 'POST', headers: { origin: env.APP_URL, 'content-type': 'application/json' }, body: JSON.stringify({ id, event: 'survey shown', surveyIteration: 0 }) })
  assert.equal((await recordFeedbackActivity(request(), env, owner)).status, 200)
  assert.equal((await recordFeedbackActivity(request(), env, owner)).status, 200)
  assert.equal(env.sql.prepare('SELECT count(*) n FROM feedback_activity').get().n, 1)
  let payload
  await flushFeedbackToPosthog(env, async (_url, options) => { payload = JSON.parse(options.body); return new Response('ok') })
  assert.equal(payload.event, 'survey shown')
  assert.equal(payload.distinct_id, 'feedback_' + id)
  assert.equal(payload.properties.$survey_id, '01a18370-8a68-0000-1acf-51d9327fb0e5')
  assert.equal(env.sql.prepare('SELECT complete FROM feedback_activity').get().complete, 1)
})
