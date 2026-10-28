// Semrush MCP: https://developer.semrush.com/api/v3/introduction/semrush-mcp/
// Deliberately independent of GitHub ingestion. No request URLs contain secrets.
const endpoint = 'https://mcp.semrush.com/v2/mcp'
const day = 86400000
const plans = [
  { id: 'seo_overview', discovery: 'domain_overview', report: 'domain_rank', limit: 1 },
  { id: 'seo_keywords', discovery: 'organic_research', report: 'resource_organic', limit: 10 },
  { id: 'seo_competitors', discovery: 'competitors_research', report: 'domain_organic_organic', limit: 5 },
  { id: 'seo_backlinks', discovery: 'backlinks_research', report: 'backlinks_overview', limit: 1 },
  { id: 'seo_referring_domains', discovery: 'backlinks_research', report: 'backlinks_refdomains', limit: 5, sort: 'backlinks_num_desc' },
  { id: 'seo_top_backlinks', discovery: 'backlinks_research', report: 'backlinks', limit: 5, sort: 'page_authority_score_desc' }
]

function unwrap(result) {
  if (result.structuredContent) return result.structuredContent
  const texts = (result.content ?? []).filter(c => c.type === 'text').map(c => c.text)
  if (texts.length !== 1) throw Error('unsupported_response')
  try { return JSON.parse(texts[0]) } catch { throw Error('unsupported_response') }
}

function failure(result) {
  const code = result?.code ?? result?.error?.code
  if (code || result?.isError || result?.error) {
    const safeCodes = ['no_api_units', 'unauthorized', 'forbidden', 'invalid_api_key', 'no_data']
    throw Error(safeCodes.includes(code) ? code : 'provider_error')
  }
}

