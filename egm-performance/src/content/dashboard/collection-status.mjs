const reasonText = {
  collection_window_ended: 'Collection window ended',
  monthly_cap: 'Monthly collection cap reached',
  schedule: 'Waiting for the next collection interval',
  failed: 'Failed',
  unconfigured: 'API key is not configured',
  credential_unavailable: 'API key is not configured'
}

export function formatObservedAt(iso, timeZone) {
  const date = new Date(iso)
  if (!Number.isFinite(date.getTime())) return null
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone
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
    return Boolean(source.lastSuccessAt) && lines.reason !== 'Failed' && lines.reason !== 'Collection window ended' && lines.reason !== 'API key is not configured'
  }).length
  return { healthy, total, label: `${healthy} of ${total} sources healthy` }
}
