import { readJson } from './api.mjs'

const metrics = [
  ['github', 'stars', 'GitHub stars'], ['github', 'forks', 'GitHub forks'],
  ['github', 'openIssues', 'Open issues and pull requests'], ['github', 'views', 'Repository views (reporting window)'],
  ['github', 'clones', 'Repository clones (reporting window)'], ['website', 'performanceScore', 'Website performance'],
]

export function createProjectHistory({ section, status, charts, document, request = fetch } = {}) {
  let controller
  function clear() {
    controller?.abort()
    if (!section || !status || !charts) return
    section.hidden = true
    status.textContent = ''
    charts.replaceChildren()
  }
  async function load(projectId, organizationId) {
    clear()
    if (!section || !status || !charts) return
    controller = new AbortController()
    const active = controller
    section.hidden = false
    status.textContent = 'Loading history…'
    try {
      const data = await readJson(`/api/boing/projects/${encodeURIComponent(projectId)}/history`, { organizationId, signal: active.signal, request })
      if (active.signal.aborted) return
      if (!Array.isArray(data?.history)) throw new Error('invalid history')
      const rows = data.history.filter(row => ['github', 'website'].includes(row?.kind) && /^\d{4}-\d{2}-\d{2}$/.test(row.day ?? '') && row.metrics && typeof row.metrics === 'object')
      if (!rows.length) { status.textContent = 'No stored history yet. Observations will appear after collection.'; return }
      for (const [kind, key, title] of metrics) {
        const observations = rows.filter(row => row.kind === kind).sort((a, b) => a.day.localeCompare(b.day)).slice(-30)
        if (!observations.length) continue
        const card = document.createElement('div')
        card.className = 'history-chart'
        const heading = document.createElement('h4')
        heading.textContent = title
        card.append(heading)
        const maximum = Math.max(0, ...observations.map(row => typeof row.metrics[key] === 'number' && Number.isFinite(row.metrics[key]) && row.metrics[key] >= 0 ? row.metrics[key] : 0))
        for (const row of observations) {
          const value = row.metrics[key]
          const valid = typeof value === 'number' && Number.isFinite(value) && value >= 0
          const item = document.createElement('div')
          item.className = 'history-row'
          const day = document.createElement('time')
          day.textContent = row.day
          day.dateTime = row.day
          const track = document.createElement('span')
          track.className = 'history-track'
          track.setAttribute('aria-hidden', 'true')
          const bar = document.createElement('span')
          bar.className = 'history-bar'
          bar.style.width = valid && maximum ? `${Math.min(100, value / maximum * 100)}%` : '0%'
          track.append(bar)
          const amount = document.createElement('span')
          amount.textContent = valid ? value.toLocaleString() : 'Unavailable'
          item.append(day, track, amount)
          card.append(item)
        }
        charts.append(card)
      }
      status.textContent = charts.children.length ? 'Latest 30 observations per source. Missing values are unavailable; days without a collection are not shown.' : 'No supported history is available.'
    } catch { if (!active.signal.aborted) status.textContent = 'Could not load history. Refresh the project to try again.' }
  }
  return { clear, load }
}
