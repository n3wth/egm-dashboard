export async function loadAccount({ request = fetch, email, retry, signIn } = {}) {
  retry.hidden = true
  if (signIn) signIn.hidden = true
  email.textContent = 'Loading account…'
  try {
    const response = await request('/api/boing/account', { method: 'GET', credentials: 'same-origin', cache: 'no-store', headers: { accept: 'application/json' } })
    if (response.status === 401) {
      email.textContent = 'Your session has ended. Sign in to view your account.'
      if (signIn) signIn.hidden = false
      return
    }
    if (!response.ok) throw new Error('unavailable')
    const account = await response.json()
    if (typeof account?.email !== 'string' || account.email.length > 320 || !account.email.includes('@')) throw new Error('invalid account')
    email.textContent = account.email
  } catch {
    email.textContent = 'Could not load your account. Please try again.'
    retry.hidden = false
  }
}

if (typeof document !== 'undefined') {
  const email = document.getElementById('account-email')
  const retry = document.getElementById('account-retry')
  const signIn = document.getElementById('account-signin')
  const load = () => loadAccount({ email, retry, signIn })
  retry.addEventListener('click', load)
  void load()
  void fetch('/api/boing/platform/workspaces', { credentials: 'same-origin', cache: 'no-store' })
    .then(response => { if (response.ok) document.getElementById('platform-admin-link').hidden = false })
    .catch(() => {})
}
