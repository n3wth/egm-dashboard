export function createWorkspaceAudit({ section, status, list, document, request = fetch } = {}) {
  let controller
  function clear() {
    controller?.abort()
    if (!section || !status || !list) return
    section.hidden = true
    status.textContent = ''
    list.replaceChildren()
  }
  async function load(organizationId, role) {
    clear()
    if (!section || !status || !list || role !== 'owner') return
    controller = new AbortController()
    const active = controller
    section.hidden = false
    status.textContent = 'Loading activity…'
    try {
      const response = await request('/api/boing/audit', { credentials: 'same-origin', cache: 'no-store', signal: active.signal, headers: { accept: 'application/json', 'x-boing-organization': organizationId } })
      if (!response.ok) throw new Error('unavailable')
      const data = await response.json()
      if (active.signal.aborted) return
      if (!Array.isArray(data.events)) throw new Error('invalid response')
      for (const event of data.events) {
        const row = document.createElement('div')
        row.className = 'workspace-member'
        const label = document.createElement('span')
        const action = typeof event.action === 'string' ? event.action.replaceAll('.', ' ').replaceAll('_', ' ') : 'Activity'
        const date = new Date(event.occurred_at)
        label.textContent = `${action} · ${event.actor_id || 'system'} · ${Number.isNaN(date.getTime()) ? 'date unavailable' : date.toLocaleString()}`
        row.append(label)
        list.append(row)
      }
      status.textContent = data.events.length ? (data.truncated ? 'Showing the latest 50 events.' : '') : 'No recorded activity.'
    } catch { if (!active.signal.aborted) status.textContent = 'Could not load activity. Select the workspace again to retry.' }
  }
  return { clear, load }
}
