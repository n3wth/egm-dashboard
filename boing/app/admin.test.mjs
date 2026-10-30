import test from 'node:test'
import assert from 'node:assert/strict'
import { adminRequest } from './admin.mjs'

test('platform administration requests are same-origin and fail closed', async () => {
  let call
  const request = async (path, options) => { call = { path, options }; return Response.json({ available: true }) }
  assert.equal((await adminRequest(request)).available, true)
  assert.equal(call.path, '/api/boing/platform/workspaces')
  assert.equal(call.options.credentials, 'same-origin')
  assert.equal(call.options.cache, 'no-store')
  const input = { name: 'Example', ownerEmail: 'owner@example.com', ownerUserId: 'user_123', workosOrganizationId: 'org_123' }
  await adminRequest(request, input)
  assert.equal(call.options.method, 'POST')
  assert.deepEqual(JSON.parse(call.options.body), input)
  await assert.rejects(adminRequest(async () => new Response(null, { status: 403 })))
})
