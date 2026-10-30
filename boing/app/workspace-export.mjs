import { readJson } from './api.mjs'

// This is a partial export, not a backup. The server verifies each project.
export function createWorkspaceExport({ document, anchor, request = fetch, makeUrl = URL.createObjectURL.bind(URL), revokeUrl = URL.revokeObjectURL.bind(URL), BlobClass = Blob } = {}) {
  const section = document.createElement('details')
  section.className = 'join-workspace'
  section.hidden = true
  const summary = document.createElement('summary')
  summary.textContent = 'Export workspace data'
  const description = document.createElement('p')
  description.textContent = 'Exports available data for active projects. Archived projects, older history, disconnected sources, members, invitations, audit records and provider data are omitted. Projects are read separately, so this is not a point-in-time backup.'
  const button = document.createElement('button')
  button.type = 'button'
  button.textContent = 'Download partial export'
  const status = document.createElement('p')
  status.setAttribute('role', 'status')
  status.setAttribute('aria-live', 'polite')
  section.append(summary, description, button, status)
  anchor?.after?.(section)
  let controller, organizationId
  function clear() {
    controller?.abort()
    controller = undefined
    organizationId = undefined
    section.hidden = true
    button.disabled = false
    status.textContent = ''
  }
  function show(id, role) {
    clear()
    if (role !== 'owner' || !/^[A-Za-z0-9_-]{1,128}$/.test(id ?? '')) return
    organizationId = id
    section.hidden = false
  }
  button.onclick = async () => {
    if (!organizationId || button.disabled || section.hidden) return
    const id = organizationId
    const active = new AbortController()
    controller = active
    button.disabled = true
    status.textContent = 'Preparing export…'
    try {
      const data = await readJson('/api/boing/workspace/export', { request, organizationId: id, signal: active.signal })
      if (active.signal.aborted || organizationId !== id) return
      if (data?.scope !== 'partial_workspace_export' || !Array.isArray(data.projects)) throw new Error('invalid response')
      const url = makeUrl(new BlobClass([JSON.stringify(data, null, 2)], { type: 'application/json' }))
      const link = document.createElement('a')
      link.href = url
      link.download = 'boing-workspace-partial-export.json'
      document.body.append(link)
      link.click()
      link.remove()
      setTimeout(() => revokeUrl(url), 1000)
      status.textContent = 'Your partial export is ready.'
    } catch (error) {
      if (!active.signal.aborted && organizationId === id) status.textContent = error?.status === 413 ? 'This workspace is too large to export here.' : 'Could not export this workspace. Check project access and try again.'
    } finally {
      if (!active.signal.aborted && organizationId === id) button.disabled = false
    }
  }
  return { clear, show, section, button, status }
}
