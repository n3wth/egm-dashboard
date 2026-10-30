import test from 'node:test'
import assert from 'node:assert/strict'
import { createProjectHistory } from './history.mjs'

class Element {
  constructor() { this.children = []; this.style = {}; this.hidden = false; this.textContent = '' }
  append(...items) { this.children.push(...items) }
  replaceChildren(...items) { this.children = items }
  setAttribute() {}
}
const json = body => Response.json(body)
function fixture(request) {
  const section = new Element(), status = new Element(), charts = new Element()
  const history = createProjectHistory({ section, status, charts, document: { createElement: () => new Element() }, request })
  return { section, status, charts, history }
}
test('shows actual values including zero and unavailable, with scoped request', async () => {
  let options
  const f = fixture(async (path, init) => { options = init; assert.equal(path, '/api/boing/projects/p1/history'); return json({ history: [{ kind: 'github', day: '2026-01-01', metrics: { stars: 0, forks: null } }, { kind: 'github', day: '2026-01-03', metrics: { stars: 5, forks: null } }] }) })
  await f.history.load('p1', 'org1')
  assert.equal(options.headers['x-boing-organization'], 'org1')
  assert.equal(f.charts.children[0].children[1].children[2].textContent, '0')
  assert.equal(f.charts.children[1].children[1].children[2].textContent, 'Unavailable')
  assert.match(f.status.textContent, /days without a collection are not shown/)
})
test('clears old project and discards a delayed response', async () => {
  let resolveOld, oldSignal
  const f = fixture(async (path, options) => {
    if (path.includes('/old/')) { oldSignal = options.signal; return new Promise(resolve => { resolveOld = resolve }) }
    return json({ history: [] })
  })
  const old = f.history.load('old', 'one')
  await f.history.load('new', 'two')
  assert.equal(oldSignal.aborted, true)
  resolveOld(json({ history: [{ kind: 'github', day: '2026-01-01', metrics: { stars: 9 } }] }))
  await old
  assert.equal(f.charts.children.length, 0)
  assert.match(f.status.textContent, /No stored history/)
})
