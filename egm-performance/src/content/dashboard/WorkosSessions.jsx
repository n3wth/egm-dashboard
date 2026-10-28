import React, { useEffect, useState, useSyncExternalStore } from 'react'
import { UserProfile, UserSecurity, UserSessions, WorkOsWidgets } from '@workos-inc/widgets'
import { Dialog } from '../../data-app-public.jsx'
import '@radix-ui/themes/styles.css'
import '@workos-inc/widgets/styles.css'
import './workos-sessions.css'

async function getSessionWidgetToken(signal) {
  const response = await fetch('/api/workos-widget-token', { method: 'POST', credentials: 'same-origin', signal })
  if (!response.ok) throw Error(response.status === 401 ? 'Sign in again to manage your sessions.' : 'Sessions are temporarily unavailable.')
  const value = await response.json()
  if (typeof value.token !== 'string' || !value.token || typeof value.currentSessionId !== 'string' || !value.currentSessionId) throw Error('Sessions are temporarily unavailable.')
  return value
}

const appearance = () => globalThis.document?.documentElement?.dataset.colorScheme === 'dark' ? 'dark' : 'light'
function subscribeAppearance(notify) {
  const root = globalThis.document?.documentElement
  if (!root || typeof MutationObserver === 'undefined') return () => {}
  const observer = new MutationObserver(notify)
  observer.observe(root, { attributes: true, attributeFilter: ['data-color-scheme'] })
  return () => observer.disconnect()
}

// Personal WorkOS sessions are independent of dashboard editing privileges.
// Tokens are short-lived, user-scoped, and never placed in storage or URLs.
export function WorkosSessions({ open, onClose, profileEnabled = false }) {
  const [record, setRecord] = useState(null)
  const [error, setError] = useState('')
  const [securityState, setSecurityState] = useState('loading')
  const colorScheme = useSyncExternalStore(subscribeAppearance, appearance, () => 'light')
  useEffect(() => {
    if (!open) { setRecord(null); setError(''); setSecurityState('loading'); return }
    const controller = new AbortController()
    setRecord(null); setError(''); setSecurityState('loading')
    getSessionWidgetToken(controller.signal).then(async value => {
      if (controller.signal.aborted) return
      setRecord(value)
      try {
        const response = await fetch('https://api.workos.com/client/graphql', { method: 'POST', headers: { authorization: `Bearer ${value.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ query: 'query AuthenticationSettings { authenticationSettings { mfaEnabled passwordAuthEnabled } }' }), signal: controller.signal, credentials: 'omit', cache: 'no-store' })
        if (!response.ok) throw Error('unavailable')
        const data = await response.json(), settings = data?.data?.authenticationSettings
        if (data?.errors?.length || typeof settings?.mfaEnabled !== 'boolean' || typeof settings?.passwordAuthEnabled !== 'boolean') throw Error('unavailable')
        if (!controller.signal.aborted) setSecurityState(settings.mfaEnabled || settings.passwordAuthEnabled ? 'available' : 'none')
      } catch { if (!controller.signal.aborted) setSecurityState('unavailable') }
    }).catch(failure => { if (!controller.signal.aborted) setError(failure.message) })
    return () => controller.abort()
  }, [open])
  const authToken = async () => {
    const value = await getSessionWidgetToken()
    if (value.currentSessionId !== record?.currentSessionId) throw Error('Sign in again to manage your sessions.')
    return value.token
  }
  return <Dialog open={open} onClose={onClose} title="Account security" className="egm-workos-account">
    {!record && !error && <p role="status">Loading sessions…</p>}
    {error && <p role="alert">{error}</p>}
    {record && <><p>These account settings and sessions also apply to your other connected apps.</p><WorkOsWidgets theme={{ appearance: colorScheme, accentColor: 'blue' }}>{profileEnabled && <section aria-label="Profile"><h3>Profile</h3><UserProfile authToken={authToken} /></section>}{securityState === 'available' && <section aria-label="Security settings"><h3>Security settings</h3><UserSecurity authToken={authToken} /></section>}{securityState === 'unavailable' && <p role="status">Security settings are temporarily unavailable.</p>}<section aria-label="Sessions"><h3>Sessions</h3><UserSessions authToken={authToken} currentSessionId={record.currentSessionId} /></section></WorkOsWidgets></>}
  </Dialog>
}
