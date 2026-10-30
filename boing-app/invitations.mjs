// Invitation management never creates or sends invitations while delivery is gated.
export function createWorkspaceInvitations({ section, status, list, document, request = fetch } = {}) {
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
    const headers = { accept: 'application/json', 'x-boing-organization': organizationId }
    section.hidden = false
    status.textContent = 'Loading invitations…'
    try {
      const response = await request('/api/boing/invitations', { credentials: 'same-origin', cache: 'no-store', signal: active.signal, headers })
      if (!response.ok) throw new Error('unavailable')
      const data = await response.json()
      if (active.signal.aborted) return
      if (!Array.isArray(data?.invitations)) throw new Error('invalid response')
      const rows = data.invitations.filter(invite => /^[A-Za-z0-9_-]{1,128}$/.test(invite?.id ?? '') && typeof invite.email === 'string' && ['admin', 'member'].includes(invite.role) && ['pending', 'accepted', 'revoked', 'expired'].includes(invite.status))
      status.textContent = rows.length ? '' : 'No recorded invitations.'
      for (const invite of rows) {
        const row = document.createElement('div')
        row.className = 'workspace-member'
        const label = document.createElement('span')
        label.textContent = `${invite.email} · ${invite.role} · ${invite.status}`
        row.append(label)
        if (invite.status === 'pending') {
          const revoke = document.createElement('button')
          revoke.type = 'button'
          revoke.textContent = 'Revoke Boing invitation'
          const confirm = document.createElement('button')
          confirm.type = 'button'
          confirm.hidden = true
          confirm.textContent = 'Confirm revoke'
          const cancel = document.createElement('button')
          cancel.type = 'button'
          cancel.hidden = true
          cancel.textContent = 'Cancel'
          revoke.onclick = () => { revoke.hidden = true; confirm.hidden = false; cancel.hidden = false; status.textContent = `Revoke the Boing invitation for ${invite.email}? This does not revoke any WorkOS invitation.` }
          cancel.onclick = () => { revoke.hidden = false; confirm.hidden = true; cancel.hidden = true; status.textContent = '' }
          confirm.onclick = async () => {
            if (active.signal.aborted || confirm.disabled) return
            confirm.disabled = true
            cancel.disabled = true
            status.textContent = 'Revoking invitation…'
            try {
              const result = await request(`/api/boing/invitations/${encodeURIComponent(invite.id)}/revoke`, {
                method: 'POST', credentials: 'same-origin', cache: 'no-store', signal: active.signal,
                headers: { ...headers, 'content-type': 'application/json' }, body: '{}',
              })
              if (!result.ok || (await result.json())?.revoked !== true) throw new Error('unavailable')
              if (!active.signal.aborted) await load(organizationId, role)
            } catch {
              if (!active.signal.aborted) { status.textContent = 'Could not revoke the invitation. Select the workspace again to retry.'; confirm.disabled = false; cancel.disabled = false }
            }
          }
          row.append(revoke, confirm, cancel)
        }
        list.append(row)
      }
    } catch { if (!active.signal.aborted) status.textContent = 'Could not load invitations. Select the workspace again to retry.' }
  }
  return { clear, load }
}
