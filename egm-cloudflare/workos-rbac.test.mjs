import test from 'node:test'
import assert from 'node:assert/strict'
import { verifyWorkosPermission } from './workos-rbac.mjs'

const now = 1800000000000
const options = { issuer: 'https://api.workos.com', clientId: 'client_ABC123', subject: 'user_123', organizationId: 'org_123', permission: 'egm:users:manage', time: now }
const base = { iss: options.issuer, client_id: options.clientId, sub: options.subject, org_id: options.organizationId, exp: now / 1000 + 60, permissions: [options.permission] }
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url')
const keys = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'])
const jwk = { ...await crypto.subtle.exportKey('jwk', keys.publicKey), kid: 'one', alg: 'RS256', use: 'sig' }
const request = async (url, init) => { assert.equal(url, 'https://api.workos.com/sso/jwks/client_ABC123'); assert.equal(init.redirect, 'manual'); return Response.json({ keys: [jwk] }) }
async function signed(claims = base, header = { alg: 'RS256', kid: 'one' }) {
  const data = `${encode(header)}.${encode(claims)}`
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keys.privateKey, new TextEncoder().encode(data))
  return `${data}.${Buffer.from(signature).toString('base64url')}`
}

test('accepts only correctly signed matching WorkOS session claims', async () => {
  const token = await signed()
  assert.deepEqual(await verifyWorkosPermission(token, { ...options, request }), base)
  for (const [field, value] of Object.entries({ iss: 'https://other.example', client_id: 'client_OTHER', sub: 'other', org_id: 'other', exp: now / 1000, permissions: [] })) {
    assert.equal(await verifyWorkosPermission(await signed({ ...base, [field]: value }), { ...options, request }), null)
  }
  assert.equal(await verifyWorkosPermission(await signed({ ...base, nbf: now / 1000 + 1 }), { ...options, request }), null)
  assert.equal(await verifyWorkosPermission(token, { ...options, clientId: 'client_OTHER', request }), null)
})

test('accepts the default admin role only for a valid signed token in the configured organization', async () => {
  const admin = { ...base, role: 'admin', permissions: [] }
  assert.deepEqual(await verifyWorkosPermission(await signed(admin), { ...options, request }), admin)
  for (const [field, value] of Object.entries({ role: 'member', org_id: 'org_other', client_id: 'client_OTHER', iss: 'https://other.example', sub: 'user_other', exp: now / 1000 })) {
    assert.equal(await verifyWorkosPermission(await signed({ ...admin, [field]: value }), { ...options, request }), null)
  }
  const parts = (await signed({ ...admin, role: 'member' })).split('.')
  parts[1] = encode(admin)
  assert.equal(await verifyWorkosPermission(parts.join('.'), { ...options, request }), null)
})

test('rejects malformed, unsigned, tampered, ambiguous keys and failed JWKS requests', async () => {
  const token = await signed()
  assert.equal(await verifyWorkosPermission(`${token.slice(0, -1)}!`, { ...options, request }), null)
  assert.equal(await verifyWorkosPermission(await signed(base, { alg: 'none', kid: 'one' }), { ...options, request }), null)
  assert.equal(await verifyWorkosPermission(await signed(base, { alg: 'RS256', kid: 'one', crit: ['x'] }), { ...options, request }), null)
  assert.equal(await verifyWorkosPermission(token, { ...options, request: async () => Response.json({ keys: [jwk, jwk] }) }), null)
  assert.equal(await verifyWorkosPermission(token, { ...options, request: async () => { throw Error('offline') } }), null)
  const parts = token.split('.')
  parts[1] = encode({ ...base, permissions: ['egm:users:manage', 'extra'] })
  assert.equal(await verifyWorkosPermission(parts.join('.'), { ...options, request }), null)
})
