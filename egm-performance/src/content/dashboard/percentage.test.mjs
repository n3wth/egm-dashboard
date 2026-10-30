import test from 'node:test'
import assert from 'node:assert/strict'
import {percentage} from './percentage.mjs'

test('rounds percentages without hiding small nonzero shares',()=>{
  assert.equal(percentage(0.6389),'64%')
  assert.equal(percentage(0.006),'0.6%')
  assert.equal(percentage(0.0001),'<0.1%')
  assert.equal(percentage(0),'0%')
  assert.equal(percentage(NaN),'—')
  assert.equal(percentage(null),'—')
  assert.equal(percentage(undefined),'—')
})
test('unknown shares are never shown as zero',()=>{
  assert.equal(percentage(null),'—')
  assert.equal(percentage(undefined),'—')
  assert.equal(percentage(Infinity),'—')
})
