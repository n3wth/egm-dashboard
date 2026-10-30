import test from 'node:test'
import assert from 'node:assert/strict'
import { createWorkspaceExport } from './workspace-export.mjs'

class Element {
  constructor() { this.children = []; this.hidden = false; this.disabled = false; this.textContent = '' }
  append(...children) { this.children.push(...children) }
  setAttribute() {}
  click() { this.clicked = true }
  remove() {}
}
function fixture(request) {
  const body = new Element(), anchor = { after(element) { this.child = element } }
  const manager = createWorkspaceExport({ document: { createElement: () => new Element(), body }, anchor, request, makeUrl: () => 'blob:test', revokeUrl() {} })
  return { ...manager, body, anchor }
}

test('only owners can request and download a clearly labelled partial export', async () => {
  const requests = []
  const ui = fixture(async (path, options) => {
    requests.push({ path, options })
    return Response.json({ scope: 'partial_workspace_export', projects: [] })
  })
  ui.show('org-a', 'member')
  await ui.button.onclick()
  assert.equal(ui.section.hidden, true)
  assert.equal(requests.length, 0)
  ui.show('org-a', 'owner')
  assert.equal(ui.section.hidden, false)
  assert.match(ui.section.children[1].textContent, /Archived projects.*not a point-in-time backup/)
  await ui.button.onclick()
  assert.equal(requests[0].path, '/api/boing/workspace/export')
  assert.equal(requests[0].options.headers['x-boing-organization'], 'org-a')
  assert.equal(ui.body.children[0].download, 'boing-workspace-partial-export.json')
  assert.equal(ui.body.children[0].clicked, true)
})

test('switching workspaces prevents a delayed export download', async () => {
  let finish
  const ui = fixture(() => new Promise(resolve => { finish = resolve }))
  ui.show('org-a', 'owner')
  const pending = ui.button.onclick()
  ui.show('org-b', 'owner')
  finish(Response.json({ scope: 'partial_workspace_export', projects: [] }))
  await pending
  assert.equal(ui.body.children.length, 0)
  assert.equal(ui.status.textContent, '')
  assert.equal(ui.button.disabled, false)
})

test('failed exports do not download a partial response', async () => {
  const ui = fixture(async () => new Response('', { status: 413 }))
  ui.show('org-a', 'owner')
  await ui.button.onclick()
  assert.match(ui.status.textContent, /too large/)
  assert.equal(ui.body.children.length, 0)
})
