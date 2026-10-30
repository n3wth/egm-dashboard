// Official API contract: https://exa.ai/docs/reference/search
export const exaQueries = ['"elephant goldfish model"', '"elephant-goldfish-model"', '"egm.dev"']
const cacheMs = 86400000

function canonical(value) {
  try {
    const url = new URL(value)
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null
    url.hash = ''
    for (const key of [...url.searchParams.keys()]) if (/^utm_|^(fbclid|gclid)$/i.test(key)) url.searchParams.delete(key)
    return url.toString()
  } catch { return null }
}

function source(at) {
  return { label: 'Exa · indexed EGM discovery', provider: 'Exa', executedAt: at, coverage: { startDate: at.slice(0, 10), endDate: at.slice(0, 10) }, metricDefinitions: [{ label: 'Indexed discovery results', definition: 'URLs returned by three quoted EGM searches, deduplicated by URL. A search result is a discovery lead, not verified reach, sentiment, adoption, or audience size.' }], caveats: ['At most five results per query. Search indexing is incomplete and results can change.', 'Published date is provider metadata; first seen is when this dashboard first observed the URL.', 'No page content, summaries, deep research, or audience estimates are requested. Results need review before being described as confirmed mentions.'], links: [{ label: 'Exa API documentation', url: 'https://exa.ai/docs/reference/search' }], evidenceFlow: [{ title: 'Three bounded Exa search requests', detail: exaQueries.join('\n') }] }
}

export async function collectExa(env, request = fetch, previousQueries = {}, time = Date.now()) {
  const at = new Date(time).toISOString()
  const prior = previousQueries?.exa_status?.rows?.[0]
  const old = previousQueries?.exa_mentions
  let calls = 0, costDollars = null
  const result = (status, reason, rows = old?.rows ?? [], successful = false) => ({
    exa_mentions: successful ? { rows, source: source(at) } : old ?? { rows: [], source: source(at) },
    exa_status: { rows: [{ status, reason, attemptedAt: at, lastSuccessAt: successful ? at : prior?.lastSuccessAt ?? null, nextAttemptAt: new Date(time + cacheMs).toISOString(), requests: calls, resultCount: rows.length, costDollars }], source: source(at) }
  })
  const until = Date.parse(env.REFRESH_UNTIL)
  if (!Number.isFinite(until) || time >= until) return result('expired', 'Collection window ended')
  if (Date.parse(prior?.nextAttemptAt) > time) return { exa_mentions: old, exa_status: previousQueries.exa_status }
  if (!env.EXA_API_KEY) return result('unavailable', 'Credential not configured')
  try {
    const firstSeen = new Map((old?.rows ?? []).map(row => [row.url, row.firstSeen]))
    const rows = new Map()
    for (const query of exaQueries) {
      calls++
      const response = await request('https://api.exa.ai/search', { method: 'POST', redirect: 'error', headers: { 'x-api-key': env.EXA_API_KEY, 'content-type': 'application/json' }, body: JSON.stringify({ query, type: 'auto', numResults: 5 }), signal: AbortSignal.timeout(20000) })
      if (!response.ok) throw Error(response.status === 401 ? 'unauthorized' : response.status === 402 ? 'insufficient_credit' : response.status === 429 ? 'rate_limit' : 'provider_error')
      const body = await response.json()
      if (!Array.isArray(body.results) || body.results.length > 5) throw Error('invalid_results')
      if (typeof body.costDollars?.total === 'number' && body.costDollars.total >= 0) costDollars = (costDollars ?? 0) + body.costDollars.total
      for (const item of body.results) {
        const url = canonical(item.url)
        if (!url) continue
        const found = rows.get(url)
        if (found) { found.queries.push(query); continue }
        rows.set(url, { title: String(item.title || new URL(url).hostname).slice(0, 300), url, domain: new URL(url).hostname, published: typeof item.publishedDate === 'string' && Number.isFinite(Date.parse(item.publishedDate)) ? item.publishedDate.slice(0, 10) : null, firstSeen: firstSeen.get(url) ?? at, lastSeen: at, queries: [query], provider: 'Exa' })
      }
    }
    return result('available', null, [...rows.values()], true)
  } catch (error) {
    const safe = ['unauthorized', 'insufficient_credit', 'rate_limit', 'provider_error', 'invalid_results']
    return result(old ? 'stale' : 'unavailable', safe.includes(error.message) ? error.message : 'collection_failed')
  }
}
