const reasonText = {
  collection_window_ended: 'Collection window ended',
  monthly_cap: 'Monthly collection cap reached',
  schedule: 'Waiting for the next collection interval',
  failed: 'Failed',
  unconfigured: 'API key is not configured',
  credential_unavailable: 'API key is not configured'
}

export function formatObservedAt(iso, timeZone='America/Los_Angeles') {
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
  const ended = (endsAt && Date.parse(endsAt) <= now) || source.reason === 'collection_window_ended'
  const observed = source.lastSuccessAt && formatObservedAt(source.lastSuccessAt, timeZone)
  const success = observed ? `Last success ${observed}` : 'No successful collection yet'
  const reason = ended ? 'Collection window ended' : reasonText[source.reason] ?? (source.status === 'failed' ? 'Failed' : null)
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
