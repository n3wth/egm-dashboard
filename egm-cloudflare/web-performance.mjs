const day = 86400000
const origin = 'https://egm.dev'
const metrics = ['largest_contentful_paint', 'interaction_to_next_paint', 'cumulative_layout_shift']

function source(name, at) {
  return { label: name === 'crux' ? 'Chrome UX Report · origin' : 'PageSpeed Insights · mobile lab', provider: 'Google', executedAt: at, metricDefinitions: name === 'crux' ? [{ label: '75th percentile', definition: 'The 75th percentile of eligible Chrome experiences for each metric across the egm.dev origin and reported collection period.' }, { label: 'Good experiences', definition: 'The proportion of experiences in the first histogram bin when Google supplies the standard good threshold for the metric.' }] : [{ label: 'Performance score', definition: 'Lighthouse performance category score from one simulated mobile run of the egm.dev home page, on a scale from 0 to 100.' }], caveats: name === 'crux' ? ['Eligible Chrome user experiences across the origin and all device types, over the reported collection period. The 75th percentile is not an individual visit.', 'Metrics or histogram bins may be unavailable when Google does not have sufficient eligible data.'] : ['A simulated mobile Lighthouse run of the home page, not real-user experience. Results can vary between runs.'], links: [{ label: name === 'crux' ? 'CrUX API' : 'PageSpeed Insights API', url: name === 'crux' ? 'https://developer.chrome.com/docs/crux/api' : 'https://developers.google.com/speed/docs/insights/v5/get-started' }] }
}

const thresholds = { largest_contentful_paint: 2500, interaction_to_next_paint: 200, cumulative_layout_shift: 0.1 }
const nonNegative = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
function numberValue(value) {
  if (typeof value === 'number') return nonNegative(value)
  if (typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value)) return nonNegative(Number(value))
  return null
}
function validDate(value) {
  if (!value || !Number.isInteger(value.year) || !Number.isInteger(value.month) || !Number.isInteger(value.day)) return null
  const date = new Date(Date.UTC(value.year, value.month - 1, value.day))
  if (date.getUTCFullYear() !== value.year || date.getUTCMonth() + 1 !== value.month || date.getUTCDate() !== value.day) return null
  return date.toISOString().slice(0, 10)
}

export async function collectWebPerformance(env, request = fetch, previous = {}, time = Date.now()) {
  const at = new Date(time).toISOString(), result = {}
  for (const name of ['pagespeed', 'crux']) {
    const key = `web_${name}`, statusKey = `${key}_status`, old = previous[key], prior = previous[statusKey]?.rows?.[0]
    const hasOld = Array.isArray(old?.rows) && old.rows.length > 0
    const until = Date.parse(env.REFRESH_UNTIL)
    if (!Number.isFinite(until) || time >= until) {
      result[key] = hasOld ? old : { rows: [], source: source(name, at) }
      result[statusKey] = { rows: [{ status: 'expired', reason: 'collection_window_ended', attemptedAt: at, lastSuccessAt: prior?.lastSuccessAt ?? null, nextAttemptAt: null, collectionEndsAt: Number.isFinite(until) ? new Date(until).toISOString() : null }], source: source(name, at) }
      continue
    }
    if (Date.parse(prior?.nextAttemptAt) > time) {
      if (old) result[key] = old
      const collectionEndsAt = new Date(until).toISOString()
      result[statusKey] = prior.collectionEndsAt === collectionEndsAt ? previous[statusKey] : { ...previous[statusKey], rows: [{ ...prior, collectionEndsAt }, ...previous[statusKey].rows.slice(1)] }
      continue
    }
    let state = 'unavailable', reason = 'credential_unavailable', rows = null
    if (env.GOOGLE_WEB_PERFORMANCE_API_KEY) {
      try {
        const url = name === 'crux' ? 'https://chromeuxreport.googleapis.com/v1/records:queryRecord' : 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=https%3A%2F%2Fegm.dev%2F&strategy=mobile&category=performance'
        const timeoutMs = name === 'crux' ? 20000 : 60000
        const response = await request(url, { method: name === 'crux' ? 'POST' : 'GET', headers: { 'x-goog-api-key': env.GOOGLE_WEB_PERFORMANCE_API_KEY, ...(name === 'crux' ? { 'content-type': 'application/json' } : {}) }, ...(name === 'crux' ? { body: JSON.stringify({ origin }) } : {}), redirect: 'error', signal: AbortSignal.timeout(timeoutMs) }, timeoutMs)
        if (!response.ok) throw Error(response.status === 404 ? 'no_record' : response.status === 429 ? 'quota_exceeded' : 'provider_error')
        const body = await response.json()
        if (name === 'crux') {
          const record = body.record
          if (!record?.metrics || record.key?.origin !== origin) throw Error('invalid_response')
          const startDate = validDate(record.collectionPeriod?.firstDate), endDate = validDate(record.collectionPeriod?.lastDate)
          rows = metrics.map(metric => {
            const value = record.metrics[metric], p75 = numberValue(value?.percentiles?.p75)
            const bin = value?.histogram?.[0], density = nonNegative(bin?.density)
            const goodFraction = numberValue(bin?.start) === 0 && numberValue(bin?.end) === thresholds[metric] && density !== null && density <= 1 ? density : null
            return { metric, p75, goodFraction, startDate, endDate }
          })
          if (!rows.some(row => row.p75 !== null || row.goodFraction !== null)) throw Error('no_record')
        } else {
          const lighthouse = body.lighthouseResult, score = lighthouse?.categories?.performance?.score
          if (!Number.isFinite(score) || score < 0 || score > 1 || lighthouse.runtimeError) throw Error('invalid_response')
          if (typeof lighthouse.finalDisplayedUrl !== 'string' || new URL(lighthouse.finalDisplayedUrl).origin !== origin) throw Error('invalid_response')
          rows = [{ score: Math.round(score * 100), fetchedAt: Number.isFinite(Date.parse(lighthouse.fetchTime)) ? lighthouse.fetchTime : at, lcpMs: nonNegative(lighthouse.audits?.['largest-contentful-paint']?.numericValue), cls: nonNegative(lighthouse.audits?.['cumulative-layout-shift']?.numericValue), totalBlockingTimeMs: nonNegative(lighthouse.audits?.['total-blocking-time']?.numericValue) }]
        }
        state = 'available'; reason = null
      } catch (error) { reason = ['no_record', 'quota_exceeded', 'provider_error', 'invalid_response'].includes(error.message) ? error.message : 'collection_failed'; state = hasOld ? 'stale' : 'unavailable' }
    } else if (hasOld) state = 'stale'
    if (rows) result[key] = { rows, source: source(name, at) }
    else if (hasOld) result[key] = old
    else result[key] = { rows: [], source: source(name, at) }
    result[statusKey] = { rows: [{ status: state, reason, attemptedAt: at, lastSuccessAt: rows ? at : prior?.lastSuccessAt ?? null, nextAttemptAt: new Date(time + day).toISOString(), collectionEndsAt: new Date(until).toISOString() }], source: source(name, at) }
  }
  return result
}
