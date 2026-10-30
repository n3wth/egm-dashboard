import {canonicalRepoPath} from './repo-paths.mjs'

export function safeExternalUrl(value) {
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null
  } catch { return null }
}

export function mostViewedDoc(rows) {
  const docs = (rows ?? []).filter(row => typeof row?.path === 'string' && row.path.includes('/docs/') && Number.isFinite(row.count))
  const groups = new Map()
  for (const row of docs) {
    const key = canonicalRepoPath(row.path)
    const group = groups.get(key)
    if (!group) groups.set(key, {key, rows: [row], count: row.count})
    else { group.rows.push(row); group.count += row.count }
  }
  let best
  for (const group of groups.values()) if (!best || group.count > best.count) best = group
  if (!best) return undefined
  if (best.rows.length === 1) return best.rows[0]
  return {path: best.key, count: best.count, uniques: null, combined: true}
}

export function mentionGroup(kind) {
  return ['Video', 'Social', 'Media / web', 'Official'].includes(kind) ? kind : 'Other'
}

export function earliestValidDate(rows) {
  const dates = rows.map(row => row.firstSeen).filter(value => value && Number.isFinite(Date.parse(value)))
  return dates.reduce((earliest, value) => !earliest || Date.parse(value) < Date.parse(earliest) ? value : earliest, null)
}

export function canonicalMentionUrl(value) {
  const href = safeExternalUrl(value)
  if (!href) return null
  const url = new URL(href)
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, '').replace(/^twitter\.com$/, 'x.com')
  if (['m.youtube.com', 'youtu.be', 'youtube.com'].includes(url.hostname)) {
    const id = url.hostname === 'youtu.be' ? url.pathname.split('/')[1] : url.searchParams.get('v') ?? url.pathname.match(/^\/(?:shorts|embed)\/([^/]+)/)?.[1]
    if (id) return 'https://youtube.com/watch?v=' + id
  }
  url.hash = ''
  for (const key of [...url.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$|ref$|source$|si$)/i.test(key)) url.searchParams.delete(key)
  url.searchParams.sort()
  url.pathname = url.pathname.replace(/\/$/, '') || '/'
  return url.href
}

export const uniqueMentionKey = value => canonicalMentionUrl(value) ?? Symbol('missing URL')

export function matchingEngagement(row, engagement) {
  const url = canonicalMentionUrl(row.url)
  return url ? engagement.find(item => canonicalMentionUrl(item.url) === url) : undefined
}

export function validCrawlDate(value) {
  if (!Number.isFinite(value)) return null
  const date = new Date(value * 1000)
  if (!Number.isFinite(date.valueOf())) return null
  const iso = date.toISOString()
  return /^\d{4}-\d{2}-\d{2}T/.test(iso) ? iso.slice(0, 10) : null
}
