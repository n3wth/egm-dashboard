const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value)

export function createProjectArchive({ document, section, status, list, controls, message, archive, confirm, cancel, request = fetch, onChanged } = {}) {
  let controller, projectController, organizationId, role
  function clear() {
    controller?.abort()
    projectController?.abort()
    organizationId = null
    if (section) section.hidden = true
    if (controls) controls.hidden = true
    list?.replaceChildren()
    if (status) status.textContent = ''
    if (message) message.textContent = ''
  }
  async function load(org, userRole) {
    clear()
    if (!section || !status || !list || !id(org) || userRole !== 'owner') return
    organizationId = org; role = userRole
    controller = new AbortController()
    const active = controller
    section.hidden = false
    status.textContent = 'Loading archived projects…'
    try {
      const response = await request('/api/boing/projects/archived', { credentials: 'same-origin', cache: 'no-store', signal: active.signal, headers: { accept: 'application/json', 'x-boing-organization': org } })
      if (!response.ok) throw Error('unavailable')
      const data = await response.json()
      if (active.signal.aborted) return
      if (!Array.isArray(data?.projects) || data.projects.some(project => !id(project?.id) || typeof project.name !== 'string')) throw Error('invalid response')
      status.textContent = data.truncated ? 'Only the first 100 archived projects are shown.' : data.projects.length ? '' : 'No archived projects.'
      for (const project of data.projects) {
        const row = document.createElement('div')
        row.className = 'workspace-member'
        const label = document.createElement('span')
        label.textContent = project.name
        const button = document.createElement('button')
        button.type = 'button'; button.textContent = 'Restore'
        button.onclick = async () => {
          if (active.signal.aborted || button.disabled) return
          button.disabled = true; status.textContent = 'Restoring project…'
          try {
            const response = await request(`/api/boing/projects/${encodeURIComponent(project.id)}/restore`, { method: 'POST', credentials: 'same-origin', cache: 'no-store', signal: active.signal, headers: { accept: 'application/json', 'x-boing-organization': org } })
            if (!response.ok || (await response.json())?.restored !== true) throw Error('unavailable')
            if (!active.signal.aborted) await onChanged(project.id)
          } catch { if (!active.signal.aborted) { status.textContent = 'Could not restore the project. Try again.'; button.disabled = false } }
        }
        row.append(label, button); list.append(row)
      }
    } catch { if (!active.signal.aborted) status.textContent = 'Could not load archived projects. Select the workspace again to retry.' }
  }
  function select(project) {
    projectController?.abort()
    if (!controls || !message || !archive || !confirm || !cancel) return
    controls.hidden = !id(project?.id) || !organizationId || role !== 'owner'
    message.textContent = ''
    archive.hidden = false; confirm.hidden = true; cancel.hidden = true
    archive.disabled = false; confirm.disabled = false; cancel.disabled = false
    if (controls.hidden) return
    projectController = new AbortController()
    const active = projectController, org = organizationId
    archive.onclick = () => { archive.hidden = true; confirm.hidden = false; cancel.hidden = false; message.textContent = `Archive ${project.name}? Data remains stored, and old snapshots will be unavailable after restoration.` }
    cancel.onclick = () => { archive.hidden = false; confirm.hidden = true; cancel.hidden = true; message.textContent = '' }
    confirm.onclick = async () => {
      if (active.signal.aborted || confirm.disabled) return
      confirm.disabled = true; cancel.disabled = true; message.textContent = 'Archiving project…'
      try {
        const response = await request(`/api/boing/projects/${encodeURIComponent(project.id)}/archive`, { method: 'POST', credentials: 'same-origin', cache: 'no-store', signal: active.signal, headers: { accept: 'application/json', 'x-boing-organization': org } })
        if (!response.ok || (await response.json())?.archived !== true) throw Error('unavailable')
        if (!active.signal.aborted) await onChanged()
      } catch { if (!active.signal.aborted) { message.textContent = 'Could not archive the project. Try again.'; confirm.disabled = false; cancel.disabled = false } }
    }
  }
  return { clear, load, select }
}
