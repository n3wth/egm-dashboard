import test from 'node:test'
import assert from 'node:assert/strict'
import { createProjectArchive } from './archive.mjs'

class Element {
  constructor() { this.children = []; this.hidden = false; this.textContent = ''; this.disabled = false }
  append(...children) { this.children.push(...children) }
  replaceChildren() { this.children = [] }
}
function fixture() {
  const elements = Object.fromEntries(['section', 'status', 'list', 'controls', 'message', 'archive', 'confirm', 'cancel'].map(id => [id, new Element()]))
  const calls = [], changes = []
  const request = async (path, options) => {
    calls.push({ path, options })
    if (path === '/api/boing/projects/archived') return Response.json({ projects: [{ id: 'p2', name: 'Old project' }], truncated: false })
    if (path.endsWith('/archive')) return Response.json({ archived: true, dataDeleted: false })
    if (path.endsWith('/restore')) return Response.json({ restored: true, previousDataRestored: false })
    throw Error('unexpected')
  }
  const app = createProjectArchive({ ...elements, document: { createElement: () => new Element() }, request, onChanged: async value => { changes.push(value) } })
  return { ...elements, app, calls, changes }
}

test('owner confirms before archiving and is told the data remains', async () => {
  const { app, controls, archive, confirm, cancel, message, calls, changes } = fixture()
  await app.load('org-a', 'owner'); app.select({ id: 'p1', name: 'Project' })
  assert.equal(controls.hidden, false)
  assert.equal(confirm.hidden, true)
  archive.onclick()
  assert.match(message.textContent, /Data remains stored/)
  assert.equal(calls.filter(call => call.path.endsWith('/archive')).length, 0)
  cancel.onclick(); assert.equal(confirm.hidden, true)
  archive.onclick(); await confirm.onclick()
  assert.equal(calls.at(-1).path, '/api/boing/projects/p1/archive')
  assert.equal(calls.at(-1).options.headers['x-boing-organization'], 'org-a')
  assert.deepEqual(changes, [undefined])
})

test('archived projects restore within the current workspace; controls disappear for other roles', async () => {
  const { app, section, list, calls, changes } = fixture()
  await app.load('org-a', 'owner')
  assert.equal(section.hidden, false)
  assert.equal(list.children[0].children[0].textContent, 'Old project')
  await list.children[0].children[1].onclick()
  assert.equal(calls.at(-1).path, '/api/boing/projects/p2/restore')
  assert.deepEqual(changes, ['p2'])
  await app.load('org-b', 'member')
  assert.equal(section.hidden, true)
  assert.equal(list.children.length, 0)
})

test('switching projects aborts a pending archive and discards its completion', async () => {
  const { app, archive, confirm, calls, changes } = fixture()
  await app.load('org-a', 'owner'); app.select({ id: 'p1', name: 'First' }); archive.onclick()
  const oldConfirm = confirm.onclick
  app.select({ id: 'p2', name: 'Second' })
  await oldConfirm()
  assert.equal(calls.filter(call => call.path.endsWith('/archive')).length, 0)
  assert.deepEqual(changes, [])
})
