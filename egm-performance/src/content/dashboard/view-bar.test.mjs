import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

test('inline view bars keep one track size and a value placeholder', () => {
  const source = readFileSync(new URL('./DashboardContent.jsx', import.meta.url), 'utf8')
  const css = readFileSync(new URL('./egm.css', import.meta.url), 'utf8')
  assert.match(source, /egm-view-bar-track/)
  assert.match(source, /aria-label="Views unknown">—/)
  assert.match(css, /\.egm-view-bar \{ display: grid; grid-template-columns: 70px 5\.5rem;/)
  assert.match(css, /\.egm-view-bar-track \{ display: block; width: 70px; height: 6px;/)
  assert.match(css, /\.egm-view-bar-value \{[^}]*width: 5\.5rem;[^}]*text-align: right/)
})