async function rpcClient(env, request) {
  const authorization = env.SEMRUSH_API_KEY ? 'Apikey ' + env.SEMRUSH_API_KEY : 'Bearer ' + env.SEMRUSH_ACCESS_TOKEN
  let session
  let sequence = 0
  const call = async (method, params, notification = false) => {
    const headers = { authorization, 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-03-26' }
    if (session) headers['mcp-session-id'] = session
    const response = await request(endpoint, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', ...(notification ? {} : { id: ++sequence }), method, params }), signal: AbortSignal.timeout(20000) })
    if (!response.ok) throw Error(response.status === 401 ? 'unauthorized' : response.status === 403 ? 'forbidden' : 'http_error')
    session = response.headers.get('mcp-session-id') ?? session
    if (notification) return
    const body = await response.text()
    if (body.length > 524288) throw Error('response_too_large')
    const envelopes = response.headers.get('content-type')?.includes('text/event-stream')
      ? body.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => JSON.parse(line.slice(5).trim()))
      : [JSON.parse(body)]
    const envelope = envelopes.find(item => item.id === sequence)
    if (!envelope || envelope.error) throw Error('protocol_error')
    return envelope.result
  }
  await call('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'egm-growth', version: '1.0.0' } })
  await call('notifications/initialized', {}, true)
  return async (name, args = {}) => {
    const result = await call('tools/call', { name, arguments: args })
    const payload = unwrap(result)
    failure({ ...payload, isError: result.isError })
    return payload
  }
}

function offered(discovery, name) {
  return Array.isArray(discovery.reports) && discovery.reports.some(report => (typeof report === 'string' ? report : report.name ?? report.report ?? report.id) === name)
}

function schemaParams(schema) {
  const shape = schema.input_schema ?? schema.inputSchema ?? schema.parameters ?? schema.schema ?? schema
  if (shape.properties) return shape
  if (Array.isArray(shape)) return { properties: Object.fromEntries(shape.map(p => [p.name, p])), required: shape.filter(p => p.required).map(p => p.name) }
  if (shape && typeof shape === 'object' && Object.values(shape).every(p => p && typeof p === 'object')) return { properties: shape, required: Object.entries(shape).filter(([, p]) => p.required).map(([name]) => name) }
  throw Error('unsupported_schema')
}

function parameters(plan, schema) {
  const shape = schemaParams(schema)
  const supported = { domain: 'egm.dev', database: 'us', display_limit: plan.limit, display_offset: 0, target: 'egm.dev', target_type: 'root_domain', ...(plan.sort ? { display_sort: plan.sort } : {}) }
  const params = Object.fromEntries(Object.entries(supported).filter(([name]) => name in shape.properties))
  if ((shape.required ?? []).some(name => !(name in params) && shape.properties[name]?.default === undefined)) throw Error('unsupported_required_parameter')
  // Require an actual row limit for row-priced reports before executing them.
  if (plan.limit > 1 && !('display_limit' in params)) throw Error('unbounded_report')
  return params
}

export function parseReportRows(payload, limit) {
  let rows = payload.rows ?? payload.data?.rows ?? payload.data ?? payload.result?.rows
  if (typeof rows === 'string' && payload.metadata?.format === 'csv') {
    // RFC-style quoted fields, including separators and newlines inside quotes.
    const records = []
    let record = [], field = '', quoted = false
    for (let i = 0; i < rows.length; i++) {
      const c = rows[i]
      if (c === '"') {
        if (quoted && rows[i + 1] === '"') { field += '"'; i++ }
        else quoted = !quoted
      } else if (!quoted && (c === ';' || c === '\n')) {
        record.push(field.replace(/\r$/, '')); field = ''
        if (c === '\n') { records.push(record); record = [] }
      } else field += c
    }
    if (quoted) throw Error('unsupported_report_data')
    if (field || record.length) records.push([...record, field])
    const headers = records.shift()
    if (!headers?.length || new Set(headers).size !== headers.length) throw Error('unsupported_report_data')
    rows = records.filter(values => values.some(value => value !== '')).map(values => {
      if (values.length !== headers.length) throw Error('unsupported_report_data')
      return Object.fromEntries(headers.map((header, i) => [header, /^-?\d+(?:\.\d+)?$/.test(values[i]) ? Number(values[i]) : values[i]]))
    })
  }
  if (!Array.isArray(rows) || rows.length > limit || rows.some(row => !row || typeof row !== 'object' || Array.isArray(row))) throw Error('unsupported_report_data')
  return rows
}

function source(at, report) {
  const backlinks = report.startsWith('backlinks')
  return { label: 'Semrush · egm.dev' + (backlinks ? ' · backlink index' : ' · US database'), provider: 'Semrush', executedAt: at, coverage: { startDate: at.slice(0, 10), endDate: at.slice(0, 10) }, metricDefinitions: [{ label: backlinks ? 'Backlinks' : 'Search traffic', definition: backlinks ? 'Links found in the Semrush backlink index, not measured site visitors.' : 'Semrush modeled organic search estimate, not measured website visitors.' }], caveats: [backlinks ? 'Latest available backlink index; collection time is not the index date.' : 'US database, latest available provider index; collection time is not the index date.', 'Rows are bounded to 10 keywords and 5 organic competitors; these are not exhaustive keyword or competitor lists.', 'Keyword gaps require a supported multi-domain report and are not inferred from absent rows.'], links: [{ label: 'Semrush domain overview', url: 'https://www.semrush.com/analytics/overview/?q=egm.dev&searchType=domain' }], evidenceFlow: [{ title: 'Semrush MCP report', detail: report }] }
}

/** Returns Data query records. Existing reports survive failed or incomplete runs.
 * Report rows preserve Semrush column names, rather than guessing unknown fields.
 * semrush_status row: status, attemptedAt, lastSuccessAt, nextAttemptAt, reason,
 * domain, database, reports, reportRequests, unitCost (null unless provider supplies).
 */
export async function collectSemrush(env, request = fetch, previousQueries = {}, now = Date.now()) {
  const at = new Date(now).toISOString()
  const previous = previousQueries.semrush_status?.rows?.[0]
  const retained = Object.fromEntries(plans.filter(p => previousQueries[p.id]).map(p => [p.id, previousQueries[p.id]]))
  let reportStates = { ...previous?.reportStates }
  let unitCost = null
  const result = (status, reason, reports = retained, attempted = 0, successAt = previous?.lastSuccessAt ?? null) => ({ ...reports, semrush_status: { rows: [{ status, reason, domain: 'egm.dev', database: 'us', attemptedAt: at, lastSuccessAt: successAt, nextAttemptAt: new Date(now + (status === 'available' ? day : 3600000)).toISOString(), reports: Object.keys(reports), reportStates, reportRequests: attempted, unitCost }], source: source(at, 'collection status') } })
  const cutoff = Date.parse(env.REFRESH_UNTIL)
  if (!Number.isFinite(cutoff) || now >= cutoff) return result('expired', 'Seven-day collection window ended')
  if (previous && Date.parse(previous.nextAttemptAt) > now) return { ...retained, semrush_status: previousQueries.semrush_status }
  if (!env.SEMRUSH_API_KEY && !env.SEMRUSH_ACCESS_TOKEN) return result('unavailable', 'Semrush credential not configured')
  let attempted = 0
  try {
    const tool = await rpcClient(env, request)
    const reports = {}
    for (const plan of plans) {
      // no_data is final for the current observation. The daily cache above
      // prevents immediate retries while allowing the next provider index update.
      const discovery = await tool(plan.discovery)
      if (!offered(discovery, plan.report)) throw Error('unsupported_report')
      const schema = await tool('get_report_schema', { report: plan.report })
      const params = parameters(plan, schema)
      attempted++
      try {
        const payload = await tool('execute_report', { report: plan.report, params })
        const provenance = source(at, plan.report)
        const usage = payload.metadata?.usage?.api_units
        if (typeof usage === 'number' && usage >= 0) unitCost = (unitCost ?? 0) + usage
        if (typeof payload.metadata?.url === 'string' && payload.metadata.url.startsWith('https://www.semrush.com/')) provenance.links = [{ label: 'Semrush report', url: payload.metadata.url }]
        reports[plan.id] = { rows: parseReportRows(payload, plan.limit), source: provenance }
        reportStates[plan.id] = 'available'
      } catch (error) {
        if (error.message !== 'no_data') throw error
        reportStates[plan.id] = 'no_data'
        reports[plan.id] = { rows: [], source: { ...source(at, plan.report), caveats: [...source(at, plan.report).caveats, 'Semrush returned no_data for these parameters. This does not establish zero traffic, keywords, or competitors.'] } }
      }
    }
    return result('available', null, reports, attempted, at)
  } catch (error) {
    reportStates = { ...previous?.reportStates }
    const codes = ['unsupported_response', 'provider_error', 'no_api_units', 'unauthorized', 'forbidden', 'invalid_api_key', 'no_data', 'http_error', 'response_too_large', 'protocol_error', 'unsupported_schema', 'unsupported_required_parameter', 'unbounded_report', 'unsupported_report', 'unsupported_report_data']
    return result(Object.keys(retained).length ? 'stale' : 'unavailable', codes.includes(error.message) ? error.message : 'collection_failed', retained, attempted)
  }
}
