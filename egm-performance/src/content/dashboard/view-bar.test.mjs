import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

test('inline view bars keep one track size while values align to the column edge', () => {
  const source = readFileSync(new URL('./DashboardContent.jsx', import.meta.url), 'utf8')
  const css = readFileSync(new URL('./egm.css', import.meta.url), 'utf8')
  assert.match(source, /egm-view-bar-track/)
  assert.match(source, /aria-label="Views unknown">—/)
  assert.match(css, /\.egm-view-bar \{[^}]*grid-template-columns: 70px minmax\(5\.5rem,1fr\);[^}]*width: 100%;/)
  assert.match(css, /\.egm-view-bar-track \{ display: block; width: 70px; height: 6px;/)
  assert.match(css, /\.egm-view-bar-value \{[^}]*text-align: right/)
  assert.doesNotMatch(css, /\.egm-view-bar-value \{[^}]*width:/)
})
