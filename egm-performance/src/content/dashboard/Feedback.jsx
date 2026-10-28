import React, { useEffect, useRef, useState } from 'react'
import { Button, Dialog } from '../../data-app-public.jsx'
import './feedback.css'

export function Feedback() {
  const [open, setOpen] = useState(false)
  const [survey, setSurvey] = useState(null)
  const [kind, setKind] = useState('')
  const [message, setMessage] = useState('')
  const [sent, setSent] = useState(false)
  const [unavailable, setUnavailable] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const submission = useRef(null)

  function activity(event, iteration) {
    fetch('/api/feedback/activity', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: submission.current, event, surveyIteration: iteration ?? 0 }), keepalive: true }).catch(() => {})
  }

  useEffect(() => {
    if (!open) return undefined
    const controller = new AbortController()
    submission.current = crypto.randomUUID()
    setSurvey(null); setSent(false); setUnavailable(false); setMessage(''); setKind(''); setBusy(false); setError('')
    fetch('/api/feedback', { credentials: 'same-origin', signal: controller.signal })
      .then(response => { if (!response.ok) throw Error(); return response.json() })
      .then(value => { setSurvey(value); activity('survey shown', value.current_iteration) })
      .catch(() => { if (!controller.signal.aborted) setUnavailable(true) })
    return () => controller.abort()
  }, [open])

  function close() {
    if (busy) return
    if (survey && !sent) activity('survey dismissed', survey.current_iteration)
    setOpen(false)
  }
  async function submit(event) {
    event.preventDefault()
    if (!survey || !kind || !message.trim() || busy) return
    setBusy(true); setError('')
    try {
      const response = await fetch('/api/feedback', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: submission.current, kind, message: message.trim(), surveyIteration: survey.current_iteration ?? 0 }) })
      if (!response.ok) throw Error('Could not send feedback. Please try again.')
    } catch { setError('Could not send feedback. Please try again.'); setBusy(false); return }
    setSent(true)
    setBusy(false)
  }

  if (!import.meta.env.DEV && globalThis.location?.hostname !== 'egm.n3wth.com') return null
  return <>
    <button type="button" className="dashboard-header-action-button egm-feedback-trigger" onClick={() => setOpen(true)}>Feedback</button>
    <Dialog open={open} onClose={close} showClose={!busy} title="Give feedback" className="egm-feedback-dialog">
      {sent ? <div role="status"><p>Thanks for your feedback.</p><Button onClick={close}>Done</Button></div> : unavailable ? <p role="alert">Feedback is unavailable right now. Please try again later.</p> : !survey ? <p role="status">Loading feedback…</p> : <form onSubmit={submit}>
        <p>Tell us about a bug or suggest an improvement. Your feedback is sent to PostHog and connected review tools.</p>
        <fieldset><legend>What would you like to share?</legend><div className="egm-feedback-options">{['Bug report', 'Feature request'].map(value => <label key={value}><input type="radio" name="feedback-kind" value={value} checked={kind === value} onChange={() => setKind(value)} />{value}</label>)}</div></fieldset>
        <label htmlFor="egm-feedback-message">Tell us more</label><textarea id="egm-feedback-message" value={message} onChange={event => setMessage(event.target.value)} maxLength={2000} required rows={5} placeholder="Describe the problem or idea" />
        {error && <p role="alert">{error}</p>}
        <div className="egm-feedback-actions"><Button onClick={close} disabled={busy}>Cancel</Button><Button type="submit" variant="primary" disabled={busy || !kind || !message.trim()}>{busy ? 'Sending…' : 'Send feedback'}</Button></div>
      </form>}
    </Dialog>
  </>
}
