// Renders the weekly brief email charts (assets/branding/growth-chart-{light,dark}.png)
// from star history, starting at the public launch. Before launch the repo was private
// and history was squashed into main, so earlier stars are not meaningful.
// Usage: node scripts/render-growth-chart.mjs [path/to/data.json]
import { readFile, writeFile, mkdtemp } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const LAUNCH_DATE = '2026-10-21'
const W = 888
const H = 192
const themes = {
  light: { ink: '#18181a', muted: '#76766f', grid: '#ebebe8', line: '#2f6fe4', bar: '#2f6fe4', barSoft: '#c9d9f7' },
  dark: { ink: '#f2f2f2', muted: '#9a9a9a', grid: '#2a2a2a', line: '#6f9cf0', bar: '#6f9cf0', barSoft: '#2c3d5c' }
}

const compact = n => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, '')}k` : String(n))
const label = d => new Date(`${d}T00:00:00Z`).toLocaleString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
const niceMax = v => {
  const step = 10 ** Math.floor(Math.log10(Math.max(v, 1)))
  return Math.ceil(v / (step / 2)) * (step / 2)
}

export function launchRows(rows, launch = LAUNCH_DATE) {
  return rows.filter(r => r.date >= launch && Number.isFinite(r.stars))
}

export function buildChartSvg(rows, theme = 'light') {
  const t = themes[theme]
  const font = `font-family="Arial" font-size="18"`
  const pad = { l: 44, r: 8, t: 12, b: 34 }
  const panelW = (W - 32) / 2
  const plotH = H - pad.t - pad.b
  const parts = []

  // Left: cumulative stars since launch
  const lx = pad.l
  const lw = panelW - pad.l - pad.r
  const maxStars = niceMax(rows.at(-1).stars)
  const x = i => lx + (rows.length === 1 ? lw : (i / (rows.length - 1)) * lw)
  const y = v => pad.t + plotH - (v / maxStars) * plotH
  for (const v of [0, maxStars / 2, maxStars]) {
    parts.push(`<line x1="${lx}" x2="${lx + lw}" y1="${y(v)}" y2="${y(v)}" stroke="${t.grid}" stroke-width="2"/>`)
    parts.push(`<text x="${lx - 8}" y="${y(v) + 6}" text-anchor="end" fill="${t.muted}" ${font}>${compact(v)}</text>`)
  }
  const path = rows.map((r, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(r.stars).toFixed(1)}`).join('')
  parts.push(`<path d="${path}" fill="none" stroke="${t.line}" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"/>`)
  parts.push(`<circle cx="${x(rows.length - 1)}" cy="${y(rows.at(-1).stars)}" r="6" fill="${t.line}"/>`)
  parts.push(`<text x="${lx}" y="${H - 8}" fill="${t.muted}" ${font}>Launch ${label(rows[0].date)}</text>`)
  parts.push(`<text x="${lx + lw}" y="${H - 8}" text-anchor="end" fill="${t.muted}" ${font}>${label(rows.at(-1).date)}</text>`)

  // Right: daily new stars, last 14 days (post-launch only)
  const daily = rows.slice(-14)
  const rx = panelW + 32 + pad.l
  const rw = W - rx - pad.r
  const maxNew = niceMax(Math.max(...daily.map(r => r.newStars ?? 0)))
  const yb = v => pad.t + plotH - (v / maxNew) * plotH
  for (const v of [0, maxNew / 2, maxNew]) {
    parts.push(`<line x1="${rx}" x2="${rx + rw}" y1="${yb(v)}" y2="${yb(v)}" stroke="${t.grid}" stroke-width="2"/>`)
    parts.push(`<text x="${rx - 8}" y="${yb(v) + 6}" text-anchor="end" fill="${t.muted}" ${font}>${compact(v)}</text>`)
  }
  const slot = rw / 14
  const barW = slot * 0.7
  const offset = 14 - daily.length
  daily.forEach((r, i) => {
    const v = r.newStars ?? 0
    const bx = rx + (offset + i) * slot + (slot - barW) / 2
    const recent = i >= daily.length - 7
    parts.push(`<rect x="${bx.toFixed(1)}" y="${yb(v).toFixed(1)}" width="${barW.toFixed(1)}" height="${(pad.t + plotH - yb(v)).toFixed(1)}" rx="3" fill="${recent ? t.bar : t.barSoft}"/>`)
  })
  parts.push(`<text x="${rx + offset * slot}" y="${H - 8}" fill="${t.muted}" ${font}>${label(daily[0].date)}</text>`)
  parts.push(`<text x="${rx + rw}" y="${H - 8}" text-anchor="end" fill="${t.muted}" ${font}>${label(daily.at(-1).date)}</text>`)

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${parts.join('')}</svg>`
}

async function main() {
  const dataPath = process.argv[2] || new URL('../egm-performance/src/data.json', import.meta.url)
  const data = JSON.parse(await readFile(dataPath, 'utf8'))
  const rows = launchRows(data.queries?.star_history?.rows ?? [])
  if (rows.length < 2) throw new Error('Not enough post-launch star history to render a chart')
  const dir = await mkdtemp(join(tmpdir(), 'egm-chart-'))
  for (const theme of ['light', 'dark']) {
    const svgPath = join(dir, `${theme}.svg`)
    await writeFile(svgPath, buildChartSvg(rows, theme))
    const out = new URL(`../assets/branding/growth-chart-${theme}.png`, import.meta.url).pathname
    execFileSync('rsvg-convert', ['-o', out, svgPath])
    console.log(`wrote ${out}`)
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main()
