import test from 'node:test'
import assert from 'node:assert/strict'
import { collectExaResearch } from './exa-research.mjs'
const time = Date.parse('2026-10-28T00:00:00Z')
const env = { EXA_API_KEY: 'fixture', REFRESH_UNTIL: '2026-11-04T06:33:00Z' }
test('three five-result searches use distinct angles with highlights only and tiny excerpts', async () => {
  const bodies = []
  const data = await collectExaResearch(env, async (url, init) => {
    const body = JSON.parse(init.body); bodies.push(body)
    assert.equal(url, 'https://api.exa.ai/search')
    assert.equal(body.numResults, 5)
    assert.deepEqual(body.contents, { highlights: true })
    assert.equal(body.type, 'auto')
    return Response.json({ results: [{ title: 'one two three four five six seven eight nine ten eleven twelve thirteen', url: 'https://example.com/', highlights: ['one two three four five six seven eight nine ten eleven twelve thirteen fourteen'], author: 'A Writer' }, { url: 'https://egm.dev/' }], costDollars: { total: 0.01 } })
  }, {}, time)
  assert.equal(bodies.length, 3)
  assert.equal(new Set(bodies.map(b => b.query)).size, 3)
  assert.equal(data.exa_research.rows.length, 1)
  assert.equal(data.exa_research.rows[0].queryAngles.length, 3)
  assert.equal((data.exa_research.rows[0].title + ' ' + data.exa_research.rows[0].evidence).split(/\s+/).length, 25)
  assert.equal(data.exa_research.rows[0].verification, 'discovery_candidate')
  assert.equal(data.exa_research_status.rows[0].totalCostDollars, 0.03)
})
test('cache covers failures; cutoff, batch cap and known budget refuse network', async () => {
  const noRequest = () => { throw Error('must not call') }
  const failed = await collectExaResearch(env, async () => new Response(null, { status: 402 }), {}, time)
  assert.deepEqual(await collectExaResearch(env, noRequest, failed, time + 1000), failed)
  assert.equal((await collectExaResearch(env, noRequest, {}, Date.parse(env.REFRESH_UNTIL))).exa_research_status.rows[0].status, 'expired')
  for (const [row, status] of [[{ successfulBatches: 7 }, 'complete'], [{ totalCostDollars: 1 }, 'budget_limited']]) {
    assert.equal((await collectExaResearch(env, noRequest, { exa_research_status: { rows: [row] } }, time)).exa_research_status.rows[0].status, status)
  }
})
test('partial failure preserves old evidence and tracks actual costs without publishing partial rows', async () => {
  const old = { rows: [{ evidence: 'last good' }], source: { executedAt: 'old' } }
  let calls = 0
  const data = await collectExaResearch(env, async () => { if (++calls === 2) throw Error('secret detail'); return Response.json({ results: [], costDollars: { total: 0.1 } }) }, { exa_research: old, exa_research_status: { rows: [{ totalCostDollars: 0.2, successfulBatches: 2 }] } }, time)
  assert.deepEqual(data.exa_research, old)
  assert.equal(data.exa_research_status.rows[0].status, 'stale')
  assert.equal(data.exa_research_status.rows[0].successfulBatches, 2)
  assert.ok(Math.abs(data.exa_research_status.rows[0].totalCostDollars - 0.3) < 0.000001)
  assert.equal(JSON.stringify(data).includes('secret detail'), false)
})
test('known spend crossing threshold prevents remaining calls', async () => {
  let calls = 0
  const data = await collectExaResearch(env, async () => { calls++; return Response.json({ results: [], costDollars: { total: 0.02 } }) }, { exa_research_status: { rows: [{ totalCostDollars: 0.99 }] } }, time)
  assert.equal(calls, 1)
  assert.equal(data.exa_research_status.rows[0].status, 'budget_limited')
})
