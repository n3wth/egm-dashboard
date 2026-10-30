import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { navbarAccountIcon, navbarAskIcon, navbarIcon, navbarIconSize, navbarRefreshIcon, navbarRoundedIcons } from './navbar-icons.mjs'

test('navbar icons are 20px Material Symbols Rounded, except the filled Ask sparkle', () => {
  assert.equal(navbarIconSize, 20)
  assert.equal(navbarIcon('reach'), 'bar_chart')
  assert.equal(navbarIcon('acquisition'), 'north_east')
  assert.equal(navbarIcon('adoption'), 'group')
  assert.equal(navbarIcon('website'), 'language')
  assert.equal(navbarIcon('development'), 'code')
  assert.equal(navbarIcon('research'), 'search')
  assert.equal(navbarIcon('mentions'), 'campaign')
  assert.equal(navbarRefreshIcon, 'refresh')
  assert.equal(navbarAccountIcon, 'account_circle')
  assert.equal(navbarIcon('unknown'), 'textDocument')
  for (const name of navbarRoundedIcons) {
    const file = new URL(`../../../node_modules/@material-symbols/svg-400/rounded/${name}.svg`, import.meta.url)
    assert.equal(existsSync(file), true, name)
    const svg = readFileSync(file, 'utf8')
    assert.doesNotMatch(svg, /-fill/)
    assert.match(svg, /viewBox="0 -960 960 960"/)
  }
  const sparkle = readFileSync(new URL(`../../components/icons/dashboard-icon-${navbarAskIcon}.svg`, import.meta.url), 'utf8')
  assert.match(sparkle, /fill="currentColor"/)
  assert.doesNotMatch(sparkle, /stroke-width/)
  assert.doesNotMatch(sparkle, /gradient/)
})
