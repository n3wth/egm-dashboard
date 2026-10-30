import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadAccount } from './account.mjs'

test('loads the server-verified account using same-origin, uncached requests', async () => {
  const email = {}, retry = {}
  await loadAccount({ email, retry, request: async (path, options) => {
    assert.equal(path, '/api/boing/account')
    assert.equal(options.credentials, 'same-origin')
    assert.equal(options.cache, 'no-store')
    return Response.json({ email: 'person@example.com' })
  } })
  assert.equal(email.textContent, 'person@example.com')
  assert.equal(retry.hidden, true)
})

test('account errors display a retry rather than stale identity', async () => {
  const email = { textContent: 'old@example.com' }, retry = {}
  await loadAccount({ email, retry, request: async () => new Response(null, { status: 503 }) })
  assert.match(email.textContent, /Could not load/)
  assert.equal(retry.hidden, false)
})

test('an expired session offers sign-in instead of retrying stale identity', async () => {
  const email = { textContent: 'old@example.com' }, retry = {}, signIn = {}
  await loadAccount({ email, retry, signIn, request: async () => new Response(null, { status: 401 }) })
  assert.match(email.textContent, /session has ended/)
  assert.equal(signIn.hidden, false)
  assert.equal(retry.hidden, true)
  await loadAccount({ email, retry, signIn, request: async () => new Response(null, { status: 503 }) })
  assert.equal(signIn.hidden, true)
  assert.equal(retry.hidden, false)
})
