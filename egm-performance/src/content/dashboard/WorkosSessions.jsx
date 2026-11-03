import React, { useEffect, useState, useSyncExternalStore } from 'react'
import { UserProfile, UserSecurity, UserSessions, WorkOsWidgets } from '@workos-inc/widgets'
import { Button, Dialog } from '../../data-app-public.jsx'
import { failureMessage, retryableStatus } from './request-errors.mjs'
import { getSessionWidgetToken, getAuthenticationSettings } from './workos-session-requests.mjs'
import '@radix-ui/themes/styles.css'
import '@workos-inc/widgets/styles.css'
import './workos-sessions.css'

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
  const [canRetry,setCanRetry]=useState(false)
  const [attempt,setAttempt]=useState(0)
  const [securityState, setSecurityState] = useState('loading')
  const colorScheme = useSyncExternalStore(subscribeAppearance, appearance, () => 'light')
  useEffect(() => {
    if (!open) { setRecord(null); setError(''); setCanRetry(false); setSecurityState('loading'); return }
    const controller = new AbortController()
    setRecord(null); setError(''); setCanRetry(false); setSecurityState('loading')
    getSessionWidgetToken(controller.signal).then(async value => {
      if (controller.signal.aborted) return
      setRecord(value)
      try {
        const settings=await getAuthenticationSettings(value.token,controller.signal)
        if (!controller.signal.aborted) setSecurityState(settings.mfaEnabled || settings.passwordAuthEnabled ? 'available' : 'none')
      } catch { if (!controller.signal.aborted) setSecurityState('unavailable') }
    }).catch(failure => { if (!controller.signal.aborted) {setError(failureMessage(failure,'Sessions are temporarily unavailable.'));setCanRetry(retryableStatus(failure.status))} })
    return () => controller.abort()
  }, [open,attempt])
  const authToken = async () => {
    const value = await getSessionWidgetToken()
    if (value.currentSessionId !== record?.currentSessionId) throw Error('Sign in again to manage your sessions.')
    return value.token
  }
  return <Dialog open={open} onClose={onClose} title="Account security" className="egm-workos-account">
    {!record && !error && <p role="status">Loading sessions…</p>}
    {error && <div role="alert"><p>{error}</p>{canRetry&&<Button onClick={()=>setAttempt(value=>value+1)}>Try again</Button>}</div>}
    {record && <><p>These account settings and sessions also apply to your other connected apps.</p><WorkOsWidgets theme={{ appearance: colorScheme, accentColor: 'blue' }}>{profileEnabled && <section aria-label="Profile"><h3>Profile</h3><UserProfile authToken={authToken} /></section>}{securityState === 'available' && <section aria-label="Security settings"><h3>Security settings</h3><UserSecurity authToken={authToken} /></section>}{securityState === 'unavailable' && <div><p role="status">Security settings are temporarily unavailable.</p><Button onClick={()=>setAttempt(value=>value+1)}>Try again</Button></div>}<section aria-label="Sessions"><h3>Sessions</h3><UserSessions authToken={authToken} currentSessionId={record.currentSessionId} /></section></WorkOsWidgets></>}
  </Dialog>
}
