import { refreshSnapshot } from './refresh.mjs'
import { collectSemrush } from './semrush.mjs'
import { collectMentions } from './mentions.mjs'
import { collectExa } from './exa.mjs'
import { collectExaResearch } from './exa-research.mjs'
import { collectContentResearch } from './content-research.mjs'
import { collectYouTube } from './youtube.mjs'
import { collectTavily } from './tavily.mjs'
import { collectParallel } from './parallel.mjs'
import { collectEngagement } from './engagement.mjs'

// Cron Workers have a 15-minute wall-time limit. The longer lease cannot expire
// while a scheduled invocation is still running and spending provider units.
const leaseDuration = 20 * 60000
const cooldown = 2 * 60000

export async function runRefresh(env, request = fetch, services = {}) {
  const clock = services.now ?? Date.now
  const start = clock()
  const cutoff = Date.parse(env.REFRESH_UNTIL)
  if (!Number.isFinite(cutoff) || start >= cutoff) return { status: 'expired' }
  const id = crypto.randomUUID()
  const acquired = await env.DB.prepare('UPDATE refresh_control SET lease_id=?,lease_until=? WHERE id=1 AND lease_until<=? AND (finished_at=0 OR finished_at<=?) RETURNING id').bind(id, start + leaseDuration, start, start - cooldown).first()
  if (!acquired) return { status: 'skipped', reason: 'running_or_cooldown' }
  const state = { status: 'failed', github: 'failed', semrush: 'failed', mentions: 'failed', exa: 'failed' }
  const deadline = Math.min(cutoff, start + 10 * 60000)
  const boundedRequest = async (url, init = {}) => {
    const remaining = deadline - clock()
    if (remaining <= 0) throw Error('refresh_deadline')
    const timeout = AbortSignal.timeout(Math.min(20000, remaining))
    // Workers supports manual/follow, not Fetch's redirect:error. Inspect the
    // manual response instead so no provider credential follows a redirect.
    const rejectRedirect = init.redirect === 'error'
    const response = await request(url, { ...init, ...(rejectRedirect ? { redirect: 'manual' } : {}), signal: init.signal ? AbortSignal.any([init.signal, timeout]) : timeout })
    if (rejectRedirect && response.status >= 300 && response.status < 400) throw Error('unexpected_redirect')
    return response
  }
  try {
    const original = await env.DB.prepare('SELECT body FROM snapshots WHERE id=1').first()
    const previous = original ? JSON.parse(original.body) : { queries: {} }
    let latest = previous
    try {
      const result = await (services.github ?? refreshSnapshot)(env, boundedRequest, undefined, { persist: false })
      if (result.status === 'refreshed' && !result.snapshot?.queries) throw Error('missing_staged_snapshot')
      state.github = result.status
      latest = result.snapshot ?? previous
    } catch {
      // Keep the last good GitHub snapshot, but still refresh independent sources.
      state.github = 'failed'
    }
    if (typeof latest.generatedAt !== 'string' || !Number.isFinite(Date.parse(latest.generatedAt))) {
      for (const name of ['semrush', 'mentions', 'exa', 'exaResearch', 'contentResearch', 'youtube', 'tavily', 'parallel', 'engagement']) state[name] = 'skipped_no_snapshot'
      return { ...state, reason: 'no_base_snapshot' }
    }
    const merged = { ...latest, queries: { ...previous.queries, ...latest.queries } }
    const oldQueries = previous.queries ?? {}
    // GitHub rebuilds from a seed that may contain old placeholders for these
    // providers. Only the independent collector may replace their saved records.
    for (const [key, value] of Object.entries(oldQueries)) {
      if (/^(seo_|semrush_|mentions(?:_|$)|mention_engagement|exa_|research_|youtube_|tavily_|parallel_)/.test(key)) merged.queries[key] = value
    }
    if (clock() >= deadline) state.semrush = 'skipped_deadline'
    else try {
      const queries = await (services.semrush ?? collectSemrush)(env, boundedRequest, oldQueries, clock())
      Object.assign(merged.queries, queries)
      state.semrush = queries.semrush_status?.rows?.[0]?.status ?? 'refreshed'
    } catch { state.semrush = 'failed' }
    if (clock() >= deadline) state.mentions = 'skipped_deadline'
    else try {
      const queries = await (services.mentions ?? collectMentions)(env, boundedRequest, oldQueries, clock())
      Object.assign(merged.queries, queries)
      state.mentions = queries.mentions_status?.rows?.[0]?.status ?? 'refreshed'
    } catch { state.mentions = 'failed' }
    if (clock() >= deadline) state.exa = 'skipped_deadline'
    else try {
      const queries = await (services.exa ?? collectExa)(env, boundedRequest, oldQueries, clock())
      Object.assign(merged.queries, queries)
      state.exa = queries.exa_status?.rows?.[0]?.status ?? 'refreshed'
    } catch { state.exa = 'failed' }
    if (clock() >= deadline) state.exaResearch = 'skipped_deadline'
    else try {
      const queries = await (services.exaResearch ?? collectExaResearch)(env, boundedRequest, oldQueries, clock())
      Object.assign(merged.queries, queries)
      state.exaResearch = queries.exa_research_status?.rows?.[0]?.status ?? 'refreshed'
    } catch { state.exaResearch = 'failed' }
    if (clock() >= deadline) state.contentResearch = 'skipped_deadline'
    else try {
      const queries = await (services.contentResearch ?? collectContentResearch)(env, boundedRequest, merged.queries, clock())
      Object.assign(merged.queries, queries)
      state.contentResearch = queries.research_status?.rows?.[0]?.status ?? 'refreshed'
    } catch { state.contentResearch = 'failed' }
    if (clock() >= deadline) state.youtube = 'skipped_deadline'
    else try {
      const queries = await (services.youtube ?? collectYouTube)(env, boundedRequest, merged.queries, clock())
      Object.assign(merged.queries, queries)
      state.youtube = queries.youtube_status?.rows?.[0]?.status ?? 'refreshed'
    } catch { state.youtube = 'failed' }
    if (clock() >= deadline) state.tavily = 'skipped_deadline'
    else try {
      const queries = await (services.tavily ?? collectTavily)(env, boundedRequest, oldQueries, clock())
      Object.assign(merged.queries, queries)
      state.tavily = queries.tavily_status?.rows?.[0]?.status ?? 'refreshed'
    } catch { state.tavily = 'failed' }
    if (clock() >= deadline) state.parallel = 'skipped_deadline'
    else try {
      const queries = await (services.parallel ?? collectParallel)(env, boundedRequest, oldQueries, clock())
      Object.assign(merged.queries, queries)
      state.parallel = queries.parallel_status?.rows?.[0]?.status ?? 'refreshed'
    } catch { state.parallel = 'failed' }
    if (clock() >= deadline) state.engagement = 'skipped_deadline'
    else try {
      const queries = await (services.engagement ?? collectEngagement)(env, boundedRequest, merged.queries, clock())
      Object.assign(merged.queries, queries)
      state.engagement = queries.mention_engagement_status?.rows?.[0]?.status ?? 'refreshed'
    } catch { state.engagement = 'failed' }
    // GitHub collection is 30 minutes; search discovery uses provider caches.
    // Recheck the cutoff and fencing token before publishing any merged result.
    const finished = clock()
    if (finished >= cutoff) { state.status = 'expired'; return { ...state } }
    const commitAt = new Date(finished).toISOString()
    const saved = await env.DB.prepare('INSERT INTO snapshots(id,body,generated_at) SELECT 1,?,? WHERE EXISTS(SELECT 1 FROM refresh_control WHERE id=1 AND lease_id=? AND lease_until>?) ON CONFLICT(id) DO UPDATE SET body=excluded.body,generated_at=excluded.generated_at WHERE julianday(excluded.generated_at)>=julianday(snapshots.generated_at) RETURNING id').bind(JSON.stringify(merged), commitAt, id, finished).first()
    if (!saved) { state.status = 'skipped'; return { ...state, reason: 'lease_lost_or_newer_snapshot' } }
    state.status = state.github === 'refreshed' ? 'refreshed' : 'partial'
    return { ...state, generatedAt: merged.generatedAt, committedAt: commitAt }
  } finally {
    // Sanitized statuses only. Provider errors can contain credentials or URLs.
    await env.DB.prepare('UPDATE refresh_control SET lease_id=NULL,lease_until=0,finished_at=?,last_status=?,github_status=?,semrush_status=?,mentions_status=? WHERE id=1 AND lease_id=?').bind(clock(), state.status, state.github, state.semrush, state.mentions, id).run()
  }
}
