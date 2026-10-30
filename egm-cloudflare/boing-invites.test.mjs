import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { INVITES_SCHEMA, acceptInvitation, bindWorkosInvitation, createInvitation as createScopedInvitation, invitationTokenHash, listInvitations as listScopedInvitations, normalizeInvitationEmail, revokeInvitation as revokeScopedInvitation, validInvitationToken } from './boing-invites.mjs'
import { BOING_IDENTITY_SCHEMA } from './boing-identity.mjs'
import { AUDIT_SCHEMA } from './boing-audit.mjs'

// Production callers must independently verify the mapped WorkOS scope.
const createInvitation = (db, actor, input) => createScopedInvitation(db, actor, input?.organizationId, input)
const listInvitations = (db, actor, organization, now) => listScopedInvitations(db, actor, organization, organization, now)
const revokeInvitation = (db, actor, organization, id, now) => revokeScopedInvitation(db, actor, organization, organization, id, null, now)

const T0 = '2026-10-28T12:00:00.000Z'
const T1 = '2026-10-29T12:00:00.000Z'
const T8 = '2026-11-05T12:00:00.000Z'
// Shape returned by authenticateBoingSession: the email is provider-verified.
const guest = { id: 'guest', email: 'Guest@Example.com', verified: 1 }
const other = { id: 'other', email: 'other@example.com', verified: 1 }

// Exercise the actual SQL against SQLite rather than matching mock SQL strings.
// The legacy schema is deliberately absent: invitations must work without a
// users table.
function fixture() {
  const sql = new DatabaseSync(':memory:')
  sql.exec('PRAGMA foreign_keys=ON')
  sql.exec(BOING_IDENTITY_SCHEMA)
  sql.exec(readFileSync(new URL('./boing-tenancy-schema.sql', import.meta.url), 'utf8'))
  sql.exec(INVITES_SCHEMA)
  sql.exec(AUDIT_SCHEMA)
  sql.exec(`INSERT INTO boing_identities(user_id,email,status) VALUES
    ('owner','owner@example.com','active'),
    ('owner2','owner2@example.com','active'),
    ('admin','admin@example.com','active'),
    ('member','member@example.com','active'),
    ('guest','guest@example.com','active'),
    ('other','other@example.com','active'),
    ('suspended','suspended@example.com','suspended');
    INSERT INTO boing_organizations VALUES('org1','One','workos1','active',0,'now'),('org2','Two','workos2','active',0,'now');
    INSERT INTO boing_memberships VALUES('org1','owner','owner','active','now'),('org1','admin','admin','active','now'),
      ('org1','member','member','active','now'),('org2','owner2','owner','active','now');`)
  function statement(query, args) {
    return {
      async first() { return sql.prepare(query).get(...args) ?? null },
      async all() { return { results: sql.prepare(query).all(...args) } },
      async run() { return { meta: { changes: Number(sql.prepare(query).run(...args).changes) } } },
    }
  }
  const db = {
    prepare(query) { return { bind(...args) { return statement(query, args) } } },
    async batch(statements) {
      sql.exec('BEGIN')
      try {
        const results = []
        for (const item of statements) results.push(await item.run())
        sql.exec('COMMIT')
        return results
      } catch (error) { sql.exec('ROLLBACK'); throw error }
    },
  }
  const membership = userId => sql.prepare("SELECT role,status FROM boing_memberships WHERE organization_id='org1' AND user_id=?").get(userId) ?? null
  return { sql, db, membership }
}

