export function zeroAnchoredDomain([minimum, maximum]) {
  return [Math.min(0, minimum), Math.max(0, maximum)]
}

export function roundedNumericTicks(domain, tickCount = 5, allowDecimals = true) {
  if (!Array.isArray(domain) || domain.length !== 2 || !domain.every(Number.isFinite)) return []
  let [minimum, maximum] = [...domain].sort((a, b) => a - b)
  if (minimum === maximum) {
    if (minimum === 0) return [0, 1, 2, 3, 4]
    const padding = Math.abs(minimum) * 0.1
    minimum -= padding
    maximum += padding
  }
  const target = (maximum - minimum) / Math.max(1, tickCount - 1)
  const magnitude = 10 ** Math.floor(Math.log10(target))
  const normalized = target / magnitude
  const multiplier = normalized < Math.sqrt(2) ? 1 : normalized < Math.sqrt(10) ? 2 : normalized < Math.sqrt(50) ? 5 : 10
  const step = Math.max(allowDecimals ? Number.MIN_VALUE : 1, multiplier * magnitude)
  if (!Number.isFinite(step) || step === 0) return []
  const start = Math.floor(minimum / step), end = Math.ceil(maximum / step)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end - start > 100) return []
  return Array.from({length: end - start + 1}, (_, index) => Number(((start + index) * step).toPrecision(14)))
}

export function usesRoundedNumericScale({domain, ticks, scale}, percent = false) {
  return !percent && ticks == null && (scale == null || scale === 'auto' || scale === 'linear')
    && (domain == null || domain === zeroAnchoredDomain)
}
