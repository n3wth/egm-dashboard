import test from 'node:test'
import assert from 'node:assert/strict'
import { dateSpan, ratio } from './metric-safety.mjs'

test('date spans remain readable when data is missing or malformed', () => {
  assert.equal(dateSpan([]), 'Unavailable')
  assert.equal(dateSpan([{date:'invalid'}]), 'Unavailable')
  assert.equal(dateSpan([{date:'2026-01-01'}, {date:'2026-01-03'}]), 'Jan 1–Jan 3')
})

test('ratios require finite values and a positive denominator', () => {
  assert.equal(ratio(4, 0), null)
  assert.equal(ratio(undefined, 10), null)
  assert.equal(ratio(4, 10), 0.4)
})
