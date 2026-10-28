import test from 'node:test'
import assert from 'node:assert/strict'
import { collectWebPerformance } from './web-performance.mjs'

const now = Date.parse('2026-10-28T00:00:00Z')
const env = { GOOGLE_WEB_PERFORMANCE_API_KEY: 'secret', REFRESH_UNTIL: '2026-11-04T00:00:00Z' }
test('collects independent lab and origin results and caches attempts', async () => {
  let calls = 0
  const data = await collectWebPerformance(env, async (url, init, timeoutMs) => {
    calls++
    assert.equal(init.headers['x-goog-api-key'], 'secret')
    assert.equal(timeoutMs, url.includes('queryRecord') ? 20000 : 60000)
    if (url.includes('queryRecord')) return Response.json({ record: { key: { origin: 'https://egm.dev' }, metrics: { largest_contentful_paint: { percentiles: { p75: 1800 }, histogram: [{ start: 0, end: 2500, density: 0.85 }] }, cumulative_layout_shift: { percentiles: { p75: '0.00' }, histogram: [{ start: '0.00', end: '0.10', density: 0.9 }] } }, collectionPeriod: { firstDate: { year: 2026, month: 10, day: 1 }, lastDate: { year: 2026, month: 10, day: 28 } } } })
    return Response.json({ lighthouseResult: { finalDisplayedUrl: 'https://egm.dev/', categories: { performance: { score: 0.85 } }, audits: {}, fetchTime: '2026-10-28T00:00:00Z' } })
  }, {}, now)
  assert.equal(calls, 2)
  assert.equal(data.web_pagespeed.rows[0].score, 85)
  assert.equal(data.web_crux.rows[0].p75, 1800)
  assert.equal(data.web_crux.rows[0].goodFraction, 0.85)
  assert.equal(data.web_crux.rows[0].startDate, '2026-10-01')
  assert.equal(data.web_crux.rows[1].p75, null)
  assert.equal(data.web_crux.rows[2].p75, 0)
  assert.equal(data.web_crux.rows[2].goodFraction, 0.9)
  assert.deepEqual(await collectWebPerformance({ REFRESH_UNTIL: env.REFRESH_UNTIL }, () => assert.fail('cached'), data, now + 1000), data)
  assert.equal(JSON.stringify(data).includes('secret'), false)
  const extended = await collectWebPerformance({ REFRESH_UNTIL: '2026-11-10T00:00:00Z' }, () => assert.fail('cached'), data, now + 2000)
  assert.equal(extended.web_pagespeed_status.rows[0].collectionEndsAt, '2026-11-10T00:00:00.000Z')
  assert.deepEqual(extended.web_pagespeed, data.web_pagespeed)
})

test('empty prior results stay unavailable and do not become stale', async () => {
  const data = await collectWebPerformance({ REFRESH_UNTIL: env.REFRESH_UNTIL }, () => assert.fail('missing key'), { web_pagespeed: { rows: [], source: {} } }, now)
  assert.equal(data.web_pagespeed_status.rows[0].status, 'unavailable')
  assert.equal(data.web_pagespeed_status.rows[0].reason, 'credential_unavailable')
})

test('response identity and invalid values cannot be reported as valid measurements', async () => {
  const data = await collectWebPerformance(env, async url => {
    if (url.includes('queryRecord')) return Response.json({ record: { key: { origin: 'https://elsewhere.example' }, metrics: { largest_contentful_paint: { percentiles: { p75: 1200 } } } } })
    return Response.json({ lighthouseResult: { finalDisplayedUrl: 'https://elsewhere.example/', categories: { performance: { score: 0.8 } } } })
  }, {}, now)
  assert.equal(data.web_pagespeed_status.rows[0].reason, 'invalid_response')
  assert.equal(data.web_crux_status.rows[0].reason, 'invalid_response')
  assert.equal(data.web_pagespeed.rows.length, 0)
})

test('bad histogram bins and provider values are not treated as good experiences', async () => {
  const data = await collectWebPerformance(env, async url => {
    if (url.includes('queryRecord')) return Response.json({ record: { key: { origin: 'https://egm.dev' }, metrics: { largest_contentful_paint: { percentiles: { p75: -1 }, histogram: [{ start: 0, end: 4000, density: 0.9 }] }, cumulative_layout_shift: { percentiles: { p75: '0.01' }, histogram: [{ start: '0', end: '0.1', density: 1.5 }] } } } })
    return Response.json({ lighthouseResult: { finalDisplayedUrl: 'https://egm.dev/', categories: { performance: { score: 0.7 } }, audits: { 'largest-contentful-paint': { numericValue: -10 } } } })
  }, {}, now)
  assert.equal(data.web_pagespeed.rows[0].lcpMs, null)
  assert.equal(data.web_crux.rows[0].p75, null)
  assert.equal(data.web_crux.rows[0].goodFraction, null)
  assert.equal(data.web_crux.rows[2].goodFraction, null)
})

test('failures retain last good data and do not expose provider errors', async () => {
  const old = { rows: [{ score: 75 }], source: { executedAt: 'earlier' } }
  const data = await collectWebPerformance(env, async url => {
    if (url.includes('queryRecord')) return new Response(null, { status: 404 })
    throw Error('secret provider error')
  }, { web_pagespeed: old }, now)
  assert.deepEqual(data.web_pagespeed, old)
  assert.equal(data.web_pagespeed_status.rows[0].status, 'stale')
  assert.equal(data.web_crux_status.rows[0].reason, 'no_record')
  assert.equal(JSON.stringify(data).includes('secret'), false)
})

test('expired and invalid refresh windows do not make provider calls', async () => {
  for (const until of [undefined, 'invalid', '2026-10-27T00:00:00Z']) {
    const data = await collectWebPerformance({ ...env, REFRESH_UNTIL: until }, () => assert.fail('expired'), {}, now)
    assert.equal(data.web_pagespeed_status.rows[0].status, 'expired')
    assert.equal(data.web_crux_status.rows[0].reason, 'collection_window_ended')
  }
})
