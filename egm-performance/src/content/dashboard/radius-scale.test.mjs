import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

test('theme.css owns the corner radius scale', () => {
  const theme = readFileSync(new URL('../../theme.css', import.meta.url), 'utf8')
  assert.match(theme, /--radius-sm:\s*6px/)
  assert.match(theme, /--radius-md:\s*8px/)
  assert.match(theme, /--radius-lg:\s*16px/)
  assert.match(theme, /--radius-full:\s*9999px/)
  assert.match(theme, /--card-radius:\s*var\(--radius-lg\)/)
  assert.match(theme, /--control-radius:\s*var\(--radius-md\)/)
  const dashboard = readFileSync(new URL('./egm.css', import.meta.url), 'utf8')
  assert.match(dashboard, /\.egm-overview-video-frame \{[^}]*overflow: hidden;[^}]*border-radius: var\(--radius-md\)/)
  assert.match(dashboard, /\.egm-account-avatar \{[^}]*border-radius: var\(--radius-full\)/)
})
