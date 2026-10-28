export function dateSpan(rows) {
  const format = value => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
    const date = new Date(`${value}T12:00:00Z`)
    if (!Number.isFinite(date.valueOf()) || date.toISOString().slice(0, 10) !== value) return null
    return new Intl.DateTimeFormat('en-US', {month:'short', day:'numeric', timeZone:'UTC'}).format(date)
  }
  const first = format(rows[0]?.date), last = format(rows.at(-1)?.date)
  return first && last ? `${first}–${last}` : 'Unavailable'
}

export function ratio(numerator, denominator) {
  return Number.isFinite(numerator) && Number.isFinite(denominator) && denominator > 0 ? numerator / denominator : null
}