test('invitation creation and revocation are audited atomically without recipient data', async () => {
  const { sql, db } = fixture()
  const invite = await createInvitation(db, 'owner', { organizationId: 'org1', email: 'guest@example.com', now: T0 })
  assert.ok(invite)
  assert.equal(await revokeInvitation(db, 'owner', 'org1', invite.id, T1), true)
  assert.equal(await revokeInvitation(db, 'owner', 'org1', invite.id, T1), false)
  const events = sql.prepare('SELECT organization_id,actor_id,project_id,action,occurred_at FROM boing_audit_events ORDER BY rowid').all()
  assert.deepEqual(events.map(event => ({ ...event })), [
    { organization_id: 'org1', actor_id: 'owner', project_id: null, action: 'invitation.created', occurred_at: T0 },
    { organization_id: 'org1', actor_id: 'owner', project_id: null, action: 'invitation.revoked', occurred_at: T1 },
  ])
  assert.equal(JSON.stringify(events).includes('guest@example.com'), false)
  assert.equal(JSON.stringify(events).includes(invite.token), false)
  const second = await createInvitation(db, 'owner', { organizationId: 'org1', email: 'other@example.com', now: T0 })
  sql.exec("CREATE TRIGGER fail_invite_audit BEFORE INSERT ON boing_audit_events BEGIN SELECT RAISE(ABORT, 'audit failure'); END")
  await assert.rejects(createInvitation(db, 'owner', { organizationId: 'org1', email: 'new@example.com', now: T0 }))
  assert.equal(sql.prepare("SELECT count(*) AS n FROM boing_invitations WHERE email='new@example.com'").get().n, 0)
  await assert.rejects(revokeInvitation(db, 'owner', 'org1', second.id, T1))
  assert.equal(sql.prepare('SELECT revoked_at FROM boing_invitations WHERE id=?').get(second.id).revoked_at, null)
})

test('invitation binding rechecks and atomically matches the owner provider version', async () => {
  for (const mode of ['ok', 'provider_changed', 'local_changed']) {
    const { sql, db } = fixture()
    sql.exec(readFileSync(new URL('./boing-membership-binding-migration.sql', import.meta.url), 'utf8'))
    sql.exec("UPDATE boing_organizations SET workos_organization_id='org_One' WHERE id='org1'; INSERT INTO boing_identities VALUES('user_Owner','user-owner@example.com','active'); INSERT INTO boing_memberships VALUES('org1','user_Owner','owner','active','now'); INSERT INTO boing_workos_membership_bindings VALUES('org1','user_Owner','om_Owner','2026-10-28T00:00:00.000Z')")
    const invitation = await createInvitation(db, 'user_Owner', { organizationId: 'org1', email: 'new@example.com', now: T0 })
    const env = { DB: db, WORKOS_API_KEY: 'test', BOING_MEMBERSHIP_BINDING_REQUIRED: 'true' }
    const actor = { id: 'user_Owner', verified: 1, status: 'active' }
    let checks = 0
    const request = async url => {
      if (!url.includes('organization_memberships')) return Response.json({ object: 'invitation', id: 'invitation_One', state: 'pending', revoked_at: null, accepted_at: null, email: 'new@example.com', role_slug: 'member', organization_id: 'org_One', expires_at: '2026-11-01T00:00:00.000Z' })
      checks++
      if (checks === 2 && mode === 'local_changed') sql.exec("UPDATE boing_workos_membership_bindings SET workos_updated_at='2026-10-28T00:00:01.000Z' WHERE user_id='user_Owner'")
      const updated = checks === 2 && mode === 'provider_changed' ? '2026-10-28T00:00:01.000Z' : '2026-10-28T00:00:00.000Z'
      return Response.json({ object: 'list', data: [{ id: 'om_Owner', user_id: actor.id, organization_id: 'org_One', status: 'active', updated_at: updated }], list_metadata: { after: null } })
    }
    assert.equal(await bindWorkosInvitation(env, actor, 'org1', invitation.id, 'provider_token_123456', { request, now: T0 }), mode === 'ok')
    assert.equal(sql.prepare('SELECT count(*) n FROM boing_workos_invitation_bindings').get().n, mode === 'ok' ? 1 : 0)
  }
})

