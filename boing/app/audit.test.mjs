import test from 'node:test'
import assert from 'node:assert/strict'
import { createWorkspaceAudit } from './audit.mjs'

class Element {
  constructor() { this.children = []; this.hidden = false; this.textContent = '' }
  append(...children) { this.children.push(...children) }
  replaceChildren() { this.children = [] }
}
const json = body => Response.json(body)
function setup(request) {
  const section = new Element(), status = new Element(), list = new Element(), requests = []
  const document = { createElement: () => new Element() }
  const tracked = async (path, options) => { requests.push({ path, options }); return request(path, options) }
  return { section, status, list, requests, audit: createWorkspaceAudit({ section, status, list, document, request: tracked }) }
}

test('owners load workspace activity scoped to the selected organization', async () => {
  const { section, status, list, requests, audit } = setup(async () => json({ truncated: true, events: [{ action: 'member.access_revoked', actor_id: 'user_Owner', occurred_at: '2026-10-01T12:00:00Z' }] }))
  await audit.load('org-a', 'owner')
  assert.equal(requests.length, 1)
  const [{ path, options }] = requests
  assert.equal(path, '/api/boing/audit')
  assert.equal(options.credentials, 'same-origin')
  assert.equal(options.cache, 'no-store')
  assert.equal(options.headers['x-boing-organization'], 'org-a')
  assert.equal(section.hidden, false)
  assert.equal(list.children.length, 1)
  assert.match(list.children[0].children[0].textContent, /^member access revoked · user_Owner · /)
  assert.equal(status.textContent, 'Showing the latest 50 events.')
})

test('non-owners never see the activity section or request it', async () => {
  const { section, requests, audit } = setup(async () => json({ events: [] }))
  await audit.load('org-a', 'member')
  assert.equal(section.hidden, true)
  assert.equal(requests.length, 0)
})

test('a delayed response from a previous workspace is discarded after switching', async () => {
  let release
  const { section, status, list, audit } = setup(() => new Promise(resolve => { release = () => resolve(json({ events: [{ action: 'workspace.created', actor_id: 'user_A', occurred_at: '2026-10-01T12:00:00Z' }] })) }))
  const pending = audit.load('org-a', 'owner')
  await audit.load('org-b', 'member')
  release()
  await pending
  assert.equal(section.hidden, true)
  assert.equal(list.children.length, 0)
  assert.equal(status.textContent, '')
})
