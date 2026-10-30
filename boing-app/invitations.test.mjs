import test from 'node:test'
import assert from 'node:assert/strict'
import { createWorkspaceInvitations } from './invitations.mjs'

class Element {
  constructor() { this.children = []; this.hidden = false; this.textContent = ''; this.disabled = false }
  append(...children) { this.children.push(...children) }
  replaceChildren() { this.children = [] }
}

test('owners can inspect and revoke local invitations with a separate confirmation', async () => {
  const section = new Element(), status = new Element(), list = new Element(), requests = []
  const document = { createElement: () => new Element() }
  const request = async (path, options) => {
    requests.push({ path, options })
    if (path.endsWith('/revoke')) return Response.json({ revoked: true })
    return Response.json({ invitations: [{ id: 'invite-1', email: 'person@example.com', role: 'member', status: 'pending' }] })
  }
  const manager = createWorkspaceInvitations({ section, status, list, document, request })
  await manager.load('workspace-a', 'owner')
  assert.equal(section.hidden, false)
  const [, revoke, confirm, cancel] = list.children[0].children
  revoke.onclick()
  assert.match(status.textContent, /does not revoke any WorkOS invitation/)
  assert.equal(requests.length, 1)
  cancel.onclick()
  assert.equal(confirm.hidden, true)
  revoke.onclick()
  await confirm.onclick()
  assert.equal(requests[1].path, '/api/boing/invitations/invite-1/revoke')
  assert.equal(requests[1].options.headers['x-boing-organization'], 'workspace-a')
  assert.equal(requests[1].options.body, '{}')
  assert.equal(requests.some(item => item.path === '/api/boing/invitations' && item.options.method === 'POST'), false)
  await manager.load('workspace-b', 'member')
  assert.equal(section.hidden, true)
  assert.equal(list.children.length, 0)
})

test('a delayed response from a previous workspace does not reveal its invitations', async () => {
  const section = new Element(), status = new Element(), list = new Element()
  let resolve
  const manager = createWorkspaceInvitations({ section, status, list, document: { createElement: () => new Element() }, request: () => new Promise(done => { resolve = done }) })
  const pending = manager.load('workspace-a', 'owner')
  await manager.load('workspace-b', 'member')
  resolve(Response.json({ invitations: [{ id: 'a', email: 'private@example.com', role: 'member', status: 'pending' }] }))
  await pending
  assert.equal(section.hidden, true)
  assert.equal(list.children.length, 0)
})
