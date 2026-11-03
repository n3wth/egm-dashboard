import { refreshSnapshot } from './refresh.mjs'
import { trafficHistory } from './github-snapshot.mjs'
import { retainGithubHistory } from './github-history.mjs'
import { archiveStatements } from './github-history-storage.mjs'
import { collectDailyAnalysis } from './daily-analysis.mjs'
import seed from '../egm-performance/src/data.json' with {type:'json'}
import { collectSemrush } from './semrush.mjs'
import { collectMentions } from './mentions.mjs'
import { collectExa } from './exa.mjs'
import { collectExaResearch } from './exa-research.mjs'
import { collectContentResearch,revalidateResearchQueries } from './content-research.mjs'
import { collectYouTube } from './youtube.mjs'
import { collectYouTubeComments } from './youtube-comments.mjs'
import { collectTavily } from './tavily.mjs'
import { collectParallel } from './parallel.mjs'
import { collectEngagement } from './engagement.mjs'
import { collectWebPerformance } from './web-performance.mjs'
import { collectionSources, collectionWindow, githubCollectionEnabled, monthBudget, planCollection } from './collection-schedule.mjs'

// Cron Workers have a 15-minute wall-time limit. The longer lease cannot expire
// while a scheduled invocation is still running and spending provider units.
const leaseDuration = 20 * 60000
const cooldown = 2 * 60000

