import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { INVITES_SCHEMA, createInvitation } from './boing-invites.mjs'
import { AUDIT_SCHEMA } from './boing-audit.mjs'
import { INVITATION_RESERVATION_SCHEMA, reserveBoundInvitation, markInvitationRemoteAttempt } from './boing-invite-reservation.mjs'
import { INVITATION_RECONCILIATION_SCHEMA, reconcileInvitationAttempt } from './boing-invite-reconcile.mjs'

const now = Date.parse('2026-10-28T12:00:00.000Z')
const user = { id: 'user_Guest', email: 'guest@example.com', verified: 1, status: 'active' }
async function setup() {
  const sql = new DatabaseSync(':memory:')
  sql.exec(readFileSync(new URL('./boing-tenancy-schema.sql', import.meta.url), 'utf8'))
  sql.exec(INVITES_SCHEMA)
  sql.exec(AUDIT_SCHEMA)
  sql.exec(INVITATION_RESERVATION_SCHEMA)
  sql.exec(INVITATION_RECONCILIATION_SCHEMA)
  sql.exec(`INSERT INTO boing_identities VALUES('user_Owner','owner@example.com','active'),('user_Guest','guest@example.com','active');
    INSERT INTO boing_organizations VALUES('local','Workspace','org_Test','active',0,'now');
    INSERT INTO boing_memberships VALUES('local','user_Owner','owner','active','now');`)
  const DB = { prepare(query) { return { bind(...args) { return {
    async first() { return sql.prepare(query).get(...args) ?? null },
    async run() { return { meta: { changes: Number(sql.prepare(query).run(...args).changes) } } }
  } } } }, async batch(statements) { sql.exec('BEGIN'); try { const result = []; for (const statement of statements) result.push(await statement.run()); sql.exec('COMMIT'); return result } catch (error) { sql.exec('ROLLBACK'); throw error } } }
  const invite = await createInvitation(DB, 'user_Owner', 'local', { organizationId: 'local', email: user.email, now: new Date(now).toISOString() })
  sql.prepare('INSERT INTO boing_workos_invitation_bindings VALUES(?,?)').run(invite.id, 'invitation_Test')
  let calls = 0
  const request = async (url, options) => {
    calls++
    assert.equal(options.method ?? 'GET', 'GET')
    return url.includes('/invitations/by_token/') ? Response.json({ object: 'invitation', id: 'invitation_Test', state: 'pending', accepted_at: null, revoked_at: null, expires_at: '2026-10-30T12:00:00.000Z', email: user.email, organization_id: 'org_Test', role_slug: 'member' }) : Response.json({ object: 'list', data: [], list_metadata: { after: null } })
  }
  return { sql, env: { DB, WORKOS_API_KEY: 'test' }, request, calls: () => calls }
}

test('only one current reservation is admitted and no provider writes occur', async () => {
  const f = await setup()
  const options = { request: f.request, now }
  const results = await Promise.all(Array.from({ length: 8 }, () => reserveBoundInvitation(f.env, 'provider_token_123456', user, options)))
  assert.equal(results.filter(item => item.status === 'held').length, 1)
  assert.equal(f.sql.prepare('SELECT count(*) n FROM boing_invitation_reservations').get().n, 1)
  assert.equal(f.calls(), 16)
})

test('reconciliation records only observations and never retries or grants access', async () => {
  const f = await setup(), options = { request: f.request, now }
  const held = await reserveBoundInvitation(f.env, 'provider_token_123456', user, options)
  assert.equal(await markInvitationRemoteAttempt(f.env, 'provider_token_123456', user, held.reservationId, options), true)
  assert.deepEqual(await reconcileInvitationAttempt(f.env, 'provider_token_123456', user, held.reservationId, options), { status: 'pending' })
  assert.equal(f.sql.prepare('SELECT outcome FROM boing_invitation_reconciliation_events').get().outcome, 'pending')
  assert.equal(f.sql.prepare('SELECT status FROM boing_invitation_reservations').get().status, 'remote_attempted')
  assert.equal(f.sql.prepare("SELECT count(*) n FROM boing_memberships WHERE user_id='user_Guest'").get().n, 0)
  const wrong = { ...user, id: 'user_Owner', email: 'owner@example.com' }
  assert.equal((await reconcileInvitationAttempt(f.env, 'provider_token_123456', wrong, held.reservationId, options)).status, 'denied')
})

