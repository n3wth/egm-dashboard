import test from 'node:test'
import assert from 'node:assert/strict'
import { videoGrid } from './video-grid.mjs'

test('video tiles fill complete rows at each breakpoint', () => {
  assert.deepEqual(videoGrid(9, 375), { columns: 3, count: 6 })
  assert.deepEqual(videoGrid(9, 900), { columns: 4, count: 8 })
  assert.deepEqual(videoGrid(9, 1280), { columns: 6, count: 6 })
  assert.deepEqual(videoGrid(9, 1920), { columns: 6, count: 6 })
  assert.deepEqual(videoGrid(12, 1920), { columns: 6, count: 12 })
  assert.deepEqual(videoGrid(2, 1920), { columns: 2, count: 2 })
  assert.deepEqual(videoGrid(0, 375), { columns: 1, count: 0 })
})
