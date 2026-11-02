import React, { useEffect, useRef, useState } from 'react'
import { Button, Dialog, Icon } from '../../data-app-public.jsx'
import { navbarIconSize } from './navbar-icons.mjs'
import {failureMessage,retryableStatus,statusMessage} from './request-errors.mjs'
import './feedback.css'
import {NavTooltip} from '../../data-app-public.jsx'

const UNAVAILABLE='Feedback is unavailable right now. Please try again later.'
const SEND_FAILED='Could not send feedback. Please try again.'
const httpError=(response,fallback)=>Object.assign(new Error(statusMessage(response.status,fallback)),{status:response.status})

export function Feedback() {
  const [open, setOpen] = useState(false)
  const [survey, setSurvey] = useState(null)
  const [kind, setKind] = useState('')
  const [message, setMessage] = useState('')
  const [sent, setSent] = useState(false)
  const [unavailable, setUnavailable] = useState(null)
  const [attempt, setAttempt] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const submission = useRef(null)
  const sending = useRef(false)

  function activity(event, iteration) {
    fetch('/api/feedback/activity', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: submission.current, event, surveyIteration: iteration ?? 0 }), keepalive: true }).catch(() => {})
  }

  useEffect(() => {
    if (!open) return undefined
    const controller = new AbortController()
    let timedOut = false
    // A request that never answers would leave the dialog loading forever.
    const timer = setTimeout(() => { timedOut = true; controller.abort() }, 10000)
    if (attempt === 0) { submission.current = crypto.randomUUID(); setMessage(''); setKind('') }
    setSurvey(null); setSent(false); setUnavailable(null); setBusy(false); setError('')
    fetch('/api/feedback', { credentials: 'same-origin', signal: controller.signal })
      .then(response => { if (!response.ok) throw httpError(response, UNAVAILABLE); return response.json() })
      .then(value => { if (!value || typeof value !== 'object') throw Error(UNAVAILABLE); setSurvey(value); activity('survey shown', value.current_iteration) })
      .catch(failure => { if (!controller.signal.aborted || timedOut) setUnavailable({ message: failureMessage(failure, UNAVAILABLE, { timedOut }), retry: retryableStatus(failure?.status) }) })
      .finally(() => clearTimeout(timer))
    return () => { clearTimeout(timer); controller.abort() }
  }, [open, attempt])

  function close() {
    if (busy) return
    if (survey && !sent) activity('survey dismissed', survey.current_iteration)
    setOpen(false)
  }
  async function submit(event) {
    event.preventDefault()
    // The ref blocks a second click before the busy state has re-rendered.
    if (!survey || !kind || !message.trim() || busy || sending.current) return
    sending.current = true
    setBusy(true); setError('')
    const controller = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; controller.abort() }, 15000)
    try {
      const response = await fetch('/api/feedback', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: submission.current, kind, message: message.trim(), surveyIteration: survey.current_iteration ?? 0 }), signal: controller.signal })
      if (!response.ok) throw httpError(response, SEND_FAILED)
    } catch (failure) { setError(failureMessage(failure, SEND_FAILED, { timedOut })); sending.current = false; setBusy(false); return } finally { clearTimeout(timer) }
    sending.current = false
    setSent(true)
    setBusy(false)
  }

  if (!import.meta.env.DEV && globalThis.location?.hostname !== 'egm.n3wth.com') return null
  return <>
    <NavTooltip label="Give feedback"><button type="button" className="dashboard-header-action-button egm-feedback-trigger" aria-label="Feedback" onClick={() => { setAttempt(0); setOpen(true) }}><Icon name="feedback" size={navbarIconSize}/></button></NavTooltip>
    <Dialog open={open} onClose={close} showClose={!busy} title="Give feedback" className="egm-form-dialog egm-feedback-dialog">
      {sent ? <div role="status"><p>Thanks for your feedback.</p><Button onClick={close}>Done</Button></div> : unavailable ? <div role="alert"><p>{unavailable.message}</p><div className="egm-feedback-actions"><Button onClick={close}>Close</Button>{unavailable.retry && <Button variant="primary" onClick={() => setAttempt(value => value + 1)}>Try again</Button>}</div></div> : !survey ? <p role="status">Loading feedback…</p> : <form onSubmit={submit}>
        <p>Tell us about a bug or suggest an improvement. Your feedback is sent to PostHog and connected review tools.</p>
        <fieldset><legend>What would you like to share?</legend><div className="egm-feedback-options">{['Bug report', 'Feature request'].map(value => <label key={value}><input type="radio" name="feedback-kind" value={value} checked={kind === value} onChange={() => setKind(value)} />{value}</label>)}</div></fieldset>
        <textarea className="egm-field" id="egm-feedback-message" aria-label="Tell us more" value={message} onChange={event => setMessage(event.target.value)} maxLength={2000} required rows={5} placeholder="Describe the problem or idea" />
        {error && <p role="alert">{error}</p>}
        <div className="egm-feedback-actions"><Button onClick={close} disabled={busy}>Cancel</Button><Button type="submit" variant="primary" disabled={busy || !kind || !message.trim()}>{busy ? 'Sending…' : 'Send feedback'}</Button></div>
      </form>}
    </Dialog>
  </>
}
