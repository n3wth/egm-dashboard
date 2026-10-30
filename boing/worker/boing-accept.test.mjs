import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { BOING_IDENTITY_SCHEMA } from './boing-identity.mjs'
import { AUDIT_SCHEMA } from './boing-audit.mjs'
import { INVITES_SCHEMA, createInvitation, bindWorkosInvitation } from './boing-invites.mjs'
import { acceptBoingInvitation, acceptBoundWorkosInvitation, acceptProvisionedInvitation, acceptWorkosInvitationToken } from './boing-accept.mjs'
import { handleInvitationAcceptance } from './boing-onboarding.mjs'
import { createBoingWorker } from './boing-worker.mjs'
import { preflightBoundInviteForUser } from './boing-invite-auth.mjs'

const at = () => '2026-10-28T12:00:00.000Z'
const user = { id: 'user_123', email: 'Guest@example.com', verified: 1, status: 'active' }

async function fixture() {
  const sql = new DatabaseSync(':memory:')
  sql.exec('PRAGMA foreign_keys=ON')
  sql.exec(BOING_IDENTITY_SCHEMA)
  sql.exec(readFileSync(new URL('./boing-tenancy-schema.sql', import.meta.url), 'utf8'))
  sql.exec(INVITES_SCHEMA)
  sql.exec(AUDIT_SCHEMA)
  sql.exec(`INSERT INTO boing_identities VALUES ('user_123','guest@example.com','active'),('user_owner','owner@example.com','active');
    INSERT INTO boing_organizations VALUES ('local1','One','org_123','active',0,'now');
    INSERT INTO boing_memberships VALUES ('local1','user_owner','owner','active','now');`)
  const db = {
    prepare(query) { return { bind(...args) { return {
      async first() { return sql.prepare(query).get(...args) ?? null },
      async run() { return { meta: { changes: Number(sql.prepare(query).run(...args).changes) } } },
    } } } },
    async batch(statements) { sql.exec('BEGIN'); try { const out = []; for (const statement of statements) out.push(await statement.run()); sql.exec('COMMIT'); return out } catch (error) { sql.exec('ROLLBACK'); throw error } },
  }
  const invite = await createInvitation(db, 'user_owner', 'local1', { organizationId: 'local1', email: user.email, now: at() })
  const request = async url => {
    const parsed = new URL(url)
    assert.equal(parsed.searchParams.get('user_id'), 'user_123')
    assert.equal(parsed.searchParams.get('organization_id'), 'org_123')
    return Response.json({ object: 'list', list_metadata: { after: null }, data: [{ user_id: 'user_123', organization_id: 'org_123', status: 'active' }] })
  }
  return { sql, db, env: { DB: db, WORKOS_API_KEY: 'test' }, token: invite.token, request }
}

test('post-sign-in preflight checks the exact recipient and never changes provider membership', async () => {
  const { sql, env } = await fixture()
  const invitationId = sql.prepare('SELECT id FROM boing_invitations').get().id
  sql.prepare('INSERT INTO boing_workos_invitation_bindings VALUES (?,?)').run(invitationId, 'invitation_123')
  const invite = { object: 'invitation', id: 'invitation_123', state: 'pending', accepted_at: null, revoked_at: null, expires_at: '2026-10-30T12:00:00.000Z', email: 'guest@example.com', organization_id: 'org_123', role_slug: 'member' }
  let status = 'pending', calls = 0
  const request = async (url, options) => {
    calls++
    assert.equal(options.redirect, 'manual')
    assert.equal(options.method ?? 'GET', 'GET')
    if (url.includes('/invitations/by_token/')) return Response.json(invite)
    return Response.json({ object: 'list', list_metadata: { after: null }, data: [{ user_id: user.id, organization_id: 'org_123', status }] })
  }
  const options = { request, now: Date.parse(at()) }
  assert.deepEqual(await preflightBoundInviteForUser(env, 'provider_token_123456', user, options), { status: 'ready', organizationId: 'local1', invitationId, workosInvitationId: 'invitation_123', workosOrganizationId: 'org_123' })
  assert.equal(calls, 2)
  status = 'inactive'
  assert.deepEqual(await preflightBoundInviteForUser(env, 'provider_token_123456', user, options), { status: 'denied' })
  status = 'active'
  assert.deepEqual(await preflightBoundInviteForUser(env, 'provider_token_123456', user, options), { status: 'denied' })
  calls = 0
  assert.deepEqual(await preflightBoundInviteForUser(env, 'provider_token_123456', { ...user, email: 'other@example.com' }, options), { status: 'denied' })
  assert.equal(calls, 1)
  assert.equal(sql.prepare("SELECT count(*) n FROM boing_memberships WHERE user_id='user_123'").get().n, 0)
})

