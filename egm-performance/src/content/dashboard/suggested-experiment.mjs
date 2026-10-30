// One deterministic ranking. Do not pick the first verified source.
export const experimentRule = 'Rank observed problems by discussion. An open issue scores its comment count. A verified research source with an excerpt scores 1. A mention scores 1. The highest score wins. Ties break by issues, then research quotes, then mentions, then the lowest URL.'

const success = 'Two of three people finish without help, and any step that stops more than one person is written down.'
const action = 'Ask three people to try the workflow this source describes. Record whether each finishes and the first step that stops them.'
const rank = { issue: 0, quote: 1, mention: 2 }

function urlOf(value) {
  if (typeof value !== 'string' || !/^https:\/\//.test(value)) return null
  try { const url = new URL(value); return url.protocol === 'https:' ? url.href : null } catch { return null }
}

export function suggestExperiment(queries = {}) {
  const candidates = []
  for (const issue of queries.issue_queue?.rows ?? []) {
    const url = urlOf(issue.url)
    const comments = Number(issue.comments)
    if (!url || !Number.isFinite(comments) || comments < 0 || typeof issue.title !== 'string' || !issue.title.trim()) continue
    candidates.push({ kind: 'issue', title: issue.title.trim(), url, score: comments })
  }
  for (const row of queries.research_evidence?.rows ?? []) {
    const url = urlOf(row.url)
    const quote = typeof row.contentExcerpt === 'string' ? row.contentExcerpt.trim() : ''
    if (row.status !== 'verified' || !url || !quote) continue
    candidates.push({ kind: 'quote', title: (row.title || quote).trim(), url, score: 1, quote })
  }
  for (const mention of queries.mentions?.rows ?? []) {
    const url = urlOf(mention.url)
    if (!url || typeof mention.title !== 'string' || !mention.title.trim()) continue
    candidates.push({ kind: 'mention', title: mention.title.trim(), url, score: 1 })
  }
  candidates.sort((a, b) => b.score - a.score || rank[a.kind] - rank[b.kind] || (a.url < b.url ? -1 : a.url > b.url ? 1 : 0))
  const winner = candidates[0]
  if (!winner) return null
  const seen = new Set()
  const evidence = []
  for (const item of candidates) {
    if (seen.has(item.url)) continue
    seen.add(item.url)
    evidence.push({ kind: item.kind, title: item.title, url: item.url, score: item.score, quote: item.quote ?? null })
    if (evidence.length === 3) break
  }
  return { rule: experimentRule, action, success, winner, evidence }
}
