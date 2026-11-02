import test from 'node:test'
import assert from 'node:assert/strict'
import {navTooltipPosition} from '../src/components/nav-tooltip-position.mjs'

test('nav tooltips center below their control and stay inside either viewport edge', () => {
  const viewport = {width: 390, height: 844}
  const tooltip = {width: 300, height: 54}
  assert.deepEqual(navTooltipPosition({left: 160, width: 36, top: 10, bottom: 46}, tooltip, viewport), {left: 28, top: 54})
  assert.equal(navTooltipPosition({left: 0, width: 36, top: 10, bottom: 46}, tooltip, viewport).left, 12)
  assert.equal(navTooltipPosition({left: 354, width: 36, top: 10, bottom: 46}, tooltip, viewport).left, 78)
  assert.equal(navTooltipPosition({left: 160, width: 36, top: 790, bottom: 826}, tooltip, viewport).top, 728)
})