test('post-sign-in preflight fails closed on local revocation during the provider check', async () => {
  const { sql, env } = await fixture()
  const invitationId = sql.prepare('SELECT id FROM boing_invitations').get().id
  sql.prepare('INSERT INTO boing_workos_invitation_bindings VALUES (?,?)').run(invitationId, 'invitation_123')
  const request = async url => {
    if (url.includes('/invitations/by_token/')) return Response.json({ object: 'invitation', id: 'invitation_123', state: 'pending', accepted_at: null, revoked_at: null, expires_at: '2026-10-30T12:00:00.000Z', email: 'guest@example.com', organization_id: 'org_123', role_slug: 'member' })
    sql.prepare('UPDATE boing_invitations SET revoked_at=? WHERE id=?').run(at(), invitationId)
    return Response.json({ object: 'list', list_metadata: { after: null }, data: [] })
  }
  assert.deepEqual(await preflightBoundInviteForUser(env, 'provider_token_123456', user, { request, now: Date.parse(at()) }), { status: 'denied' })
})

test('accepts a matching active WorkOS membership exactly once', async () => {
  const { sql, env, token, request } = await fixture()
  assert.deepEqual(await acceptProvisionedInvitation(env, token, user, { request, now: at }), { status: 'accepted', organizationId: 'local1' })
  assert.deepEqual(await acceptProvisionedInvitation(env, token, user, { request, now: at }), { status: 'already_accepted', organizationId: 'local1' })
  assert.equal(sql.prepare("SELECT count(*) n FROM boing_memberships WHERE user_id='user_123'").get().n, 1)
  const events = sql.prepare('SELECT organization_id,actor_id,action FROM boing_audit_events').all()
  assert.deepEqual(events.map(row => ({ ...row })), [
    { organization_id: 'local1', actor_id: 'user_owner', action: 'invitation.created' },
    { organization_id: 'local1', actor_id: 'user_123', action: 'invitation.accepted' },
  ])
})

test('invitation acceptance binds the approved membership version and rejects a later version', async () => {
  const { sql, env, token } = await fixture()
  sql.exec(readFileSync(new URL('./boing-membership-binding-migration.sql', import.meta.url), 'utf8'))
  env.BOING_MEMBERSHIP_BINDING_REQUIRED = 'true'
  let updated = '2026-10-28T11:00:00.000Z'
  const request = async () => Response.json({ object: 'list', list_metadata: { after: null }, data: [{ id: 'om_123', user_id: user.id, organization_id: 'org_123', status: 'active', updated_at: updated }] })
  assert.equal((await acceptProvisionedInvitation(env, token, user, { request, now: at })).status, 'accepted')
  const binding = sql.prepare("SELECT workos_membership_id,workos_updated_at FROM boing_workos_membership_bindings WHERE user_id='user_123'").get()
  assert.equal(binding.workos_membership_id, 'om_123')
  assert.equal(binding.workos_updated_at, updated)
  assert.equal((await acceptProvisionedInvitation(env, token, user, { request, now: at })).status, 'already_accepted')
  updated = '2026-10-28T11:01:00.000Z'
  assert.equal((await acceptProvisionedInvitation(env, token, user, { request, now: at })).status, 'denied')
})

test('audit storage failure rolls back the invitation claim and membership', async () => {
  const { sql, env, token, request } = await fixture()
  sql.exec('DROP TABLE boing_audit_events')
  assert.equal((await acceptProvisionedInvitation(env, token, user, { request, now: at })).status, 'unavailable')
  assert.equal(sql.prepare("SELECT count(*) n FROM boing_memberships WHERE user_id='user_123'").get().n, 0)
  assert.equal(sql.prepare('SELECT accepted_at FROM boing_invitations').get().accepted_at, null)
})

