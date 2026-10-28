export function percentage(value) {
  const scaled = value * 100
  if (!Number.isFinite(scaled)) return '—'
  if (scaled !== 0 && Math.abs(scaled) < 0.1) return scaled < 0 ? '>−0.1%' : '<0.1%'
  return `${Math.abs(scaled) < 1 && scaled !== 0 ? Number(scaled.toFixed(1)) : Math.round(scaled)}%`
}
