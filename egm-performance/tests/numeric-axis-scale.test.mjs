import test from 'node:test'
import assert from 'node:assert/strict'
import {roundedNumericTicks, usesRoundedNumericScale, zeroAnchoredDomain} from '../src/charting/numeric-axis-scale.mjs'

test('automatic value axes use an even rounded ladder above the data maximum', () => {
  assert.deepEqual(roundedNumericTicks([0, 20500]), [0, 5000, 10000, 15000, 20000, 25000])
  assert.deepEqual(roundedNumericTicks([0, 1741]), [0, 500, 1000, 1500, 2000])
  assert.deepEqual(roundedNumericTicks([0, 25000]), [0, 5000, 10000, 15000, 20000, 25000])
  assert.deepEqual(roundedNumericTicks([0, 3], 5, false), [0, 1, 2, 3])
  assert.deepEqual(roundedNumericTicks([0, 1], 5, false), [0, 1])
  assert.deepEqual(roundedNumericTicks([0, 0]), [0, 1, 2, 3, 4])
  assert.deepEqual(roundedNumericTicks([-14, 31]), [-20, -10, 0, 10, 20, 30, 40])
  assert.deepEqual(roundedNumericTicks([0, 0.06]), [0, 0.02, 0.04, 0.06])
  assert.deepEqual(roundedNumericTicks([NaN, 10]), [])
})

test('rounded ticks preserve explicit domains, percentages, ticks and non-linear scales', () => {
  assert.equal(usesRoundedNumericScale({}), true)
  assert.equal(usesRoundedNumericScale({domain: zeroAnchoredDomain}), true)
  for (const props of [{domain:[0, 20500]}, {domain:['dataMin','auto']}, {domain:()=>[0, 100]}, {ticks:[0,5,10]}, {scale:'log'}, {scale:'sqrt'}, {scale:()=>{}}]) {
    assert.equal(usesRoundedNumericScale(props), false)
  }
  assert.equal(usesRoundedNumericScale({}, true), false)
  assert.equal(usesRoundedNumericScale({}, 'points'), false)
  assert.deepEqual(zeroAnchoredDomain([-14, 31]), [-14, 31])
})