test('provider token accepts only its bound invitation for the exact recipient and role', async () => {
  const { sql, env, request } = await fixture()
  const invitationId = sql.prepare('SELECT id FROM boing_invitations').get().id
  sql.prepare('INSERT INTO boing_workos_invitation_bindings VALUES (?,?)').run(invitationId, 'invitation_123')
  const base = { object: 'invitation', id: 'invitation_123', state: 'accepted', accepted_user_id: user.id, email: 'guest@example.com', organization_id: 'org_123', role_slug: 'member', accepted_at: at(), revoked_at: null }
  let invitation = base
  const provider = async (url, options) => {
    if (url.includes('organization_memberships')) return request(url)
    assert.equal(options.redirect, 'manual')
    return Response.json(invitation)
  }
  for (const change of [{ email: 'other@example.com' }, { organization_id: 'org_other' }, { accepted_user_id: 'user_other' }, { role_slug: 'admin' }, { state: 'pending' }, { revoked_at: at() }]) {
    invitation = { ...base, ...change }
    assert.equal((await acceptWorkosInvitationToken(env, 'provider_token_123456', user, { request: provider, now: at })).status, 'denied')
  }
  invitation = base
  assert.deepEqual(await acceptWorkosInvitationToken(env, 'provider_token_123456', user, { request: provider, now: at }), { status: 'accepted', organizationId: 'local1' })
  assert.equal((await acceptWorkosInvitationToken(env, 'provider_token_123456', user, { request: provider, now: at })).status, 'already_accepted')
  sql.exec("UPDATE boing_memberships SET status='suspended' WHERE user_id='user_123'")
  assert.equal((await acceptWorkosInvitationToken(env, 'provider_token_123456', user, { request: provider, now: at })).status, 'denied')
})

test('provider token acceptance rejects role changes while checking provider membership', async () => {
  const { sql, env, request } = await fixture()
  const invitationId = sql.prepare('SELECT id FROM boing_invitations').get().id
  sql.prepare('INSERT INTO boing_workos_invitation_bindings VALUES (?,?)').run(invitationId, 'invitation_123')
  const provider = async url => {
    if (url.includes('organization_memberships')) {
      const result = await request(url)
      sql.exec("UPDATE boing_invitations SET role='admin'")
      return result
    }
    return Response.json({ object: 'invitation', id: 'invitation_123', state: 'accepted', accepted_user_id: user.id, email: 'guest@example.com', organization_id: 'org_123', role_slug: 'member', accepted_at: at(), revoked_at: null })
  }
  assert.equal((await acceptWorkosInvitationToken(env, 'provider_token_123456', user, { request: provider, now: at })).status, 'denied')
  assert.equal(sql.prepare("SELECT count(*) n FROM boing_memberships WHERE user_id='user_123'").get().n, 0)
})

test('worker accepts an invitation only for the authenticated recipient and same origin', async () => {
  const { sql, env, token, request } = await fixture()
  const config = { ...env, APP_URL: 'https://app.test' }
  const sessionToken = 'a'.repeat(43)
  const worker = createBoingWorker({
    authenticate: async () => ({ status: 'active', user }),
    acceptInvitation: (req, workerEnv, identity) => handleInvitationAcceptance(req, workerEnv, identity, {
      accept: (e, invitationToken, u) => acceptProvisionedInvitation(e, invitationToken, u, { request, now: at }),
    }),
  })
  const call = (origin, body, session = true) => worker.fetch(new Request('https://app.test/api/boing/invitations/accept', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}), ...(session ? { cookie: `__Host-boing_session=${sessionToken}` } : {}) },
    body,
  }), config)
  assert.equal((await call('https://evil.test', JSON.stringify({ token }))).status, 403)
  assert.equal((await call(null, JSON.stringify({ token }))).status, 403)
  assert.equal((await call('https://app.test', JSON.stringify({ token }), false)).status, 401)
  assert.equal((await call('https://app.test', JSON.stringify({ token, organizationId: 'local1' }))).status, 400)
  assert.equal((await call('https://app.test', JSON.stringify({ token: 'x'.repeat(2100) }))).status, 400)
  assert.equal(sql.prepare("SELECT count(*) n FROM boing_memberships WHERE user_id='user_123'").get().n, 0)
  const accepted = await call('https://app.test', JSON.stringify({ token }))
  assert.equal(accepted.status, 200)
  assert.equal(accepted.headers.get('cache-control'), 'private, no-store')
  assert.deepEqual(await accepted.json(), { organizationId: 'local1' })
  assert.equal((await call('https://app.test', JSON.stringify({ token }))).status, 200)
  assert.equal(sql.prepare("SELECT count(*) n FROM boing_memberships WHERE user_id='user_123'").get().n, 1)
})

