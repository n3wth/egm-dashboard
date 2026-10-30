import { test } from 'node:test'
import assert from 'node:assert/strict'
import { handleBoingAccount } from './boing-account.mjs'

const user = { id: 'user_123', email: 'person@example.com', status: 'active', verified: 1 }
const request = (path = '/api/boing/account', method = 'GET') => new Request(`https://app.test${path}`, { method })

test('account exposes only the verified signed-in identity and prevents caching', async () => {
  const response = handleBoingAccount(request(), { ...user, extra: 'private' })
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('cache-control'), 'private, no-store')
  assert.deepEqual(await response.json(), { email: 'person@example.com' })
  assert.equal(handleBoingAccount(request('/api/boing/other'), user), null)
})

test('account denies unauthenticated or inactive identities and writes', () => {
  for (const value of [null, { ...user, verified: 0 }, { ...user, status: 'suspended' }, { ...user, email: '' }]) {
    assert.equal(handleBoingAccount(request(), value).status, 401)
  }
  assert.equal(handleBoingAccount(request('/api/boing/account', 'POST'), user).status, 405)
})
