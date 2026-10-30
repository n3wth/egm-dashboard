const endpoint = '/api/boing/platform/workspaces'

export async function adminRequest(request, input) {
  const response = await request(endpoint, input ? {
    method: 'POST', credentials: 'same-origin', cache: 'no-store',
    headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(input),
  } : { method: 'GET', credentials: 'same-origin', cache: 'no-store', headers: { accept: 'application/json' } })
  if (!response.ok) throw new Error(String(response.status))
  return response.json()
}

if (typeof document !== 'undefined') {
  const el = id => document.getElementById(id)
  const status = el('admin-status'), panel = el('admin-panel'), form = el('admin-form'), submit = el('admin-submit')
  adminRequest(fetch).then(result => {
    if (result?.available !== true) throw new Error('unavailable')
    status.textContent = ''
    panel.hidden = false
  }).catch(() => { status.textContent = 'Platform administration is unavailable for this account.' })
  form.addEventListener('submit', async event => {
    event.preventDefault()
    if (submit.disabled) return
    submit.disabled = true
    status.textContent = 'Creating workspace…'
    try {
      const result = await adminRequest(fetch, { name: el('admin-name').value.trim(), workosOrganizationId: el('admin-org').value.trim(), ownerUserId: el('admin-owner').value.trim(), ownerEmail: el('admin-email').value.trim() })
      if (!result?.workspace?.id || typeof result.workspace.name !== 'string') throw new Error('unavailable')
      status.textContent = `Created ${result.workspace.name}.`
      form.reset()
    } catch { status.textContent = 'Could not confirm workspace creation. Check whether it was created before trying again.' }
    finally { submit.disabled = false }
  })
}