test('acceptance endpoint supports a provider token without returning it', async () => {
  const providerToken = 'provider_token_123456'
  const request = new Request('https://app.test/api/boing/invitations/accept', {
    method: 'POST', headers: { origin: 'https://app.test', 'content-type': 'application/json' }, body: JSON.stringify({ workosToken: providerToken })
  })
  const response = await handleInvitationAcceptance(request, { APP_URL: 'https://app.test' }, user, {
    acceptWorkos: async (_env, token, identity) => {
      assert.equal(token, providerToken)
      assert.equal(identity.id, user.id)
      return { status: 'accepted', organizationId: 'local1' }
    }
  })
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { organizationId: 'local1' })
})

test('retry never regrants revoked access and rechecks provider membership and mapping', async () => {
  for (const change of ['local', 'provider', 'mapping', 'other_user']) {
    const { sql, env, token, request } = await fixture()
    assert.equal((await acceptProvisionedInvitation(env, token, user, { request, now: at })).status, 'accepted')
    let retryRequest = request
    let retryUser = user
    if (change === 'local') sql.exec("UPDATE boing_memberships SET status='suspended' WHERE user_id='user_123'")
    if (change === 'provider') retryRequest = async () => Response.json({ object: 'list', list_metadata: { after: null }, data: [] })
    if (change === 'mapping') retryRequest = async url => { const result = await request(url); sql.exec("UPDATE boing_organizations SET workos_organization_id='org_other'"); return result }
    if (change === 'other_user') retryUser = { ...user, id: 'user_other' }
    assert.equal((await acceptProvisionedInvitation(env, token, retryUser, { request: retryRequest, now: at })).status, 'denied')
    assert.equal(sql.prepare("SELECT count(*) n FROM boing_memberships WHERE user_id='user_123'").get().n, 1)
  }
})

test('wrong recipient, absent provider membership, and provider outage never claim', async () => {
  const { sql, env, token, request } = await fixture()
  assert.equal((await acceptProvisionedInvitation(env, token, { ...user, email: 'wrong@example.com' }, { request, now: at })).status, 'denied')
  const missing = async () => Response.json({ object: 'list', list_metadata: { after: null }, data: [] })
  assert.equal((await acceptProvisionedInvitation(env, token, user, { request: missing, now: at })).status, 'denied')
  assert.equal((await acceptProvisionedInvitation(env, token, user, { request: async () => { throw Error('offline') }, now: at })).status, 'unavailable')
  assert.equal(sql.prepare('SELECT accepted_at FROM boing_invitations').get().accepted_at, null)
})

test('revocation, expiration, suspension, or organization remapping during provider verification fails closed', async () => {
  for (const mutation of ["UPDATE boing_invitations SET revoked_at='now'", "UPDATE boing_organizations SET workos_organization_id='org_other'", "UPDATE boing_organizations SET status='suspended' WHERE id='local1'", "UPDATE boing_identities SET status='suspended' WHERE user_id='user_123'"]) {
    const { sql, env, token, request } = await fixture()
    const changed = async url => { const response = await request(url); sql.exec(mutation); return response }
    assert.equal((await acceptProvisionedInvitation(env, token, user, { request: changed, now: at })).status, 'denied')
    assert.equal(sql.prepare("SELECT count(*) n FROM boing_memberships WHERE user_id='user_123'").get().n, 0)
  }
  const { env, token, request } = await fixture()
  let calls = 0
  const clock = () => ++calls === 1 ? at() : '2026-11-10T00:00:00.000Z'
  assert.equal((await acceptProvisionedInvitation(env, token, user, { request, now: clock })).status, 'denied')
})

