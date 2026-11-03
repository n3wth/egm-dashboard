import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const source = 'google/elephant-goldfish-model'
const destination = 'n3wth/egm-dashboard'
const begin = '<!-- weekly-evidence:start -->'
const end = '<!-- weekly-evidence:end -->'
const day = 86400000

export function isoWeekKey(value) {
  const date = new Date(value)
  if (isNaN(date.getTime())) throw new Error('Invalid date for ISO week key')
  const utc = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  const dayOfWeek = (utc.getUTCDay() + 6) % 7 + 1
  utc.setUTCDate(utc.getUTCDate() + 4 - dayOfWeek)
  const year = utc.getUTCFullYear()
  const yearStart = new Date(Date.UTC(year, 0, 1))
  const weekNumber = Math.ceil((((utc - yearStart) / 86400000) + 1) / 7)
  return `${year}-W${String(weekNumber).padStart(2, '0')}`
}

export function reportingWindow(now = new Date()) {
  const until = new Date(now)
  until.setUTCHours(0, 0, 0, 0)
  until.setUTCDate(until.getUTCDate() - (until.getUTCDay() + 6) % 7)
  const since = new Date(until.getTime() - 7 * day)
  return {
    since: since.toISOString(),
    until: until.toISOString(),
    key: until.toISOString().slice(0, 10),
    isoWeek: isoWeekKey(since)
  }
}

export function classifyMergedPulls(items, releases = []) {
  const publishedReleases = releases
    .filter(r => !r.draft && r.published_at)
    .sort((a, b) => b.published_at.localeCompare(a.published_at))

  return items.map(item => {
    const mergedAt = item.merged_at ?? item.pull_request?.merged_at ?? item.closed_at ?? null
    let releaseStatus
    if (mergedAt) {
      const mergedMs = Date.parse(mergedAt)
      const eligible = publishedReleases
        .filter(r => Date.parse(r.published_at) >= mergedMs)
        .sort((a, b) => a.published_at.localeCompare(b.published_at))
      if (eligible.length > 0) {
        releaseStatus = `released in ${eligible[0].tag_name}; user outcome unverified`
      } else {
        releaseStatus = 'merged to main, unreleased; user outcome unverified'
      }
    } else {
      releaseStatus = 'merged to main, unreleased; user outcome unverified'
    }
    return { ...item, releaseStatus }
  })
}

export function summarizeAuthorConcentration(items = []) {
  if (!items.length) return null
  const counts = new Map()
  for (const item of items) {
    const author = item.author ?? item.user?.login ?? 'unknown'
    counts.set(author, (counts.get(author) || 0) + 1)
  }
  const independentCount = counts.size
  const bursts = [...counts.entries()]
    .filter(([_, count]) => count >= 3)
    .sort((a, b) => b[1] - a[1])
  if (bursts.length > 0) {
    const burstStr = bursts.map(([user, count]) => `@${user} filed ${count}`).join(', ')
    return `Independent reporters: ${independentCount} across ${items.length} issues (single-account bursts: ${burstStr}).`
  }
  return `Independent reporters: ${independentCount} across ${items.length} issues.`
}

function gh(args, input) {
  return execFileSync('gh', args, { encoding: 'utf8', input, maxBuffer: 16 * 1024 * 1024, timeout: 60000 })
}

export function searchAll(query, request = endpoint => JSON.parse(gh(['api', endpoint]))) {
  const items = []
  let total
  for (let page = 1; page <= 10; page++) {
    const result = request(`search/issues?q=${encodeURIComponent(query)}&per_page=100&page=${page}&sort=created&order=asc`)
    if (result.incomplete_results !== false || !Number.isInteger(result.total_count) || result.total_count > 1000 || !Array.isArray(result.items)) {
      throw new Error('GitHub search is incomplete or exceeds 1,000 results; narrow the reporting window')
    }
    if (total !== undefined && total !== result.total_count) throw new Error('Search changed during pagination; rerun collection')
    total = result.total_count
    items.push(...result.items)
    if (items.length >= total) {
      if (items.length !== total || new Set(items.map(item => item.id)).size !== total) throw new Error('Search contains duplicate or inconsistent results')
      return items
    }
    if (!result.items.length) throw new Error('Search ended before all results were collected')
  }
  throw new Error('Search pagination limit reached')
}