test('accepted provider outcome requires the exact user and active membership; revocation needs review', async () => {
  const f = await setup(), options = { request: f.request, now }
  const held = await reserveBoundInvitation(f.env, 'provider_token_123456', user, options)
  await markInvitationRemoteAttempt(f.env, 'provider_token_123456', user, held.reservationId, options)
  const request = async (url, opts) => {
    assert.equal(opts.method ?? 'GET', 'GET')
    return url.includes('/invitations/by_token/')
      ? Response.json({ object: 'invitation', id: 'invitation_Test', state: 'accepted', accepted_user_id: 'user_Guest', accepted_at: '2026-10-28T12:00:00.000Z', revoked_at: null, expires_at: '2026-10-30T12:00:00.000Z', email: user.email, organization_id: 'org_Test', role_slug: 'member' })
      : Response.json({ object: 'list', data: [{ user_id: 'user_Guest', organization_id: 'org_Test', status: 'active' }], list_metadata: { after: null } })
  }
  assert.equal((await reconcileInvitationAttempt(f.env, 'provider_token_123456', user, held.reservationId, { now, request })).status, 'accepted')
  const wrong = async (url, opts) => url.includes('/invitations/by_token/') ? Response.json({ ...(await (await request(url, opts)).json()), accepted_user_id: 'user_Other' }) : request(url, opts)
  assert.equal((await reconcileInvitationAttempt(f.env, 'provider_token_123456', user, held.reservationId, { now, request: wrong })).status, 'review')
  f.sql.exec("UPDATE boing_invitations SET revoked_at='2026-10-28T12:00:00.000Z'")
  assert.equal((await reconcileInvitationAttempt(f.env, 'provider_token_123456', user, held.reservationId, { now, request })).status, 'review')
  assert.equal(f.sql.prepare("SELECT count(*) n FROM boing_memberships WHERE user_id='user_Guest'").get().n, 0)
})

test('provider outages and local revocation during inspection fail closed', async () => {
  const f = await setup(), options = { request: f.request, now }
  const held = await reserveBoundInvitation(f.env, 'provider_token_123456', user, options)
  await markInvitationRemoteAttempt(f.env, 'provider_token_123456', user, held.reservationId, options)
  assert.equal((await reconcileInvitationAttempt(f.env, 'provider_token_123456', user, held.reservationId, { now, request: async () => { throw Error('offline') } })).status, 'unavailable')
  const before = f.sql.prepare('SELECT count(*) n FROM boing_invitation_reconciliation_events').get().n
  const racing = async (url, opts) => { const result = await f.request(url, opts); f.sql.exec("UPDATE boing_invitations SET revoked_at='2026-10-28T12:00:00.000Z'"); return result }
  assert.equal((await reconcileInvitationAttempt(f.env, 'provider_token_123456', user, held.reservationId, { now, request: racing })).status, 'denied')
  assert.equal(f.sql.prepare('SELECT count(*) n FROM boing_invitation_reconciliation_events').get().n, before)
})

test('a remote attempt is never automatically retried, and revocation blocks attempt', async () => {
  const f = await setup(), options = { request: f.request, now }
  const held = await reserveBoundInvitation(f.env, 'provider_token_123456', user, options)
  assert.equal(await markInvitationRemoteAttempt(f.env, 'provider_token_123456', user, held.reservationId, options), true)
  assert.equal(await markInvitationRemoteAttempt(f.env, 'provider_token_123456', user, held.reservationId, options), false)
  assert.equal((await reserveBoundInvitation(f.env, 'provider_token_123456', user, { ...options, now: now + 301000 })).status, 'denied')
  assert.equal(f.sql.prepare('SELECT status FROM boing_invitation_reservations').get().status, 'remote_attempted')
  f.sql.exec("UPDATE boing_invitation_reservations SET status='held',expires_at=9999999999999; UPDATE boing_invitations SET revoked_at='2026-10-28T12:01:00.000Z'")
  assert.equal(await markInvitationRemoteAttempt(f.env, 'provider_token_123456', user, held.reservationId, options), false)
})
