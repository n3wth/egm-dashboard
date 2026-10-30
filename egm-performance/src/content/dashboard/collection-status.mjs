const reasonText = {
  collection_window_ended: 'Collection window ended',
  monthly_cap: 'Monthly collection cap reached',
  schedule: 'Waiting for the next collection interval',
  failed: 'Failed'
}

export function collectionStatusLines(source, endsAt, now = Date.now()) {
  const ended = (endsAt && Date.parse(endsAt) <= now) || source.reason === 'collection_window_ended'
  const success = source.lastSuccessAt && Number.isFinite(Date.parse(source.lastSuccessAt))
    ? `Last success ${new Date(source.lastSuccessAt).toISOString().slice(0, 16).replace('T', ' ')} UTC`
    : 'No successful collection yet'
  const reason = ended ? 'Collection window ended' : reasonText[source.reason] ?? (source.status === 'failed' ? 'Failed' : null)
  return { success, reason }
}
