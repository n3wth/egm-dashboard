import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createCollectionStatus } from './collection-status.mjs'

class Element {
  constructor() { this.children = []; this.listeners = {}; this.textContent = ''; this.disabled = false }
  append(child) { this.children.push(child) }
  replaceChildren(...children) { this.children = children }
  addEventListener(name, handler) { this.listeners[name] = handler }
}
const json = value => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } })
const fixture = request => {
  const status = new Element(), list = new Element(), refresh = new Element()
  const component = createCollectionStatus({ status, list, refresh, request, document: { createElement: () => new Element() } })
  return { status, list, refresh, component }
}

test('shows actual per-source states using the selected workspace', async () => {
  let call
  const f = fixture(async (path, options) => {
    call = { path, options }
    return json({ jobs: [{ kind: 'github', status: 'running', createdAt: '2026-01-01T00:00:00Z', finishedAt: null }, { kind: 'website', status: 'failed', createdAt: '2026-01-01T00:00:00Z', finishedAt: '2026-01-02T00:00:00Z' }] })
  })
  await f.component.load('project-a', 'org-a')
  assert.equal(call.path, '/api/boing/projects/project-a/collection-status')
  assert.equal(call.options.headers['x-boing-organization'], 'org-a')
  assert.match(f.list.children[0].textContent, /^GitHub: Running/)
  assert.match(f.list.children[1].textContent, /^Website: Failed/)
  assert.equal(f.refresh.disabled, false)
})

test('clears stale responses after a workspace switch', async () => {
  let finish
  const f = fixture((path, options) => options.headers['x-boing-organization'] === 'org-a'
    ? new Promise(resolve => { finish = resolve }) : Promise.resolve(json({ jobs: [] })))
  const old = f.component.load('project-a', 'org-a')
  await f.component.load('project-b', 'org-b')
  finish(json({ jobs: [{ kind: 'github', status: 'completed' }] }))
  await old
  assert.equal(f.status.textContent, 'No collection runs yet.')
  assert.equal(f.list.children.length, 0)
  f.component.clear()
  assert.equal(f.refresh.disabled, true)
  assert.equal(f.status.textContent, '')
})

test('invalid status data fails without claiming a result', async () => {
  const f = fixture(async () => json({ jobs: [{ kind: 'github', status: 'invented' }] }))
  await f.component.load('p', 'o')
  assert.match(f.status.textContent, /Could not load/)
  assert.equal(f.list.children.length, 0)
})
