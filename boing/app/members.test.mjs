import test from 'node:test'
import assert from 'node:assert/strict'
import { createWorkspaceMembers } from './members.mjs'

class Element {
  constructor() { this.children = []; this.hidden = false; this.textContent = ''; this.disabled = false }
  append(...children) { this.children.push(...children) }
  replaceChildren() { this.children = [] }
}
const json = body => Response.json(body)
function setup() {
  const section = new Element(), status = new Element(), list = new Element(), requests = []
  const document = { createElement: () => new Element() }
  const request = async (path, options) => {
    requests.push({ path, options })
    if (path === '/api/boing/account') return json({ email: 'owner@example.com' })
    if (path === '/api/boing/members') return json({ members: [{ user_id: 'user_Owner', email: 'owner@example.com', role: 'owner' }, { user_id: 'user_Member', email: 'member@example.com', role: 'member' }] })
    if (path.endsWith('/revoke')) return json({ revoked: true, providerMembershipUnchanged: true })
    throw new Error('unexpected')
  }
  return { section, status, list, requests, manager: createWorkspaceMembers({ section, status, list, document, request }) }
}

test('owners review a separate confirmation before removing Boing access', async () => {
  const { section, status, list, requests, manager } = setup()
  await manager.load('org-a', 'owner')
  assert.equal(section.hidden, false)
  assert.equal(list.children[0].children.length, 1, 'the signed-in owner cannot remove themself')
  const [, remove, confirm, cancel] = list.children[1].children
  assert.equal(confirm.hidden, true)
  remove.onclick()
  assert.match(status.textContent, /WorkOS access stays unchanged/)
  assert.equal(requests.filter(item => item.path.endsWith('/revoke')).length, 0)
  cancel.onclick()
  assert.equal(confirm.hidden, true)
  remove.onclick()
  await confirm.onclick()
  const write = requests.find(item => item.path.endsWith('/revoke'))
  assert.equal(write.path, '/api/boing/members/user_Member/revoke')
  assert.equal(write.options.headers['x-boing-organization'], 'org-a')
  assert.equal(write.options.method, 'POST')
})

test('member controls clear and disappear when switching to a non-owner workspace', async () => {
  const { manager, section, list, requests } = setup()
  await manager.load('org-a', 'owner')
  await manager.load('org-b', 'member')
  assert.equal(section.hidden, true)
  assert.equal(list.children.length, 0)
  assert.equal(requests.length, 2)
})