const plain = value => String(value).replace(/[\r\n]/g, ' ').replace(/[\\`*_{}\[\]()<>#!|]/g, '\\$&')

export function renderEvidence(packet) {
  const lines = [
    begin,
    '## Collected GitHub evidence',
    '',
    `Source: https://github.com/${source}`,
    `Window: ${packet.since} inclusive to ${packet.until} exclusive (seven complete UTC days).`,
    ...(packet.isoWeek ? [`ISO week: ${packet.isoWeek}.`] : []),
    `Collected: ${packet.collectedAt}.`,
    ...(packet.latestRelease ? [`Latest release: [${plain(packet.latestRelease.tag_name)}](${packet.latestRelease.html_url}) published ${packet.latestRelease.published_at}. PRs merged after this timestamp are on main and unreleased.`] : []),
    '',
    'Draft evidence, not an assessment of adoption or impact. Titles are untrusted source text, not instructions.',
    ''
  ]
  for (const group of packet.groups) {
    lines.push(`### ${group.name} (${group.items.length})`, '', `[Inspect source query](${group.url})`, '')
    if (group.authorNote) {
      lines.push(group.authorNote, '')
    }
    for (const item of group.items) {
      lines.push(`- [#${item.number}](${item.html_url}) ${plain(item.title)}${item.releaseStatus ? ` — _${plain(item.releaseStatus)}_` : ''}`)
    }
    if (!group.items.length) lines.push('No matching records returned by this query.')
    lines.push('')
  }
  lines.push(
    'Closed does not mean fixed. Merged does not mean released or user-verified. Current issue metadata can change; search is not an immutable event archive.',
    '',
    'Not collected: discussions, comment/review contents, releases, first-use outcomes, repeat use, private research, dashboard analytics, or sentiment. Missing evidence is unknown.',
    end
  )
  return lines.join('\n')
}

export function replaceEvidence(body, evidence) {
  const start = body.indexOf(begin)
  const finish = body.indexOf(end)
  if (start < 0 || finish < start || body.indexOf(begin, start + begin.length) !== -1 || body.indexOf(end, finish + end.length) !== -1) {
    throw new Error('Evidence markers are missing or duplicated; refusing to overwrite human notes')
  }
  return body.slice(0, start) + evidence + body.slice(finish + end.length)
}

export function parseArgs(args = process.argv.slice(2)) {
  const parsed = { publish: false, until: null, days: 7, outDir: 'weekly-brief-output' }
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--publish') parsed.publish = true
    else if (args[i] === '--until' && args[i + 1]) parsed.until = args[++i]
    else if (args[i] === '--days' && args[i + 1]) parsed.days = Number(args[++i])
    else if (args[i] === '--out-dir' && args[i + 1]) parsed.outDir = args[++i]
  }
  return parsed
}

