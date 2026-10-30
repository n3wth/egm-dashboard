// Monotone cubic curve (same tangents as d3 curveMonotoneX, which Recharts uses for type="monotone").
// It passes through every point and never overshoots a local high or low.
const sign = value => value < 0 ? -1 : 1
const round = value => Math.round(value * 100) / 100

export function monotonePath(points) {
  if (points.length < 2) return ''
  const start = `M${round(points[0][0])},${round(points[0][1])}`
  if (points.length === 2) return `${start}L${round(points[1][0])},${round(points[1][1])}`
  const secants = points.slice(1).map(([x, y], index) => (y - points[index][1]) / (x - points[index][0]))
  const inner = points.slice(1, -1).map(([x], index) => {
    const before = x - points[index][0], after = points[index + 2][0] - x
    const s0 = secants[index], s1 = secants[index + 1]
    const p = (s0 * after + s1 * before) / (before + after)
    return (sign(s0) + sign(s1)) * Math.min(Math.abs(s0), Math.abs(s1), 0.5 * Math.abs(p)) || 0
  })
  const tangents = [(3 * secants[0] - inner[0]) / 2, ...inner, (3 * secants.at(-1) - inner.at(-1)) / 2]
  return start + points.slice(1).map(([x1, y1], index) => {
    const [x0, y0] = points[index], dx = (x1 - x0) / 3
    return `C${[x0 + dx, y0 + dx * tangents[index], x1 - dx, y1 - dx * tangents[index + 1], x1, y1].map(round).join(',')}`
  }).join('')
}

export function sparklineSegments(values) {
  const reviewed = values.filter(Number.isFinite)
  if (reviewed.length < 2) return []
  const minimum = Math.min(...reviewed)
  const range = Math.max(Number.EPSILON, Math.max(...reviewed) - minimum)
  const segments = []
  let points = []
  values.forEach((value, index) => {
    if (!Number.isFinite(value)) {
      if (points.length) segments.push(points)
      points = []
    } else {
      points.push([2 + index / (values.length - 1) * 54, 21 - (value - minimum) / range * 16])
    }
  })
  if (points.length) segments.push(points)
  return segments
}
