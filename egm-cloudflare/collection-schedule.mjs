// Paid collection ends at env.REFRESH_UNTIL in wrangler.jsonc. That is the only
// end date. Extending collection is a one-line change there.
export function collectionWindow(env, time = Date.now()) {
  const until = Date.parse(env?.REFRESH_UNTIL)
  return {
    until,
    open: Number.isFinite(until) && time < until,
    endsAt: Number.isFinite(until) ? new Date(until).toISOString() : null
  }
}

// These intervals are the cadence already in effect: GitHub on the 30-minute
// cron, and each paid provider at most once a day. Do not shorten them.
const day = 86400000
export const collectionIntervalsMs = {
  github: 30 * 60 * 1000,
  semrush: day,
  mentions: day,
  exa: day,
  exaResearch: day,
  contentResearch: day,
  youtube: day,
  youtubeComments: day,
  tavily: day,
  parallel: day,
  engagement: day,
  webPerformance: day
}

// A full month at the interval above. The cap cannot raise call volume.
const daysInMonth = 31
export const monthlyCallCaps = Object.fromEntries(Object.entries(collectionIntervalsMs).map(([name, interval]) => [name, Math.floor(daysInMonth * day / interval)]))

const statusQuery = {
  semrush: 'semrush_status',
  mentions: 'mentions_status',
  exa: 'exa_status',
  exaResearch: 'exa_research_status',
  contentResearch: 'research_status',
  youtube: 'youtube_status',
  youtubeComments: 'youtube_comments_status',
  tavily: 'tavily_status',
  parallel: 'parallel_status',
  engagement: 'mention_engagement_status'
}

export function monthBudget(stored, time) {
  const month = new Date(time).toISOString().slice(0, 7)
  const calls = stored?.month === month && stored.calls && typeof stored.calls === 'object' ? { ...stored.calls } : {}
  return { month, calls }
}

// Reserve before a provider runs. A cached provider does not consume a call.
// Returns run, schedule, or monthly_cap.
export function planCollection(name, queries, budget, time) {
  const cap = monthlyCallCaps[name]
  if (!cap) return 'schedule'
  if (name === 'github') {
    const last = Date.parse(queries?.traffic?.source?.executedAt ?? '')
    if (Number.isFinite(last) && time - last < collectionIntervalsMs.github) return 'schedule'
  } else if (name === 'webPerformance') {
    const pages = Date.parse(queries?.web_pagespeed_status?.rows?.[0]?.nextAttemptAt ?? '')
    const crux = Date.parse(queries?.web_crux_status?.rows?.[0]?.nextAttemptAt ?? '')
    if (Number.isFinite(pages) && pages > time && Number.isFinite(crux) && crux > time) return 'schedule'
  } else {
    const next = Date.parse(queries?.[statusQuery[name]]?.rows?.[0]?.nextAttemptAt ?? '')
    if (Number.isFinite(next) && next > time) return 'schedule'
  }
  const used = Number(budget.calls[name] ?? 0)
  if (used >= cap) return 'monthly_cap'
  budget.calls[name] = used + 1
  return 'run'
}

const labels = {
  github: 'GitHub',
  semrush: 'Semrush',
  mentions: 'Mentions',
  exa: 'Exa',
  exaResearch: 'Exa research',
  contentResearch: 'Content research',
  youtube: 'YouTube',
  youtubeComments: 'YouTube comments',
  tavily: 'Tavily',
  parallel: 'Parallel',
  engagement: 'Engagement',
  webPerformance: 'PageSpeed and CrUX'
}

export function collectionSources({ queries = {}, state = {}, skips = {}, checkedAt, windowOpen }) {
  return Object.keys(labels).map(id => {
    const queryName = id === 'github' ? 'traffic' : id === 'webPerformance' ? 'web_pagespeed_status' : statusQuery[id]
    const row = queries[queryName]?.rows?.[0] ?? {}
    const source = id === 'github' ? queries.traffic?.source : null
    const status = state[id] ?? 'unknown'
    const reason = windowOpen ? skips[id] ?? row.reason ?? (status === 'failed' ? 'failed' : null) : 'collection_window_ended'
    const lastSuccessAt = row.lastSuccessAt ?? source?.executedAt ?? (id === 'github' && status === 'refreshed' ? checkedAt : null)
    return { id, label: labels[id], status, reason, lastSuccessAt }
  })
}
