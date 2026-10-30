// Monotone cubic curve (same tangents as d3 curveMonotoneX, which Recharts uses for type="monotone").
// It passes through every point and never overshoots a local high or low.
const sign = value => value < 0 ? -1 : 1
const round = value => Math.round(value * 100) / 100

export function monotonePath(points) {
  if (points.length < 2) return ''
  const start = `M${round(points[0][0])},${round(points[0][1])}`
  if (points.length === 2) return `${start}L${round(points[1][0])},${round(points[1][1])}`
  const secants = points.slice(1).map(([x, y], index) => (y - points[index][1]) / (x - points[index][0]))
  const tangents = points.map(([x], index) => {
    if (index === 0 || index === points.length - 1) return 0
    const before = x - points[index - 1][0], after = points[index + 1][0] - x
    const s0 = secants[index - 1], s1 = secants[index]
    const p = (s0 * after + s1 * before) / (before + after)
    return (sign(s0) + sign(s1)) * Math.min(Math.abs(s0), Math.abs(s1), 0.5 * Math.abs(p)) || 0
  })
  tangents[0] = (3 * secants[0] - tangents[1]) / 2
  tangents[points.length - 1] = (3 * secants.at(-1) - tangents.at(-2)) / 2
  return start + points.slice(1).map(([x1, y1], index) => {
    const [x0, y0] = points[index], dx = (x1 - x0) / 3
    return `C${[x0 + dx, y0 + dx * tangents[index], x1 - dx, y1 - dx * tangents[index + 1], x1, y1].map(round).join(',')}`
  }).join('')
}

export function sparklineSegments(values, width = 54, height = 16, left = 2, top = 5) {
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
      points.push([left + index / (values.length - 1) * width, top + height - (value - minimum) / range * height])
    }
  })
  if (points.length) segments.push(points)
  return segments
}
