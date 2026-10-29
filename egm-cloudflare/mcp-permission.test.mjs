import test from 'node:test'
import assert from 'node:assert/strict'
import { clearConnectPermissionCache, connectTokenIsAdmin } from './mcp-permission.mjs'

const env = { WORKOS_API_KEY: 'sk_test', WORKOS_RBAC_ORGANIZATION_ID: 'org_EGM', WORKOS_RBAC_PERMISSION: 'egm:dashboard:admin' }
const member = role => ({ data: [{ user_id: 'user_A', organization_id: 'org_EGM', status: 'active', role: { slug: role } }] })
function api(routes) {
  const calls = []
  return { calls, request: async url => { calls.push(url); const body = routes(url); return body ? Response.json(body) : new Response('no', { status: 404 }) } }
}

test('admin role or a role carrying the permission is admin', async () => {
  clearConnectPermissionCache()
  assert.equal(await connectTokenIsAdmin(env, 'user_A', 'org_EGM', api(() => member('admin'))), true)
  clearConnectPermissionCache()
  const custom = api(url => url.includes('/roles/') ? { permissions: ['egm:dashboard:admin'] } : member('owner'))
  assert.equal(await connectTokenIsAdmin(env, 'user_A', 'org_EGM', custom), true)
  assert.match(custom.calls[0], /user_id=user_A&organization_id=org_EGM&statuses=active/)
})

test('members, other orgs, missing memberships and API failures are denied', async () => {
  clearConnectPermissionCache()
  assert.equal(await connectTokenIsAdmin(env, 'user_A', 'org_EGM', api(url => url.includes('/roles/') ? { permissions: ['egm:dashboard:read'] } : member('member'))), false)
  assert.equal(await connectTokenIsAdmin(env, 'user_A', 'org_OTHER', api(() => assert.fail('no lookup for other orgs'))), false)
  clearConnectPermissionCache()
  assert.equal(await connectTokenIsAdmin(env, 'user_A', 'org_EGM', api(() => ({ data: [] }))), false)
  clearConnectPermissionCache()
  await assert.rejects(connectTokenIsAdmin(env, 'user_A', 'org_EGM', api(() => null)))
})

test('results are cached for a minute', async () => {
  clearConnectPermissionCache()
  let time = 0
  const lookup = api(() => member('admin'))
  await connectTokenIsAdmin(env, 'user_A', 'org_EGM', { ...lookup, now: () => time })
  await connectTokenIsAdmin(env, 'user_A', 'org_EGM', { ...lookup, now: () => time })
  assert.equal(lookup.calls.length, 1)
  time = 61000
  await connectTokenIsAdmin(env, 'user_A', 'org_EGM', { ...lookup, now: () => time })
  assert.equal(lookup.calls.length, 2)
})