test('invitation mutations require the original active owner binding at write time', async () => {
  const { sql, db } = fixture()
  sql.exec(readFileSync(new URL('./boing-membership-binding-migration.sql', import.meta.url), 'utf8'))
  sql.exec("INSERT INTO boing_workos_membership_bindings VALUES('org1','owner','om_owner','2026-10-28T00:00:00.000Z')")
  const binding = { id: 'om_owner', updatedAt: '2026-10-28T00:00:00.000Z' }
  const old = await createInvitation(db, 'owner', { organizationId: 'org1', email: 'new@example.com', expiresInDays: 1, now: T0, membershipBinding: binding })
  assert.ok(old)
  sql.exec("UPDATE boing_workos_membership_bindings SET workos_updated_at='2026-10-28T00:00:01.000Z' WHERE user_id='owner'")
  assert.equal(await createInvitation(db, 'owner', { organizationId: 'org1', email: 'new@example.com', now: T8, membershipBinding: binding }), null)
  assert.equal(sql.prepare('SELECT revoked_at FROM boing_invitations WHERE id=?').get(old.id).revoked_at, null)
  assert.equal(await revokeScopedInvitation(db, 'owner', 'org1', 'org1', old.id, binding, T8), false)
  assert.equal(sql.prepare('SELECT revoked_at FROM boing_invitations WHERE id=?').get(old.id).revoked_at, null)
  assert.equal(await revokeScopedInvitation(db, 'owner', 'org1', 'org1', old.id, {}, T8), false)
  sql.exec("UPDATE boing_workos_membership_bindings SET workos_updated_at='2026-10-28T00:00:00.000Z' WHERE user_id='owner'; UPDATE boing_memberships SET role='member' WHERE user_id='owner'")
  assert.equal(await revokeScopedInvitation(db, 'owner', 'org1', 'org1', old.id, binding, T8), false)
  sql.exec("UPDATE boing_memberships SET role='owner' WHERE user_id='owner'")
  assert.equal(await revokeScopedInvitation(db, 'owner', 'org1', 'org1', old.id, binding, T8), true)
})

test('owner invites a verified recipient who accepts exactly once', async () => {
  const { sql, db, membership } = fixture()
  const invitation = await createInvitation(db, 'owner', { organizationId: 'org1', email: ' Guest@Example.com ', role: 'admin', expiresInDays: 7, now: T0 })
  assert.ok(validInvitationToken(invitation.token))
  assert.equal(invitation.email, 'guest@example.com')
  assert.equal(invitation.expiresAt, '2026-11-04T12:00:00.000Z')
  const stored = sql.prepare('SELECT * FROM boing_invitations').get()
  assert.equal(stored.token_hash, await invitationTokenHash(invitation.token))
  assert.notEqual(stored.token_hash, invitation.token)
  assert.equal(stored.created_by, 'owner')

  const list = await listInvitations(db, 'owner', 'org1', T1)
  assert.equal(list.length, 1)
  assert.equal(list[0].status, 'pending')
  assert.equal(list[0].role, 'admin')
  assert.equal(JSON.stringify(list).includes(stored.token_hash), false)
  assert.equal(JSON.stringify(list).includes(invitation.token), false)

  assert.equal(membership('guest'), null)
  const attempts = await Promise.all([
    acceptInvitation(db, invitation.token, guest, T1),
    acceptInvitation(db, invitation.token, guest, T1),
    acceptInvitation(db, invitation.token, other, T1),
  ])
  assert.deepEqual(attempts.filter(Boolean), [{ organizationId: 'org1', role: 'admin' }])
  assert.deepEqual({ ...membership('guest') }, { role: 'admin', status: 'active' })
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM boing_memberships WHERE user_id=?').get('guest').n, 1)
  assert.equal(await acceptInvitation(db, invitation.token, guest, T1), null)
  assert.equal((await listInvitations(db, 'owner', 'org1', T1))[0].status, 'accepted')
  assert.equal(sql.prepare('SELECT accepted_by FROM boing_invitations').get().accepted_by, 'guest')
})

