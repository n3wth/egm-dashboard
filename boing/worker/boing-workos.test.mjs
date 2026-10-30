import test from 'node:test'
import assert from 'node:assert/strict'
import { verifyWorkosMembership } from './boing-workos.mjs'

const env = { WORKOS_API_KEY: 'test-key' }
const user = { id: 'user_123', verified: 1, status: 'active' }
const membership = { user_id: user.id, organization_id: 'org_123', status: 'active' }
const list = (data, after = null) => Response.json({ object: 'list', data, list_metadata: { after } })

test('checks the verified identity and server-selected organization against WorkOS', async () => {
  const result = await verifyWorkosMembership(env, user, 'org_123', async (url, options) => {
    const parsed = new URL(url)
    assert.equal(parsed.origin, 'https://api.workos.com')
    assert.equal(parsed.searchParams.get('user_id'), user.id)
    assert.equal(parsed.searchParams.get('organization_id'), 'org_123')
    assert.equal(options.redirect, 'manual')
    return list([membership])
  })
  assert.deepEqual(result, { status: 'allowed' })
})

test('denies missing, revoked, mismatched and ambiguous membership results', async () => {
  const results = [list([]), list([{ ...membership, status: 'inactive' }]),
    list([{ ...membership, status: 'pending' }]), list([{ ...membership, user_id: 'user_other' }]),
    list([{ ...membership, organization_id: 'org_other' }]), list([membership, membership]),
    list([membership], 'another-page'), Response.json({ data: [membership] })]
  for (const response of results) {
    assert.deepEqual(await verifyWorkosMembership(env, user, 'org_123', async () => response), { status: 'denied' })
  }
})

test('fails closed for unverified identities and provider failures', async () => {
  let called = false
  const request = async () => { called = true; throw new Error('offline') }
  for (const identity of [null, { ...user, verified: 0 }, { ...user, status: 'revoked' }, { ...user, id: 'invalid' }]) {
    assert.deepEqual(await verifyWorkosMembership(env, identity, 'org_123', request), { status: 'denied' })
  }
  assert.equal(called, false)
  assert.deepEqual(await verifyWorkosMembership(env, user, 'org_123', request), { status: 'unavailable' })
  assert.deepEqual(await verifyWorkosMembership(env, user, 'org_123', async () => new Response('', { status: 503 })), { status: 'unavailable' })
  assert.deepEqual(await verifyWorkosMembership(env, user, 'org_123', async () => new Response('invalid')), { status: 'unavailable' })
  assert.deepEqual(await verifyWorkosMembership({}, user, 'org_123', request), { status: 'denied' })
})

test('required membership binding accepts only an identified and versioned provider membership', async () => {
  const required = { ...env, BOING_MEMBERSHIP_BINDING_REQUIRED: 'true' }
  const identified = { ...membership, id: 'om_123', updated_at: '2026-01-01T00:00:00.000Z' }
  assert.deepEqual(await verifyWorkosMembership(required, user, 'org_123', async () => list([identified])),
    { status: 'allowed', membershipId: 'om_123', updatedAt: '2026-01-01T00:00:00.000Z' })
  for (const invalid of [membership, { ...identified, id: 'user_123' }, { ...identified, updated_at: 'invalid' }, { ...identified, updated_at: null }]) {
    assert.deepEqual(await verifyWorkosMembership(required, user, 'org_123', async () => list([invalid])), { status: 'denied' })
  }
})
