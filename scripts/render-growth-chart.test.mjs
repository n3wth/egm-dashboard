import test from 'node:test'
import assert from 'node:assert/strict'
import { LAUNCH_DATE, launchRows, buildChartSvg } from './render-growth-chart.mjs'

const rows = [
  { date: '2026-10-19', newStars: 0, stars: 5 },
  { date: '2026-10-20', newStars: 6, stars: 11 },
  { date: '2026-10-21', newStars: 83, stars: 94 },
  { date: '2026-10-22', newStars: 99, stars: 193 }
]

test('growth chart starts at public launch and drops private-era history', () => {
  const kept = launchRows(rows)
  assert.equal(LAUNCH_DATE, '2026-10-21')
  assert.deepEqual(kept.map(r => r.date), ['2026-10-21', '2026-10-22'])
  const svg = buildChartSvg(kept, 'light')
  assert.match(svg, /Launch Oct 21/)
  assert.doesNotMatch(svg, /Oct 20/)
})