test('pending invitation admission is bounded per workspace under concurrent requests', async () => {
  const { sql, db } = fixture()
  const results = await Promise.all(Array.from({ length: 105 }, (_, i) => createInvitation(db, 'owner', {
    organizationId: 'org1', email: `person${i}@example.com`, now: T0
  })))
  assert.equal(results.filter(Boolean).length, 100)
  assert.equal(sql.prepare("SELECT count(*) AS n FROM boing_invitations WHERE organization_id='org1' AND revoked_at IS NULL AND accepted_at IS NULL").get().n, 100)
  assert.ok(await createInvitation(db, 'owner2', { organizationId: 'org2', email: 'different@example.com', now: T0 }))
})

test('acceptance requires the invited verified address and an active identity', async () => {
  const { sql, db, membership } = fixture()
  const invitation = await createInvitation(db, 'owner', { organizationId: 'org1', email: 'guest@example.com', now: T0 })
  assert.equal(await acceptInvitation(db, invitation.token, other, T1), null)
  // A session that claims the invited address but belongs to another identity.
  assert.equal(await acceptInvitation(db, invitation.token, { ...other, email: 'guest@example.com' }, T1), null)
  assert.equal(await acceptInvitation(db, invitation.token, { ...guest, verified: 0 }, T1), null)
  assert.equal(await acceptInvitation(db, invitation.token, { ...guest, id: 'missing' }, T1), null)
  assert.equal(await acceptInvitation(db, invitation.token, { ...guest, id: 'suspended' }, T1), null)
  // The caller cannot assert status; only the stored identity status counts.
  sql.exec("UPDATE boing_identities SET status='suspended' WHERE user_id='guest'")
  assert.equal(await acceptInvitation(db, invitation.token, { ...guest, status: 'active' }, T1), null)
  sql.exec("UPDATE boing_identities SET status='active' WHERE user_id='guest'")
  // The stored identity email must still match the invited address.
  sql.exec("UPDATE boing_identities SET email='changed@example.com' WHERE user_id='guest'")
  assert.equal(await acceptInvitation(db, invitation.token, guest, T1), null)
  sql.exec("UPDATE boing_identities SET email='guest@example.com' WHERE user_id='guest'")
  assert.equal(membership('guest'), null)
  assert.equal(sql.prepare('SELECT accepted_at FROM boing_invitations').get().accepted_at, null)
  assert.deepEqual(await acceptInvitation(db, invitation.token, guest, T1), { organizationId: 'org1', role: 'member' })
})

test('local-only acceptance cannot bypass a bound WorkOS invitation', async () => {
  const { sql, db, membership } = fixture()
  const invitation = await createInvitation(db, 'owner', { organizationId: 'org1', email: 'guest@example.com', now: T0 })
  sql.prepare('INSERT INTO boing_workos_invitation_bindings(invitation_id,workos_invitation_id) VALUES(?,?)').run(invitation.id, 'invitation_123')
  assert.equal(await acceptInvitation(db, invitation.token, guest, T1), null)
  assert.equal(membership('guest'), null)
  assert.equal(sql.prepare('SELECT accepted_at FROM boing_invitations WHERE id=?').get(invitation.id).accepted_at, null)
})

test('expired, revoked, altered and suspended-organization invitations never grant membership', async () => {
  const { sql, db, membership } = fixture()
  const expired = await createInvitation(db, 'owner', { organizationId: 'org1', email: 'guest@example.com', expiresInDays: 1, now: T0 })
  assert.equal(await acceptInvitation(db, expired.token, guest, T8), null)
  assert.equal(await acceptInvitation(db, expired.token, guest, '2026-10-29T12:00:00.000Z'), null)
  assert.equal(await acceptInvitation(db, expired.token.slice(0, -1) + (expired.token.endsWith('A') ? 'B' : 'A'), guest, T1), null)
  assert.equal(await acceptInvitation(db, 'not-a-token', guest, T1), null)
  assert.equal((await listInvitations(db, 'owner', 'org1', T8))[0].status, 'expired')
  assert.equal(membership('guest'), null)

  const revoked = await createInvitation(db, 'owner', { organizationId: 'org1', email: 'guest@example.com', now: T8 })
  assert.ok(revoked)
  assert.equal(sql.prepare('SELECT revoked_at FROM boing_invitations WHERE id=?').get(expired.id).revoked_at, T8)
  assert.equal(await revokeInvitation(db, 'owner', 'org1', revoked.id, T8), true)
  assert.equal(await revokeInvitation(db, 'owner', 'org1', revoked.id, T8), false)
  assert.equal(await acceptInvitation(db, revoked.token, guest, T8), null)
  assert.equal((await listInvitations(db, 'owner', 'org1', T8)).find(row => row.id === revoked.id).status, 'revoked')

  const suspended = await createInvitation(db, 'owner', { organizationId: 'org1', email: 'guest@example.com', now: T8 })
  sql.exec("UPDATE boing_organizations SET status='suspended' WHERE id='org1'")
  assert.equal(await acceptInvitation(db, suspended.token, guest, T8), null)
  assert.equal(membership('guest'), null)
})