export async function runRefresh(env, request = fetch, services = {}) {
  const clock = services.now ?? Date.now
  const start = clock()
  const window = collectionWindow(env, start)
  const cutoff = window.until
  const githubEnabled = githubCollectionEnabled(env, start)
  const analysisEnabled=env.DAILY_ANALYSIS_ENABLED==='true'
  if (!window.open && !githubEnabled && !analysisEnabled) return { status: 'expired', collectionEndsAt: window.endsAt }
  const id = crypto.randomUUID()
  const acquired = await env.DB.prepare('UPDATE refresh_control SET lease_id=?,lease_until=? WHERE id=1 AND lease_until<=? AND (finished_at=0 OR finished_at<=?) RETURNING id').bind(id, start + leaseDuration, start, start - cooldown).first()
  if (!acquired) return { status: 'skipped', reason: 'running_or_cooldown' }
  const state = { status: 'failed', github: 'failed', semrush: 'failed', mentions: 'failed', exa: 'failed' }
  const githubDeadline = env.GITHUB_COLLECTION_ENABLED === 'true' ? start + 10 * 60000 : Math.min(cutoff, start + 10 * 60000)
  const deadline = Number.isFinite(cutoff) ? Math.min(cutoff, start + 10 * 60000) : start
  // Reserve an inference tail inside the cron wall-time limit; source deadlines stay unchanged.
  const analysisDeadline=start+12*60000
  const requestUntil = limit => async (url, init = {}, timeoutMs = 20000) => {
    const remaining = limit - clock()
    if (remaining <= 0) throw Error('refresh_deadline')
    const timeout = AbortSignal.timeout(Math.min(Number.isFinite(timeoutMs) ? Math.max(1, Math.min(timeoutMs, 60000)) : 20000, remaining))
    // Workers supports manual/follow, not Fetch's redirect:error. Inspect the
    // manual response instead so no provider credential follows a redirect.
    const rejectRedirect = init.redirect === 'error'
    const response = await request(url, { ...init, ...(rejectRedirect ? { redirect: 'manual' } : {}), signal: init.signal ? AbortSignal.any([init.signal, timeout]) : timeout })
    if (rejectRedirect && response.status >= 300 && response.status < 400) throw Error('unexpected_redirect')
    return response
  }
  const boundedRequest = requestUntil(deadline)
  const githubRequest = requestUntil(githubDeadline)
  const analysisRequest = requestUntil(analysisDeadline)
  try {
    const original = await env.DB.prepare('SELECT body FROM snapshots WHERE id=1').first()
    const previous = original ? JSON.parse(original.body) : { queries: {} }
    const budget = monthBudget(previous.refreshStatus?.budget, start)
    const skips = {}
    const githubDecision = githubEnabled?planCollection('github', previous.queries ?? {}, budget, clock()):'collection_window_ended'
    if (githubDecision !== 'run') { skips.github = githubDecision; state.github = 'cached' }
    let latest = previous
    try {
      if (githubDecision !== 'run') throw Error('collection_skipped')
      const result = await (services.github ?? refreshSnapshot)(env, githubRequest, undefined, { persist: false, previousSnapshot: previous })
      if (result.status === 'refreshed' && !result.snapshot?.queries) throw Error('missing_staged_snapshot')
      state.github = result.status
      latest = result.snapshot ?? previous
    } catch (error) {
      // Keep the last good GitHub snapshot, but still refresh independent sources.
      if (error?.message !== 'collection_skipped') state.github = 'failed'
    }
    if (typeof latest.generatedAt !== 'string' || !Number.isFinite(Date.parse(latest.generatedAt))) {
      for (const name of ['semrush', 'mentions', 'exa', 'exaResearch', 'contentResearch', 'youtube', 'youtubeComments', 'tavily', 'parallel', 'engagement', 'webPerformance']) state[name] = 'skipped_no_snapshot'
      return { ...state, reason: 'no_base_snapshot' }
    }
    const merged = { ...latest, queries: { ...previous.queries, ...latest.queries } }
    const archivePrevious=previous.githubHistory?previous:{...previous,githubHistory:retainGithubHistory({},seed)}
    delete merged.githubHistory
    const oldQueries = previous.queries ?? {}
    // The GitHub collector reads saved history best-effort; never let a failed read shrink it.
    if (latest !== previous && latest.queries?.traffic_history) {
      const { rows, source } = latest.queries.traffic_history
      merged.queries.traffic_history = trafficHistory(oldQueries.traffic_history?.rows, rows, source?.executedAt ?? latest.generatedAt)
    }
    const planned = name => {
      const decision = planCollection(name, merged.queries, budget, clock())
      if (decision === 'run') return true
      skips[name] = decision
      state[name] = 'cached'
      return false
    }
    // GitHub rebuilds from a seed that may contain old placeholders for these
    // providers. Only the independent collector may replace their saved records.
    for (const [key, value] of Object.entries(oldQueries)) {
      if (/^(seo_|semrush_|mentions(?:_|$)|mention_engagement|exa_|research_|youtube_|tavily_|parallel_|web_pagespeed|web_crux|site_performance)/.test(key)) merged.queries[key] = value
    }
    merged.queries=revalidateResearchQueries(merged.queries)
    if (clock() >= deadline) state.semrush = 'skipped_deadline'
    else if (planned('semrush')) try {
      const queries = await (services.semrush ?? collectSemrush)(env, boundedRequest, oldQueries, clock())
      Object.assign(merged.queries, queries)
      state.semrush = queries.semrush_status?.rows?.[0]?.status ?? 'refreshed'
    } catch { state.semrush = 'failed' }
    if (clock() >= deadline) state.mentions = 'skipped_deadline'
    else if (planned('mentions')) try {
      const queries = await (services.mentions ?? collectMentions)(env, boundedRequest, oldQueries, clock())
      Object.assign(merged.queries, queries)
      state.mentions = queries.mentions_status?.rows?.[0]?.status ?? 'refreshed'
    } catch { state.mentions = 'failed' }
    if (clock() >= deadline) state.exa = 'skipped_deadline'
    else if (planned('exa')) try {
      const queries = await (services.exa ?? collectExa)(env, boundedRequest, oldQueries, clock())
      Object.assign(merged.queries, queries)
      state.exa = queries.exa_status?.rows?.[0]?.status ?? 'refreshed'
    } catch { state.exa = 'failed' }
    if (clock() >= deadline) state.exaResearch = 'skipped_deadline'
    else if (planned('exaResearch')) try {
      const queries = await (services.exaResearch ?? collectExaResearch)(env, boundedRequest, oldQueries, clock())
      Object.assign(merged.queries, queries)
      state.exaResearch = queries.exa_research_status?.rows?.[0]?.status ?? 'refreshed'
    } catch { state.exaResearch = 'failed' }
    if (clock() >= deadline) state.contentResearch = 'skipped_deadline'
    else if (planned('contentResearch')) try {
      const queries = await (services.contentResearch ?? collectContentResearch)(env, boundedRequest, merged.queries, clock())
      Object.assign(merged.queries, queries)
      state.contentResearch = queries.research_status?.rows?.[0]?.status ?? 'refreshed'
    } catch { state.contentResearch = 'failed' }
    if (clock() >= deadline) state.youtube = 'skipped_deadline'
    else if (planned('youtube')) try {
      const queries = await (services.youtube ?? collectYouTube)(env, boundedRequest, merged.queries, clock())
      Object.assign(merged.queries, queries)
      state.youtube = queries.youtube_status?.rows?.[0]?.status ?? 'refreshed'
    } catch { state.youtube = 'failed' }
    if (clock() >= deadline) state.youtubeComments = 'skipped_deadline'
    else if (planned('youtubeComments')) try {
      const queries = await (services.youtubeComments ?? collectYouTubeComments)(env, boundedRequest, merged.queries, clock())
      Object.assign(merged.queries, queries)
      state.youtubeComments = queries.youtube_comments_status?.rows?.[0]?.status ?? 'refreshed'
    } catch { state.youtubeComments = 'failed' }
    if (clock() >= deadline) state.tavily = 'skipped_deadline'
    else if (planned('tavily')) try {
      const queries = await (services.tavily ?? collectTavily)(env, boundedRequest, oldQueries, clock())
      Object.assign(merged.queries, queries)
      state.tavily = queries.tavily_status?.rows?.[0]?.status ?? 'refreshed'
    } catch { state.tavily = 'failed' }
    if (clock() >= deadline) state.parallel = 'skipped_deadline'
    else if (planned('parallel')) try {
      const queries = await (services.parallel ?? collectParallel)(env, boundedRequest, oldQueries, clock())
      Object.assign(merged.queries, queries)
      state.parallel = queries.parallel_status?.rows?.[0]?.status ?? 'refreshed'
    } catch { state.parallel = 'failed' }
    if (clock() >= deadline) state.engagement = 'skipped_deadline'
    else if (planned('engagement')) try {
      const queries = await (services.engagement ?? collectEngagement)(env, boundedRequest, merged.queries, clock())
      Object.assign(merged.queries, queries)
      state.engagement = queries.mention_engagement_status?.rows?.[0]?.status ?? 'refreshed'
    } catch { state.engagement = 'failed' }
    if (clock() >= deadline) state.webPerformance = 'skipped_deadline'
    else if (planned('webPerformance')) try {
      const prior = { ...oldQueries }
      // Respect a recent attempt by the older collector while transitioning to
      // the single origin-level collector. Do not relabel phone data as all-device data.
      for (const [name, kind] of [['pagespeed', 'Lab'], ['crux', 'Field']]) {
        const key = `web_${name}_status`
        const legacy = oldQueries.site_performance?.rows?.find(row => row.kind === kind)
        const attempted = Date.parse(legacy?.lastAttemptAt)
        if (!prior[key] && Number.isFinite(attempted) && attempted <= clock() && clock() - attempted < 86400000) {
          prior[key] = { rows: [{ status: 'unavailable', reason: 'previous_collection_cached', attemptedAt: legacy.lastAttemptAt, nextAttemptAt: new Date(attempted + 86400000).toISOString() }], source: oldQueries.site_performance.source }
        }
      }
      const performanceEnv = { ...env, GOOGLE_WEB_PERFORMANCE_API_KEY: env.GOOGLE_WEB_PERFORMANCE_API_KEY || env.GOOGLE_PERFORMANCE_API_KEY }
      const queries = await (services.webPerformance ?? collectWebPerformance)(performanceEnv, boundedRequest, prior, clock())
      Object.assign(merged.queries, queries)
      state.webPerformance = 'checked'
    } catch { state.webPerformance = 'failed' }
    if(analysisEnabled&&(env.GEMINI_API_KEY||env.INFER||services.dailyAnalysis)) {
      // Leave the existing model request timeout intact before reserving a paid daily attempt.
      if(clock()+20000>=analysisDeadline){
        state.dailyAnalysis='skipped_deadline'
        const checkedAt=new Date(clock()).toISOString()
        merged.queries.daily_analysis_status={rows:[{status:merged.queries.daily_analysis?'stale':'unavailable',reason:'insufficient_time_budget',checkedAt}],source:{label:'Daily analysis generation status',executedAt:checkedAt}}
      }
      else try {
        const analysis=await (services.dailyAnalysis??collectDailyAnalysis)(env,analysisRequest,merged,{now:clock,leaseId:id})
        if(analysis.query){
          merged.queries.daily_analysis=analysis.query
          for(const key of Object.keys(merged.queries))if(key.startsWith('daily_analysis_input_'))delete merged.queries[key]
          for(const record of analysis.query.source.inputRecords??[])merged.queries['daily_analysis_input_'+record.queryId]={rows:record.rows,source:{label:'Original analysis input · '+record.label,executedAt:record.observedAt,coverage:record.coverage,metricDefinitions:record.definitions,caveats:['Original bounded input to the saved daily analysis, not the current dashboard observations.',...(record.caveats??[]),...(record.rowsTruncated?['Only this bounded row sample was supplied to the model.']:[])],inputFingerprint:analysis.query.source.inputFingerprint}}
        }
        merged.queries.daily_analysis_status={rows:[{status:analysis.status,reason:analysis.reason,checkedAt:analysis.checkedAt,inputFingerprint:analysis.inputFingerprint}],source:{label:'Daily analysis generation status',executedAt:analysis.checkedAt}}
        if(analysis.attempted)budget.calls.dailyAnalysis=(budget.calls.dailyAnalysis??0)+1
        state.dailyAnalysis=analysis.status
      } catch {state.dailyAnalysis='failed'}
    }
    // GitHub collection is 30 minutes; search discovery uses provider caches.
    // Source requests keep their own deadlines and the paid cutoff. Analysis
    // may finish in its bounded tail before fenced publication.
    const finished = clock()
    if (finished >= (analysisEnabled?analysisDeadline:githubDeadline)) { state.status = 'expired'; return { ...state } }
    const commitAt = new Date(finished).toISOString()
    // Keep runner outcomes separate from provider status rows, whose cache and
    // budget fields must survive failures unchanged. Never persist error text.
    const allowedStatuses = new Set(['refreshed', 'failed', 'skipped_deadline', 'available', 'unavailable', 'stale', 'cached', 'checked', 'expired', 'disabled', 'partial', 'unconfigured'])
    merged.refreshStatus = {
      checkedAt: commitAt,
      collectionEndsAt: window.endsAt,
      collectors: Object.fromEntries(Object.entries(state).filter(([name]) => name !== 'status').map(([name, status]) => [name, allowedStatuses.has(status) ? status : 'unknown'])),
      sources: collectionSources({ queries: merged.queries, state, skips, checkedAt: commitAt, windowOpen: collectionWindow(env, finished).open, githubEnabled: githubCollectionEnabled(env, finished), endsAt: window.endsAt, githubEndsAt: env.GITHUB_COLLECTION_ENABLED === 'true' ? null : window.endsAt }),
      budget
    }
    const snapshotWrite = env.DB.prepare('INSERT INTO snapshots(id,body,generated_at) SELECT 1,?,? WHERE EXISTS(SELECT 1 FROM refresh_control WHERE id=1 AND lease_id=? AND lease_until>?) ON CONFLICT(id) DO UPDATE SET body=excluded.body,generated_at=excluded.generated_at WHERE julianday(excluded.generated_at)>=julianday(snapshots.generated_at) RETURNING id').bind(JSON.stringify(merged), commitAt, id, finished)
    const [result] = await env.DB.batch([snapshotWrite,...archiveStatements(env.DB,archivePrevious,merged,commitAt,id)])
    const saved=result.results?.[0]
    if (!saved) { state.status = 'skipped'; return { ...state, reason: 'lease_lost_or_newer_snapshot' } }
    state.status = state.github === 'refreshed' ? 'refreshed' : 'partial'
    return { ...state, generatedAt: merged.generatedAt, committedAt: commitAt }
  } finally {
    // Sanitized statuses only. Provider errors can contain credentials or URLs.
    await env.DB.prepare('UPDATE refresh_control SET lease_id=NULL,lease_until=0,finished_at=?,last_status=?,github_status=?,semrush_status=?,mentions_status=? WHERE id=1 AND lease_id=?').bind(clock(), state.status, state.github, state.semrush, state.mentions, id).run()
  }
}
