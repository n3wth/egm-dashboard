// Share formatter for ratios in [0, 1]. Unknown inputs (null, undefined, NaN, Infinity) render as a dash, never as 0%.
export function percentage(value) {
  if (value == null) return '—'
  const scaled = value * 100
  if (!Number.isFinite(scaled)) return '—'
  if (scaled !== 0 && Math.abs(scaled) < 0.1) return scaled < 0 ? '>−0.1%' : '<0.1%'
  return `${Math.abs(scaled) < 1 && scaled !== 0 ? Number(scaled.toFixed(1)) : Math.round(scaled)}%`
}
