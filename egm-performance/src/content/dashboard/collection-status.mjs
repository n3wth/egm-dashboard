const reasonText = {
  collection_window_ended: 'Collection window ended',
  monthly_cap: 'Monthly collection cap reached',
  schedule: 'Waiting for the next collection interval',
  failed: 'Failed',
  unconfigured: 'API key is not configured',
  credential_unavailable: 'API key is not configured'
}

export function formatObservedAt(iso, timeZone='America/Los_Angeles') {
  if(typeof iso!=='string'||!iso.trim())return null
  const date = new Date(iso)
  if (!Number.isFinite(date.getTime())) return null
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone,
    timeZoneName:'short'
  }).format(date)
}

export function collectionStatusLines(source, endsAt, now = Date.now(), timeZone) {
  const sourceEndsAt=Object.hasOwn(source,'collectionEndsAt')?source.collectionEndsAt:endsAt
  const ended = (sourceEndsAt && Date.parse(sourceEndsAt) <= now) || source.reason === 'collection_window_ended'
  const observed = source.lastSuccessAt && formatObservedAt(source.lastSuccessAt, timeZone)
  const success = observed ? `Last success ${observed}` : 'No successful collection yet'
  const stale=Number.isFinite(Date.parse(source.lastSuccessAt))&&now-Date.parse(source.lastSuccessAt)>=36*3600000
  const blocked=source.status==='failed'||['monthly_cap','unconfigured','credential_unavailable'].includes(source.reason)
  const reason = ended ? 'Collection window ended' : !blocked&&stale?'Stored data is more than 36 hours old':reasonText[source.reason] ?? (source.status === 'failed' ? 'Failed' : null)
  return { success, reason }
}

export function collectionSummary(sources, endsAt, now = Date.now()) {
  const total = sources.length
  const healthy = sources.filter(source => {
    const lines = collectionStatusLines(source, endsAt, now)
    const age=now-Date.parse(source.lastSuccessAt)
    return Number.isFinite(age)&&age>=0&&age<36*3600000&&!['Failed','Collection window ended','API key is not configured','Monthly collection cap reached'].includes(lines.reason)
  }).length
  return { healthy, total, label: `${healthy} of ${total} sources healthy` }
}
