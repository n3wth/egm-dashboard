import test from 'node:test'
import assert from 'node:assert/strict'
import { collectSemrush, parseReportRows } from './semrush.mjs'

const now = Date.parse('2026-10-28T00:00:00Z')
const env = { REFRESH_UNTIL: '2026-11-04T06:33:00Z', SEMRUSH_API_KEY: 'fixture-secret' }
function mock({ failAt, noDataAt, unbounded = false, actualSchema = false } = {}) {
  const calls = []
  const request = async (url, init) => {
    assert.equal(url, 'https://mcp.semrush.com/v2/mcp')
    assert.equal(init.headers.authorization, 'Apikey fixture-secret')
    const body = JSON.parse(init.body)
    calls.push(body)
    let result = { protocolVersion: '2025-03-26', capabilities: {} }
    if (body.method === 'notifications/initialized') return new Response(null, { status: 202 })
    if (body.method === 'tools/call') {
      const { name, arguments: args } = body.params
      let value
      if (name === 'get_report_schema') {
        const properties = { domain: {}, target: {}, database: {}, target_type: {}, ...(unbounded ? {} : { display_limit: {} }) }
        value = actualSchema ? { parameters: properties } : { properties }
      }
      else if (name === 'execute_report') value = args.report === failAt ? { code: 'no_api_units' } : args.report === noDataAt ? { code: 'no_data' } : { rows: [{ domain: 'egm.dev', metric: 7 }] }
      else value = { reports: ['domain_rank', 'resource_organic', 'domain_organic_organic', 'backlinks_overview', 'backlinks_refdomains', 'backlinks'] }
      result = { content: [{ type: 'text', text: JSON.stringify(value) }] }
    }
    return Response.json({ jsonrpc: '2.0', id: body.id, result })
  }
  return { request, calls }
}

test('collection uses discovery/schema before bounded execution and reports estimates', async () => {
  const fixture = mock()
  const queries = await collectSemrush(env, fixture.request, {}, now)
  assert.equal(queries.semrush_status.rows[0].status, 'available')
  assert.equal(queries.semrush_status.rows[0].unitCost, null)
  const calls = fixture.calls.filter(c => c.params?.name === 'execute_report')
  assert.equal(calls.length, 6)
  assert.equal(calls[1].params.arguments.params.display_limit, 10)
  assert.equal(calls[2].params.arguments.params.display_limit, 5)
  assert.match(queries.seo_overview.source.metricDefinitions[0].definition, /modeled/)
  assert.equal(JSON.stringify(queries).includes('fixture-secret'), false)
})

test('no_data is cached during the day and can recover in the next daily batch', async () => {
  const first = await collectSemrush(env, mock({ actualSchema: true, noDataAt: 'resource_organic' }).request, {}, now)
  assert.equal(first.semrush_status.rows[0].status, 'available')
  assert.equal(first.semrush_status.rows[0].reportStates.seo_keywords, 'no_data')
  assert.deepEqual(first.seo_keywords.rows, [])
  assert.deepEqual(await collectSemrush(env, () => { throw Error('must not retry today') }, first, now + 1800000), first)
  const secondFixture = mock({ actualSchema: true })
  const second = await collectSemrush(env, secondFixture.request, first, now + 86400001)
  assert.equal(secondFixture.calls.some(c => c.params?.arguments?.report === 'resource_organic'), true)
  assert.equal(second.semrush_status.rows[0].reportRequests, 6)
  assert.equal(second.semrush_status.rows[0].reportStates.seo_keywords, 'available')
  assert.equal(second.seo_keywords.rows.length, 1)
})

test('daily cache and cutoff make no network calls', async () => {
  const fixture = mock()
  const first = await collectSemrush(env, fixture.request, {}, now)
  const request = () => { throw Error('must not call') }
  assert.deepEqual(await collectSemrush(env, request, first, now + 1800000), first)
  assert.equal((await collectSemrush(env, request, first, Date.parse(env.REFRESH_UNTIL))).semrush_status.rows[0].status, 'expired')
})

test('partial failure retains every last good report and sanitizes the error', async () => {
  const previous = await collectSemrush(env, mock().request, {}, now)
  const queries = await collectSemrush(env, mock({ failAt: 'resource_organic' }).request, previous, now + 86400001)
  assert.equal(queries.semrush_status.rows[0].status, 'stale')
  assert.equal(queries.semrush_status.rows[0].reason, 'no_api_units')
  assert.equal(queries.semrush_status.rows[0].lastSuccessAt, previous.semrush_status.rows[0].lastSuccessAt)
  assert.deepEqual(queries.seo_keywords, previous.seo_keywords)
})

test('real MCP CSV response preserves provider metrics and parses quoted text', () => {
  const payload = { data: 'total;domains_num;score\n150;48;0\n', metadata: { format: 'csv' } }
  assert.deepEqual(parseReportRows(payload, 1), [{ total: 150, domains_num: 48, score: 0 }])
  assert.deepEqual(parseReportRows({ data: 'keyword;url\n"a;b";"https://egm.dev/"\n', metadata: { format: 'csv' } }, 10), [{ keyword: 'a;b', url: 'https://egm.dev/' }])
  assert.throws(() => parseReportRows(payload, 0))
})

test('unknown schema cannot trigger an unbounded row-priced request', async () => {
  const fixture = mock({ unbounded: true })
  const queries = await collectSemrush(env, fixture.request, {}, now)
  assert.equal(queries.semrush_status.rows[0].reason, 'unbounded_report')
  assert.equal(fixture.calls.filter(c => c.params?.name === 'execute_report').length, 1)
  assert.equal(queries.seo_overview, undefined)
})
