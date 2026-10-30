import test from 'node:test'
import assert from 'node:assert/strict'
import {monotonePath, sparklineSegments} from './sparkline-path.mjs'

const curves = path => [...path.matchAll(/C([^C]+)/g)].map(match => match[1].split(',').map(Number))
const bezier = (p0, c1, c2, p1, t) => (1 - t) ** 3 * p0 + 3 * (1 - t) ** 2 * t * c1 + 3 * (1 - t) * t ** 2 * c2 + t ** 3 * p1

test('curve passes through every point and stays inside each step',()=>{
  const points = [[0,10],[1,2],[2,8],[3,8],[4,0],[5,6]]
  const path = monotonePath(points)
  assert.match(path,/^M0,10C/)
  const segments = curves(path)
  assert.equal(segments.length,points.length - 1)
  segments.forEach(([, c1y, , c2y, x1, y1],index) => {
    const y0 = points[index][1]
    assert.deepEqual([x1,y1],points[index + 1])
    for (let t = 0; t <= 1; t += 0.05) {
      const y = bezier(y0,c1y,c2y,y1,t)
      assert.ok(y >= Math.min(y0,y1) - 1e-9 && y <= Math.max(y0,y1) + 1e-9,`step ${index} overshoots at t=${t}`)
    }
  })
})
test('flat runs stay flat and two points draw a line',()=>{
  assert.equal(monotonePath([[0,5],[1,5],[2,5]]),'M0,5C0.33,5,0.67,5,1,5C1.33,5,1.67,5,2,5')
  assert.equal(monotonePath([[0,1],[2,3]]),'M0,1L2,3')
  assert.equal(monotonePath([[0,1]]),'')
})
test('missing values split the line into segments',()=>{
  const segments = sparklineSegments([1,2,null,4,NaN,6,7])
  assert.deepEqual(segments.map(segment => segment.length),[2,1,2])
  assert.deepEqual(segments[0][0],[2,21])
  assert.deepEqual(segments.at(-1).at(-1),[56,5])
  assert.deepEqual(sparklineSegments([3,null]),[])
})
