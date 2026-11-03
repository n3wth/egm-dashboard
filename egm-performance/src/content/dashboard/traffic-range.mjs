const day = 86400000
const iso = value => /^\d{4}-\d{2}-\d{2}$/.test(value ?? '') && Number.isFinite(Date.parse(value))

// Only additive counts are totaled. Daily unique visitors and cloners overlap across days.
export function trafficRangeSummary(rows, field) {
  const dated = (rows ?? []).filter(row => iso(row?.date)).sort((a, b) => a.date.localeCompare(b.date))
  if (!dated.length) return null
  const start = dated[0].date, end = dated.at(-1).date
  const span = Math.round((Date.parse(end) - Date.parse(start)) / day) + 1
  const values = dated.map(row => row[field])
  const total = values.every(Number.isFinite) ? values.reduce((sum, value) => sum + value, 0) : null
  return { start, end, days: dated.length, missingDays: span - new Set(dated.map(row => row.date)).size, total }
}
