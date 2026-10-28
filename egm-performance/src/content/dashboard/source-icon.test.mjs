import test from 'node:test'
import assert from 'node:assert/strict'
import {sourceIcon} from './source-icon.mjs'

test('t.co has a distinct icon and unknown sources receive a safe fallback',()=>{
  const svg=value=>decodeURIComponent(sourceIcon(value).split(',')[1])
  assert.match(svg('t.co'),/<path/)
  assert.match(svg('new.example'),/<circle/)
  assert.doesNotMatch(svg('<script>'),/<script>/)
})
