import test from 'node:test'
import assert from 'node:assert/strict'
import { refreshWorkosSession } from './workos-refresh.mjs'

const input = { clientId: 'client_test', clientSecret: 'secret', organizationId: 'org_test', refreshToken: 'old-token' }
test('refreshes only for configured organization and returns rotated tokens', async () => {
  const result = await refreshWorkosSession({ ...input, request: async (url, init) => {
    assert.equal(url, 'https://api.workos.com/user_management/authenticate')
    assert.equal(init.redirect, 'manual')
    assert.deepEqual(JSON.parse(init.body), { client_id: input.clientId, client_secret: input.clientSecret, organization_id: input.organizationId, grant_type: 'refresh_token', refresh_token: input.refreshToken })
    return Response.json({ user: { id: 'user_1' }, organization_id: 'org_test', access_token: 'new-access', refresh_token: 'new-refresh' })
  } })
  assert.deepEqual(result, { status: 'refreshed', userId: 'user_1', accessToken: 'new-access', refreshToken: 'new-refresh' })
  assert.deepEqual(await refreshWorkosSession({ ...input, request: async () => Response.json({ user: { id: 'user_1' }, organization_id: 'other', access_token: 'a', refresh_token: 'b' }) }), { status: 'failed' })
})
test('separates revocation from transient errors and never returns provider details', async () => {
  for (const [status, expected] of [[408, 'retryable'], [429, 'retryable'], [500, 'retryable'], [403, 'failed']]) {
    assert.deepEqual(await refreshWorkosSession({ ...input, request: async () => new Response('secret detail', { status }) }), { status: expected })
  }
  assert.deepEqual(await refreshWorkosSession({ ...input, request: async () => Response.json({ error: 'invalid_grant' }, { status: 400 }) }), { status: 'revoked' })
  assert.deepEqual(await refreshWorkosSession({ ...input, request: async () => { throw Error('secret detail') } }), { status: 'retryable' })
})
