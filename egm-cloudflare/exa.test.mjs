import test from 'node:test'
import assert from 'node:assert/strict'
import { collectExa } from './exa.mjs'

const time = Date.parse('2026-10-28T00:00:00Z')
const env = { EXA_API_KEY: 'test-key', REFRESH_UNTIL: '2026-11-04T06:33:00Z' }
test('only three bounded search calls, no extra paid content, deduplicated URLs', async () => {
  let calls = 0
  const request = async (url, init) => {
    assert.equal(url, 'https://api.exa.ai/search')
    assert.equal(init.headers['x-api-key'], 'test-key')
    const body = JSON.parse(init.body)
    assert.deepEqual(Object.keys(body), ['query', 'type', 'numResults'])
    assert.equal(body.numResults, 5)
    calls++
    return Response.json({ results: [{ title: 'EGM', url: 'https://example.com/egm?utm_source=feed#top', publishedDate: '2026-10-21T00:00:00Z' }, { url: 'javascript:bad' }], costDollars: { total: 0.005 } })
  }
  const data = await collectExa(env, request, {}, time)
  assert.equal(calls, 3)
  assert.equal(data.exa_mentions.rows.length, 1)
  assert.equal(data.exa_mentions.rows[0].url, 'https://example.com/egm')
  assert.equal(data.exa_mentions.rows[0].queries.length, 3)
  assert.equal(data.exa_status.rows[0].costDollars, 0.015)
})

test('24-hour cooldown applies to failures and successes, cutoff makes no calls', async () => {
  const failed = await collectExa(env, async () => new Response(null, { status: 402 }), {}, time)
  const noRequest = () => { throw Error('must not call') }
  assert.deepEqual(await collectExa(env, noRequest, failed, time + 1800000), failed)
  assert.equal((await collectExa(env, noRequest, {}, Date.parse(env.REFRESH_UNTIL))).exa_status.rows[0].status, 'expired')
  assert.equal((await collectExa({ EXA_API_KEY: 'test-key' }, noRequest, {}, time)).exa_status.rows[0].status, 'expired')
})

test('partial failure retains all prior rows and successful source timestamp', async () => {
  const previous = { exa_mentions: { rows: [{ url: 'https://example.com/', firstSeen: 'earlier' }], source: { executedAt: 'earlier' } }, exa_status: { rows: [{ lastSuccessAt: 'earlier' }] } }
  let calls = 0
  const data = await collectExa(env, async () => { if (++calls === 2) throw Error('secret-key error'); return Response.json({ results: [] }) }, previous, time)
  assert.equal(data.exa_status.rows[0].status, 'stale')
  assert.deepEqual(data.exa_mentions, previous.exa_mentions)
  assert.equal(JSON.stringify(data).includes('secret-key'), false)
})

test('first seen survives repeat observation and unknown publication date stays null', async () => {
  const previous = { exa_mentions: { rows: [{ url: 'https://example.com/', firstSeen: '2026-10-27T00:00:00Z' }] } }
  const data = await collectExa(env, async () => Response.json({ results: [{ url: 'https://example.com/', publishedDate: 'not known' }] }), previous, time)
  assert.equal(data.exa_mentions.rows[0].firstSeen, '2026-10-27T00:00:00Z')
  assert.equal(data.exa_mentions.rows[0].published, null)
})