test('existing members cannot be invited or accept, including suspended memberships', async () => {
  const { sql, db } = fixture()
  assert.equal(await createInvitation(db, 'owner', { organizationId: 'org1', email: 'MEMBER@example.com', now: T0 }), null)
  const invitation = await createInvitation(db, 'owner', { organizationId: 'org1', email: 'guest@example.com', now: T0 })
  sql.exec("INSERT INTO boing_memberships VALUES('org1','guest','member','suspended','now')")
  assert.equal(await acceptInvitation(db, invitation.token, guest, T1), null)
  assert.equal(sql.prepare("SELECT status FROM boing_memberships WHERE user_id='guest'").get().status, 'suspended')
  assert.equal(sql.prepare('SELECT accepted_at FROM boing_invitations').get().accepted_at, null)
})

test('one active invitation per address and organization', async () => {
  const { sql, db } = fixture()
  const first = await createInvitation(db, 'owner', { organizationId: 'org1', email: 'guest@example.com', now: T0 })
  assert.ok(first)
  assert.equal(await createInvitation(db, 'owner', { organizationId: 'org1', email: 'guest@example.com', now: T1 }), null)
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM boing_invitations').get().n, 1)
  assert.ok(await createInvitation(db, 'owner2', { organizationId: 'org2', email: 'guest@example.com', now: T1 }))
  assert.equal(await revokeInvitation(db, 'owner', 'org1', first.id, T1), true)
  assert.ok(await createInvitation(db, 'owner', { organizationId: 'org1', email: 'guest@example.com', now: T1 }))
})

test('non-owners, cross-tenant owners and removed owners cannot manage invitations', async () => {
  const { sql, db } = fixture()
  for (const actor of ['admin', 'member', 'owner2', 'suspended', 'guest', 'missing']) {
    assert.equal(await createInvitation(db, actor, { organizationId: 'org1', email: 'guest@example.com', now: T0 }), null, actor)
    assert.equal(await listInvitations(db, actor, 'org1', T0), null, actor)
  }
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM boing_invitations').get().n, 0)
  const invitation = await createInvitation(db, 'owner', { organizationId: 'org1', email: 'guest@example.com', now: T0 })
  assert.equal(await revokeInvitation(db, 'owner2', 'org1', invitation.id, T0), false)
  assert.equal(await revokeInvitation(db, 'owner2', 'org2', invitation.id, T0), false)
  assert.equal(await revokeInvitation(db, 'admin', 'org1', invitation.id, T0), false)
  assert.equal(await listInvitations(db, 'owner2', 'org1', T0), null)
  assert.deepEqual(await listInvitations(db, 'owner2', 'org2', T0), [])
  sql.exec("UPDATE boing_memberships SET status='suspended' WHERE user_id='owner'")
  assert.equal(await revokeInvitation(db, 'owner', 'org1', invitation.id, T0), false)
  assert.equal(await listInvitations(db, 'owner', 'org1', T0), null)
  assert.equal(await createInvitation(db, 'owner', { organizationId: 'org1', email: 'other@example.com', now: T0 }), null)
  sql.exec("UPDATE boing_memberships SET status='active' WHERE user_id='owner'; UPDATE boing_identities SET status='suspended' WHERE user_id='owner'")
  assert.equal(await revokeInvitation(db, 'owner', 'org1', invitation.id, T0), false)
  assert.equal(await listInvitations(db, 'owner', 'org1', T0), null)
  assert.equal(await createInvitation(db, 'owner', { organizationId: 'org1', email: 'other@example.com', now: T0 }), null)
  sql.exec("UPDATE boing_identities SET status='active' WHERE user_id='owner'; UPDATE boing_organizations SET status='suspended' WHERE id='org1'")
  assert.equal(await createInvitation(db, 'owner', { organizationId: 'org1', email: 'other@example.com', now: T0 }), null)
  assert.equal(await revokeInvitation(db, 'owner', 'org1', invitation.id, T0), false)
  assert.equal(sql.prepare('SELECT revoked_at FROM boing_invitations').get().revoked_at, null)
})

