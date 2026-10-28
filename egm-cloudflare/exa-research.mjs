// https://exa.ai/docs/reference/search. Search + highlights only; no synthesis.
export const researchAngles = [
  { angle: 'Friction and discussions', query: 'Elephant Goldfish Model EGM developer experience limitations problems review workflow discussion', objective: 'Find independent first-hand discussions of Elephant Goldfish Model setup friction, limitations, and review experience. Prioritize concrete experiences; exclude official project announcements and unrelated animal results.' },
  { angle: 'Tutorials and first run', query: 'Elephant Goldfish Model plugin installation tutorial getting started first run coding agent walkthrough', objective: 'Find independent practical tutorials and first-run walkthroughs for the Elephant Goldfish Model software plugin. Prioritize actionable setup details and exclude official project documentation and announcements.' },
  { angle: 'Comparable workflow candidates', query: 'open source coding agents spec driven design adversarial review workflows quickstart demos', objective: 'Discover candidate open-source projects with design-first agent workflows and adversarial review. Prioritize concrete README, quickstart, demo and review process evidence. Similarity is a research lead, not an established peer relationship or popularity claim.' }
]
const day = 86400000
const ownDomains = ['egm.dev', 'github.com/google/elephant-goldfish-model', 'opensource.googleblog.com']
const words = (value, count) => String(value ?? '').trim().split(/\s+/).filter(Boolean).slice(0, count).join(' ')

function safeUrl(value) {
  try {
    const url = new URL(value)
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null
    url.hash = ''
    for (const key of [...url.searchParams.keys()]) if (/^utm_|^(gclid|fbclid)$/i.test(key)) url.searchParams.delete(key)
    return url.toString()
  } catch { return null }
}

function provenance(at) {
  return { label: 'Exa · EGM research discovery', provider: 'Exa', executedAt: at, coverage: { startDate: at.slice(0, 10), endDate: at.slice(0, 10) }, metricDefinitions: [{ label: 'Research candidates', definition: 'Search candidates with brief provider highlights. The query angle describes what was sought, not a verified conclusion about a result.' }], caveats: ['At most five results per angle, deduplicated by URL. No claim of exhaustiveness, virality, sentiment, or verified adoption.', 'Highlights are short provider excerpts, not generated findings. Review each linked source before treating it as evidence of friction or a comparison.', 'Results can include self-authored articles, syndicated content, or repository mirrors. Independence and original-repository identity are not verified.', 'Publication dates and authors are provider metadata. Missing dates remain unknown.', 'Maximum seven successful daily batches in the reporting window. Reported costs accumulate; collection stops before new calls once known spend reaches $1. Pricing is not guaranteed.'], links: [{ label: 'Exa search documentation', url: 'https://exa.ai/docs/reference/search' }], evidenceFlow: researchAngles.map(item => ({ title: item.angle, detail: item.query })) }
}

export async function collectExaResearch(env, request = fetch, previousQueries = {}, time = Date.now()) {
  const at = new Date(time).toISOString()
  const prior = previousQueries?.exa_research_status?.rows?.[0]
  const old = previousQueries?.exa_research
  let requests = 0, batchCostDollars = 0, costUnknown = false
  let totalCostDollars = Number.isFinite(prior?.totalCostDollars) ? prior.totalCostDollars : 0
  const batches = Number.isInteger(prior?.successfulBatches) ? prior.successfulBatches : 0
  const result = (status, reason, rows = old?.rows ?? [], success = false) => ({
    exa_research: success ? { rows, source: provenance(at) } : old ?? { rows: [], source: provenance(at) },
    exa_research_status: { rows: [{ status, reason, attemptedAt: at, lastSuccessAt: success ? at : prior?.lastSuccessAt ?? null, nextAttemptAt: new Date(time + day).toISOString(), successfulBatches: batches + (success ? 1 : 0), requests, resultCount: rows.length, batchCostDollars, totalCostDollars, costUnknown: costUnknown || prior?.costUnknown === true }], source: provenance(at) }
  })
  const cutoff = Date.parse(env.REFRESH_UNTIL)
  if (!Number.isFinite(cutoff) || time >= cutoff) return result('expired', 'Collection window ended')
  if (batches >= 7) return result('complete', 'Seven successful daily batches collected')
  if (totalCostDollars >= 1) return result('budget_limited', 'Known research spend reached $1')
  if (Date.parse(prior?.nextAttemptAt) > time) return { exa_research: old, exa_research_status: previousQueries.exa_research_status }
  if (!env.EXA_API_KEY) return result('unavailable', 'Credential not configured')
  const rows = new Map()
  try {
    for (const angle of researchAngles) {
      if (totalCostDollars >= 1) return result('budget_limited', 'Known research spend reached $1')
      requests++
      const egmAngle = angle.angle !== 'Comparable workflow candidates'
      const response = await request('https://api.exa.ai/search', { method: 'POST', headers: { 'x-api-key': env.EXA_API_KEY, 'content-type': 'application/json' }, body: JSON.stringify({ query: angle.query, objective: angle.objective, type: 'auto', numResults: 5, contents: { highlights: true }, excludeDomains: egmAngle ? ownDomains : ['github.com/google/elephant-goldfish-model'], startPublishedDate: new Date(time - 180 * day).toISOString() }), signal: AbortSignal.timeout(20000) })
      if (!response.ok) throw Error(response.status === 401 ? 'unauthorized' : response.status === 402 ? 'insufficient_credit' : response.status === 429 ? 'rate_limit' : 'provider_error')
      const body = await response.json()
      const cost = body.costDollars?.total
      if (Number.isFinite(cost) && cost >= 0) { batchCostDollars += cost; totalCostDollars += cost } else costUnknown = true
      if (!Array.isArray(body.results) || body.results.length > 5) throw Error('invalid_results')
      for (const item of body.results) {
        const url = safeUrl(item.url)
        if (!url) continue
        const parsed = new URL(url)
        if (parsed.hostname === 'egm.dev' || parsed.hostname === 'github.com' && parsed.pathname.startsWith('/google/elephant-goldfish-model')) continue
        if (egmAngle && parsed.hostname === 'opensource.googleblog.com') continue
        const priorRow = rows.get(url)
        if (priorRow) { priorRow.queryAngles.push(angle.angle); continue }
        const highlight = (item.highlights ?? []).find(text => typeof text === 'string') ?? ''
        rows.set(url, { title: words(item.title || parsed.hostname, 12), url, domain: parsed.hostname, queryAngles: [angle.angle], evidence: words(highlight, 13), author: typeof item.author === 'string' ? words(item.author, 12) : null, published: typeof item.publishedDate === 'string' && Number.isFinite(Date.parse(item.publishedDate)) ? item.publishedDate.slice(0, 10) : null, discoveredAt: at, provider: 'Exa', verification: 'discovery_candidate' })
      }
    }
    return result('available', null, [...rows.values()], true)
  } catch (error) {
    const safe = ['unauthorized', 'insufficient_credit', 'rate_limit', 'provider_error', 'invalid_results']
    return result(old ? 'stale' : 'unavailable', safe.includes(error.message) ? error.message : 'collection_failed')
  }
}
