// Workspace controls are presentational only; the server verifies every action.
export function createWorkspaceMembers({ section, status, list, document, request = fetch } = {}) {
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
    status.textContent = 'Loading members…'
    try {
      const options = { credentials: 'same-origin', cache: 'no-store', signal: active.signal, headers: { accept: 'application/json', 'x-boing-organization': organizationId } }
      const [membersResponse, accountResponse] = await Promise.all([
        request('/api/boing/members', options),
        request('/api/boing/account', { credentials: 'same-origin', cache: 'no-store', signal: active.signal, headers: { accept: 'application/json' } }),
      ])
      if (!membersResponse.ok || !accountResponse.ok) throw new Error('unavailable')
      const [members, account] = await Promise.all([membersResponse.json(), accountResponse.json()])
      if (active.signal.aborted) return
      if (!Array.isArray(members?.members) || typeof account?.email !== 'string') throw new Error('invalid response')
      if (members.truncated) { status.textContent = 'Too many members to manage here.'; return }
      const rows = members.members.filter(member => /^user_[A-Za-z0-9]+$/.test(member?.user_id ?? '') && typeof member.email === 'string' && ['owner', 'admin', 'member'].includes(member.role))
      status.textContent = rows.length ? '' : 'No active members.'
      for (const member of rows) {
        const row = document.createElement('div')
        row.className = 'workspace-member'
        const label = document.createElement('span')
        label.textContent = `${member.email} · ${member.role}`
        row.append(label)
        if (member.email.toLowerCase() !== account.email.toLowerCase()) {
          const remove = document.createElement('button')
          remove.type = 'button'
          remove.textContent = 'Remove access'
          const confirm = document.createElement('button')
          confirm.type = 'button'
          confirm.hidden = true
          confirm.textContent = 'Confirm removal'
          const cancel = document.createElement('button')
          cancel.type = 'button'
          cancel.hidden = true
          cancel.textContent = 'Cancel'
          remove.onclick = () => { remove.hidden = true; confirm.hidden = false; cancel.hidden = false; status.textContent = `Remove ${member.email} from this Boing workspace? WorkOS access stays unchanged.` }
          cancel.onclick = () => { remove.hidden = false; confirm.hidden = true; cancel.hidden = true; status.textContent = '' }
          confirm.onclick = async () => {
            if (active.signal.aborted || confirm.disabled) return
            confirm.disabled = true
            cancel.disabled = true
            status.textContent = 'Removing access…'
            try {
              const response = await request(`/api/boing/members/${encodeURIComponent(member.user_id)}/revoke`, {
                method: 'POST', credentials: 'same-origin', cache: 'no-store', signal: active.signal,
                headers: { accept: 'application/json', 'x-boing-organization': organizationId },
              })
              if (!response.ok || (await response.json())?.revoked !== true) throw new Error('unavailable')
              if (active.signal.aborted) return
              await load(organizationId, role)
            } catch {
              if (!active.signal.aborted) { status.textContent = 'Could not remove access. Refresh and try again.'; confirm.disabled = false; cancel.disabled = false }
            }
          }
          row.append(remove, confirm, cancel)
        }
        list.append(row)
      }
    } catch { if (!active.signal.aborted) status.textContent = 'Could not load members. Select the workspace again to retry.' }
  }
  return { clear, load }
}
