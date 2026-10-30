import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { navbarAskIcon, navbarIcon, navbarIconSize, navbarRefreshIcon, navbarStrokeIcons } from './navbar-icons.mjs'

test('navbar icons use one size and one stroke width', () => {
  assert.equal(navbarIconSize, 16)
  assert.equal(navbarIcon('reach'), 'navOverview')
  assert.equal(navbarIcon('mentions'), 'navMentions')
  assert.equal(navbarIcon('unknown'), 'textDocument')
  assert.equal(new Set(navbarStrokeIcons).size, navbarStrokeIcons.length)
  for (const name of navbarStrokeIcons) {
    const svg = readFileSync(new URL(`../../components/icons/dashboard-icon-${name}.svg`, import.meta.url), 'utf8')
    assert.match(svg, /viewBox="0 0 24 24"/)
    assert.match(svg, /stroke-width="1\.5"/)
    assert.equal(svg.match(/stroke-width="/g).length, 1)
  }
  assert.equal(navbarAskIcon, 'navSparkle')
  assert.equal(navbarRefreshIcon, 'navRefresh')
})