test('invitations never read or write legacy users', async () => {
  const { sql } = fixture()
  assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name='users'").get().n, 0)
  assert.equal(INVITES_SCHEMA.includes('users('), false)
  assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM pragma_foreign_key_list('boing_invitations') WHERE \"table\"='boing_identities'").get().n, 2)
})

test('verified scope cannot authorize management in another organization even with stale local owner membership', async () => {
  const { sql, db } = fixture()
  sql.exec("INSERT INTO boing_memberships VALUES('org2','owner','owner','active','now')")
  const existing = await createScopedInvitation(db, 'owner2', 'org2', { organizationId: 'org2', email: 'guest@example.com', now: T0 })
  assert.ok(existing)
  assert.equal(await createScopedInvitation(db, 'owner', 'org1', { organizationId: 'org2', email: 'other@example.com', now: T0 }), null)
  assert.equal(await listScopedInvitations(db, 'owner', 'org1', 'org2', T0), null)
  assert.equal(await revokeScopedInvitation(db, 'owner', 'org1', 'org2', existing.id, T0), false)
  assert.equal(sql.prepare('SELECT revoked_at FROM boing_invitations WHERE id=?').get(existing.id).revoked_at, null)
  assert.equal(await createScopedInvitation(db, 'owner', undefined, { organizationId: 'org1', email: 'other@example.com', now: T0 }), null)
})

test('invalid input is rejected before any write', async () => {
  const { sql, db } = fixture()
  const base = { organizationId: 'org1', email: 'guest@example.com', now: T0 }
  const bad = [
    { ...base, email: 'not an email' }, { ...base, email: 'a@b' }, { ...base, email: `${'a'.repeat(250)}@example.com` },
    { ...base, role: 'owner' }, { ...base, role: 'root' },
    { ...base, expiresInDays: 0 }, { ...base, expiresInDays: 31 }, { ...base, expiresInDays: 1.5 },
    { ...base, now: 'yesterday' }, { ...base, now: 1700000000000 }, { ...base, now: '2026-13-45T99:00:00.000Z' },
    { ...base, organizationId: "org1' OR 1=1" }, { ...base, organizationId: '' },
  ]
  for (const input of bad) assert.equal(await createInvitation(db, 'owner', input), null, JSON.stringify(input))
  assert.equal(await createInvitation(db, "owner' --", base), null)
  assert.equal(await createInvitation(db, 'owner'), null)
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM boing_invitations').get().n, 0)
  assert.equal(await acceptInvitation(db, 'x'.repeat(40), guest, 'soon'), null)
  assert.equal(await acceptInvitation(db, 'x'.repeat(40), null, T0), null)
  assert.equal(await revokeInvitation(db, 'owner', 'org1', 'id', 'soon'), false)
  assert.equal(await listInvitations(db, 'owner', 'org1', 'soon'), null)
  assert.equal(normalizeInvitationEmail(' A@B.co '), 'a@b.co')
  assert.equal(normalizeInvitationEmail('a@b'), null)
  assert.equal(validInvitationToken('x'.repeat(31)), false)
  assert.equal(validInvitationToken('x'.repeat(32)), true)
})