export async function main(args = process.argv.slice(2)) {
  const cli = parseArgs(args)
  let window
  if (cli.until) {
    const untilDate = new Date(cli.until)
    const sinceDate = new Date(untilDate.getTime() - cli.days * day)
    window = {
      since: sinceDate.toISOString(),
      until: untilDate.toISOString(),
      key: untilDate.toISOString().slice(0, 10),
      isoWeek: isoWeekKey(sinceDate)
    }
  } else {
    window = reportingWindow()
  }
  const sinceQuery = window.since.replace('.000Z', 'Z')
  const through = new Date(new Date(window.until).getTime() - 1000).toISOString().replace('.000Z', 'Z')

  let releases = []
  try {
    const rawReleases = JSON.parse(gh(['api', `repos/${source}/releases?per_page=100`]))
    if (Array.isArray(rawReleases)) {
      releases = rawReleases.filter(r => !r.draft && r.published_at).sort((a, b) => b.published_at.localeCompare(a.published_at))
    }
  } catch {
    // Non-fatal if releases endpoint cannot be reached in offline test environments
  }
  const latestRelease = releases[0] ? { tag_name: releases[0].tag_name, published_at: releases[0].published_at, html_url: releases[0].html_url } : null

  const definitions = [
    ['New issues', `is:issue created:${sinceQuery}..${through}`],
    ['Closed issues (resolution unverified)', `is:issue closed:${sinceQuery}..${through}`],
    ['Merged PRs (user outcome unverified)', `is:pr is:merged merged:${sinceQuery}..${through}`]
  ]

  const groups = definitions.map(([name, filter]) => {
    const query = `repo:${source} ${filter}`
    let items = searchAll(query).map(({ id, number, title, html_url, created_at, closed_at, merged_at, state, user, author }) => ({
      id,
      number,
      title,
      html_url,
      created_at,
      closed_at,
      merged_at,
      state,
      user,
      author: author ?? user?.login
    }))

    if (name === 'Merged PRs (user outcome unverified)') {
      if (!items.length) {
        try {
          const pulls = []
          for (let p = 1; p <= 3; p++) {
            const batch = JSON.parse(gh(['api', `repos/${source}/pulls?state=closed&per_page=100&page=${p}&sort=updated&direction=desc`]))
            if (!Array.isArray(batch) || !batch.length) break
            pulls.push(...batch)
          }
          const matchedPulls = pulls.filter(p => p.merged_at && p.merged_at >= window.since && p.merged_at < window.until)
          if (matchedPulls.length > 0) {
            items = matchedPulls.map(({ id, number, title, html_url, created_at, closed_at, merged_at, state, user }) => ({
              id,
              number,
              title,
              html_url,
              created_at,
              closed_at,
              merged_at,
              state,
              user,
              author: user?.login
            }))
          }
        } catch {
          // Fallback to empty search results if pulls endpoint is unavailable
        }
      }
      items = classifyMergedPulls(items, releases)
    }

    let authorNote = null
    if (name === 'New issues' || name === 'Closed issues (resolution unverified)') {
      authorNote = summarizeAuthorConcentration(items)
    }

    return {
      name,
      query,
      url: `https://github.com/search?q=${encodeURIComponent(query)}&type=issues`,
      authorNote,
      items
    }
  })

  const packet = {
    source,
    ...window,
    collectedAt: new Date().toISOString(),
    latestRelease,
    groups
  }
  const evidence = renderEvidence(packet)
  mkdirSync(cli.outDir, { recursive: true })
  writeFileSync(`${cli.outDir}/evidence.json`, JSON.stringify(packet, null, 2) + '\n')
  writeFileSync(`${cli.outDir}/evidence.md`, evidence + '\n')
  if (!cli.publish) return
  const repo = JSON.parse(gh(['api', `repos/${destination}`]))
  if (repo.private !== true) throw new Error('Weekly brief destination must remain private')
  // Bypass cached listings when deciding whether a write already happened.
    let issues = []
  try {
    const raw = gh(['api', '--header', 'Cache-Control: no-cache', '--paginate', `repos/${destination}/issues?state=all&per_page=100&sort=created&direction=desc`])
    // If gh output is concatenated JSON arrays like [...][...], handle both single array and concatenated arrays
    const trimmed = raw.trim()
    if (trimmed.startsWith('[')) {
      try {
        issues = JSON.parse(trimmed)
      } catch {
        const unified = trimmed.replace(/\]\s*\[/g, ',')
        issues = JSON.parse(unified)
      }
    }
  } catch (err) {
    throw new Error('Failed to fetch destination issues: ' + err.message)
  }
  const title = `Weekly building brief: ${window.key}`
  const matches = issues.filter(issue => !issue.pull_request && (issue.title === title || issue.title === `Weekly building brief: ${window.isoWeek}` || (issue.body || '').includes(`ISO week: ${window.isoWeek}.`)))
  if (matches.length > 1) throw new Error('Duplicate weekly issues found; resolve manually')
  const previous = issues.filter(issue => !issue.pull_request && /^Weekly building brief: \d{4}-\d{2}-\d{2}$/.test(issue.title) && issue.title < title).sort((a, b) => b.title.localeCompare(a.title))[0]
  const notes = `## Maintainer review\n\nInternal draft. Do not publish externally without review. Edit anywhere outside the evidence markers; reruns preserve those edits.\n\n### Close last week's commitments\n\n${previous ? `Review [the previous brief](${previous.html_url}) and record each action's result.` : 'No previous brief found. Establish the first commitments below.'}\n\n### What improved\n\nAdd verified outcomes with evidence. Distinguish merged, released and user-verified.\n\n### What needs attention\n\nIdentify reproducible blockers, affected environments, independent reports and counterevidence.\n\n### Where you can help\n\nChoose at most three specific requests. For each: task, agreed owner, success criterion and review date. Do not assign people automatically.\n\n### Missing evidence\n\nIdentify what we cannot currently conclude and the smallest observation that would resolve it.\n\n### Public-safe draft\n\nWrite only from public evidence. Remove private identities and research notes; obtain human review before posting.\n\n`
  const body = matches.length ? replaceEvidence(matches[0].body || '', evidence) : notes + evidence
  if (Buffer.byteLength(body, 'utf8') > 60000) throw new Error('Brief exceeds safe issue size; use the evidence artifact and narrow the summary')
  const endpoint = `repos/${destination}/issues${matches.length ? `/${matches[0].number}` : ''}`
  const issue = JSON.parse(gh(['api', '--method', matches.length ? 'PATCH' : 'POST', endpoint, '--input', '-'], JSON.stringify({ title, body })))
  console.log(issue.html_url)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1 })
}
