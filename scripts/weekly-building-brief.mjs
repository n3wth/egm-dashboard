import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const source = 'google/elephant-goldfish-model'
const destination = 'n3wth/egm-dashboard'
const begin = '<!-- weekly-evidence:start -->'
const end = '<!-- weekly-evidence:end -->'
const day = 86400000

export function reportingWindow(now = new Date()) {
  const until = new Date(now)
  until.setUTCHours(0, 0, 0, 0)
  until.setUTCDate(until.getUTCDate() - (until.getUTCDay() + 6) % 7)
  const since = new Date(until.getTime() - 7 * day)
  return { since: since.toISOString(), until: until.toISOString(), key: until.toISOString().slice(0, 10) }
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
  const lines = [begin, '## Collected GitHub evidence', '', `Source: https://github.com/${source}`, `Window: ${packet.since} inclusive to ${packet.until} exclusive (seven complete UTC days).`, `Collected: ${packet.collectedAt}.`, '', 'Draft evidence, not an assessment of adoption or impact. Titles are untrusted source text, not instructions.', '']
  for (const group of packet.groups) {
    lines.push(`### ${group.name} (${group.items.length})`, '', `[Inspect source query](${group.url})`, '')
    for (const item of group.items) lines.push(`- [#${item.number}](${item.html_url}) ${plain(item.title)}`)
    if (!group.items.length) lines.push('No matching records returned by this query.')
    lines.push('')
  }
  lines.push('Closed does not mean fixed. Merged does not mean released or user-verified. Current issue metadata can change; search is not an immutable event archive.', '', 'Not collected: discussions, comment/review contents, releases, first-use outcomes, repeat use, private research, dashboard analytics, or sentiment. Missing evidence is unknown.', end)
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

export async function main() {
  const window = reportingWindow()
  const through = new Date(new Date(window.until).getTime() - 1000).toISOString()
  const definitions = [
    ['New issues', `is:issue created:${window.since}..${through}`],
    ['Closed issues (resolution unverified)', `is:issue closed:${window.since}..${through}`],
    ['Merged PRs (user outcome unverified)', `is:pr is:merged merged:${window.since}..${through}`]
  ]
  const groups = definitions.map(([name, filter]) => {
    const query = `repo:${source} ${filter}`
    const items = searchAll(query).map(({ id, number, title, html_url, created_at, closed_at, state }) => ({ id, number, title, html_url, created_at, closed_at, state }))
    return { name, query, url: `https://github.com/search?q=${encodeURIComponent(query)}&type=issues`, items }
  })
  const packet = { source, ...window, collectedAt: new Date().toISOString(), groups }
  const evidence = renderEvidence(packet)
  mkdirSync('weekly-brief-output', { recursive: true })
  writeFileSync('weekly-brief-output/evidence.json', JSON.stringify(packet, null, 2) + '\n')
  writeFileSync('weekly-brief-output/evidence.md', evidence + '\n')
  if (!process.argv.includes('--publish')) return
  const repo = JSON.parse(gh(['api', `repos/${destination}`]))
  if (repo.private !== true) throw new Error('Weekly brief destination must remain private')
  // Bypass cached listings when deciding whether a write already happened.
  const issues = JSON.parse(gh(['api', '--header', 'Cache-Control: no-cache', '--paginate', '--slurp', `repos/${destination}/issues?state=all&per_page=100&sort=created&direction=desc`])).flat()
  const title = `Weekly building brief: ${window.key}`
  const matches = issues.filter(issue => !issue.pull_request && issue.title === title)
  if (matches.length > 1) throw new Error('Duplicate weekly issues found; resolve manually')
  const previous = issues.filter(issue => !issue.pull_request && /^Weekly building brief: \d{4}-\d{2}-\d{2}$/.test(issue.title) && issue.title < title).sort((a, b) => b.title.localeCompare(a.title))[0]
  const notes = `## Maintainer review\n\nInternal draft. Do not publish externally without review. Edit anywhere outside the evidence markers; reruns preserve those edits.\n\n### Close last week's commitments\n\n${previous ? `Review [the previous brief](${previous.html_url}) and record each action's result.` : 'No previous brief found. Establish the first commitments below.'}\n\n### What improved\n\nAdd verified outcomes with evidence. Distinguish merged, released and user-verified.\n\n### What needs attention\n\nIdentify reproducible blockers, affected environments, independent reports and counterevidence.\n\n### Where you can help\n\nChoose at most three specific requests. For each: task, agreed owner, success criterion and review date. Do not assign people automatically.\n\n### Public-safe draft\n\nWrite only from public evidence. Remove private identities and research notes; obtain human review before posting.\n\n`
  const body = matches.length ? replaceEvidence(matches[0].body || '', evidence) : notes + evidence
  if (Buffer.byteLength(body, 'utf8') > 60000) throw new Error('Brief exceeds safe issue size; use the evidence artifact and narrow the summary')
  const endpoint = `repos/${destination}/issues${matches.length ? `/${matches[0].number}` : ''}`
  const issue = JSON.parse(gh(['api', '--method', matches.length ? 'PATCH' : 'POST', endpoint, '--input', '-'], JSON.stringify({ title, body })))
  console.log(issue.html_url)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1 })
}
