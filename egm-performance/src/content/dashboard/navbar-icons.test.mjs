import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { navbarAccountIcon, navbarAskIcon, navbarIcon, navbarIconSize, navbarRefreshIcon, navbarRoundedIcons, navbarSparkleSize } from './navbar-icons.mjs'

test('dashboard icons no longer load the old material symbol JSON', () => {
  assert.equal(existsSync(new URL('./material-symbols.json', import.meta.url)), false)
  const icon = readFileSync(new URL('../../components/Icon.jsx', import.meta.url), 'utf8')
  assert.doesNotMatch(icon, /material-symbols\.json/)
  assert.match(icon, /gemini: "navSparkle"/)
  const map = readFileSync(new URL('./material-rounded.mjs', import.meta.url), 'utf8')
  for (const name of ['check', 'chevronDown', 'edit', 'lightbulb', 'trash', 'sun', 'search', 'refresh']) {
    assert.match(map, new RegExp(`\\b${name}:`))
  }
  assert.match(map, /check_box-fill\.svg/)
})

test('navbar icons are 20px Material Symbols Rounded strokes, except the smaller filled Ask sparkle', () => {
  assert.equal(navbarIconSize, 20)
  assert.equal(navbarSparkleSize, 18)
  assert.equal(navbarIcon('reach'), 'show_chart')
  assert.equal(navbarIcon('acquisition'), 'north_east')
  assert.equal(navbarIcon('adoption'), 'person')
  assert.equal(navbarIcon('website'), 'language')
  assert.equal(navbarIcon('development'), 'code')
  assert.equal(navbarIcon('research'), 'search')
  assert.equal(navbarIcon('mentions'), 'campaign')
  assert.equal(navbarIcon('egm-chat'), 'bar_chart')
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
