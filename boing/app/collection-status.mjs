import { readJson } from './api.mjs'

const labels = { queued: 'Queued', running: 'Running', completed: 'Completed', failed: 'Failed', cancelled: 'Cancelled', expired: 'Expired' }
const sources = { github: 'GitHub', website: 'Website' }

export function createCollectionStatus({ status, list, refresh, document, request = fetch }) {
  let controller
  let selection
  function clear() {
    controller?.abort()
    selection = null
    status.textContent = ''
    list.replaceChildren()
    refresh.disabled = true
  }
  async function load(projectId, organizationId) {
    controller?.abort()
    selection = { projectId, organizationId }
    const active = new AbortController()
    controller = active
    status.textContent = 'Loading collection status…'
    list.replaceChildren()
    refresh.disabled = true
    try {
      const result = await readJson(`/api/boing/projects/${encodeURIComponent(projectId)}/collection-status`, { organizationId, request, signal: active.signal })
      if (active.signal.aborted) return
      if (!Array.isArray(result?.jobs) || result.jobs.length > 2 || result.jobs.some(job => !sources[job?.kind] || !labels[job?.status])) throw new Error('invalid response')
      if (!result.jobs.length) {
        status.textContent = 'No collection runs yet.'
      } else {
        status.textContent = 'Latest run for each source.'
        for (const job of result.jobs) {
          const item = document.createElement('li')
          const timestamp = job.finishedAt || job.createdAt
          const date = typeof timestamp === 'string' && Number.isFinite(Date.parse(timestamp)) ? new Date(timestamp).toLocaleString() : null
          item.textContent = `${sources[job.kind]}: ${labels[job.status]}${date ? ` · ${date}` : ''}`
          list.append(item)
        }
      }
    } catch {
      if (!active.signal.aborted) status.textContent = 'Could not load collection status. Try again.'
    } finally {
      if (!active.signal.aborted) refresh.disabled = false
    }
  }
  refresh.addEventListener('click', () => { if (selection) void load(selection.projectId, selection.organizationId) })
  return { clear, load, refresh: () => selection && load(selection.projectId, selection.organizationId) }
}