test('bound WorkOS invitation requires exact provider recipient, organization and acceptance', async () => {
  const { sql, env, token, request } = await fixture()
  const localId = sql.prepare('SELECT id FROM boing_invitations').get().id
  const owner = { id: 'user_owner', email: 'owner@example.com', verified: 1, status: 'active' }
  const providerToken = 'provider_token_123456'
  const pending = { object: 'invitation', id: 'invitation_123', state: 'pending', email: 'guest@example.com', organization_id: 'org_123', role_slug: 'member', expires_at: '2026-11-01T12:00:00.000Z', accepted_at: null, revoked_at: null }
  let provider = pending
  let writes = 0
  const providerRequest = async (url, init) => {
    if (init?.method && init.method !== 'GET') writes++
    if (url.includes('organization_memberships')) {
      const parsed = new URL(url)
      return Response.json({ object: 'list', list_metadata: { after: null }, data: [{ user_id: parsed.searchParams.get('user_id'), organization_id: 'org_123', status: 'active' }] })
    }
    return Response.json(provider)
  }
  assert.equal(await bindWorkosInvitation(env, owner, 'local1', localId, providerToken, { request: providerRequest, now: at() }), true)
  assert.equal(await bindWorkosInvitation(env, owner, 'local1', localId, providerToken, { request: providerRequest, now: at() }), false)
  assert.equal((await acceptProvisionedInvitation(env, token, user, { request: providerRequest, now: at })).status, 'denied')
  assert.equal((await acceptBoundWorkosInvitation(env, token, user, { request: providerRequest, now: at })).status, 'denied')
  const accepted = { ...pending, state: 'accepted', accepted_at: at(), accepted_user_id: user.id }
  for (const change of [{ email: 'other@example.com' }, { organization_id: 'org_other' }, { accepted_user_id: 'user_other' }, { revoked_at: at() }]) {
    provider = { ...accepted, ...change }
    assert.equal((await acceptBoundWorkosInvitation(env, token, user, { request: providerRequest, now: at })).status, 'denied')
  }
  provider = accepted
  assert.deepEqual(await acceptBoingInvitation(env, token, user, { request: providerRequest, now: at }), { status: 'accepted', organizationId: 'local1' })
  assert.equal((await acceptBoingInvitation(env, token, user, { request: providerRequest, now: at })).status, 'already_accepted')
  assert.equal(sql.prepare("SELECT count(*) n FROM boing_memberships WHERE user_id='user_123'").get().n, 1)
  assert.equal(writes, 0)
})

test('server selects the unbound path and fails closed when the binding migration is missing', async () => {
  const { sql, env, token, request } = await fixture()
  assert.equal((await acceptBoingInvitation(env, token, user, { request, now: at })).status, 'accepted')
  sql.exec('DROP TABLE boing_workos_invitation_bindings')
  assert.equal((await acceptBoingInvitation(env, token, user, { request, now: at })).status, 'unavailable')
})

test('provider binding rejects mismatches, owner revocation, and workspace suspension during lookup', async () => {
  for (const mode of ['email', 'organization', 'role', 'owner_revoked', 'workspace_suspended']) {
    const { sql, env } = await fixture()
    const localId = sql.prepare('SELECT id FROM boing_invitations').get().id
    const owner = { id: 'user_owner', email: 'owner@example.com', verified: 1, status: 'active' }
    const request = async url => {
      if (url.includes('organization_memberships')) return Response.json({ object: 'list', list_metadata: { after: null }, data: [{ user_id: owner.id, organization_id: 'org_123', status: 'active' }] })
      if (mode === 'owner_revoked') sql.exec("UPDATE boing_memberships SET status='suspended' WHERE user_id='user_owner'")
      if (mode === 'workspace_suspended') sql.exec("UPDATE boing_organizations SET status='suspended' WHERE id='local1'")
      return Response.json({ object: 'invitation', id: 'invitation_123', state: 'pending', email: mode === 'email' ? 'other@example.com' : 'guest@example.com', organization_id: mode === 'organization' ? 'org_other' : 'org_123', role_slug: mode === 'role' ? 'admin' : 'member', expires_at: '2026-11-01T12:00:00.000Z', accepted_at: null, revoked_at: null })
    }
    assert.equal(await bindWorkosInvitation(env, owner, 'local1', localId, 'provider_token_123456', { request, now: at() }), false)
    assert.equal(sql.prepare('SELECT count(*) n FROM boing_workos_invitation_bindings').get().n, 0)
  }
})

test('provider-bound acceptance rejects a remapped organization during provider lookup', async () => {
  const { sql, env, token } = await fixture()
  const localId = sql.prepare('SELECT id FROM boing_invitations').get().id
  sql.prepare('INSERT INTO boing_workos_invitation_bindings VALUES (?,?)').run(localId, 'invitation_123')
  const request = async url => {
    assert.match(url, /invitations\/invitation_123$/)
    sql.exec("UPDATE boing_organizations SET workos_organization_id='org_other'")
    return Response.json({ object: 'invitation', id: 'invitation_123', state: 'accepted', email: 'guest@example.com', organization_id: 'org_123', accepted_user_id: 'user_123', accepted_at: at(), revoked_at: null })
  }
  assert.equal((await acceptBoingInvitation(env, token, user, { request, now: at })).status, 'denied')
  assert.equal(sql.prepare("SELECT count(*) n FROM boing_memberships WHERE user_id='user_123'").get().n, 0)
})
