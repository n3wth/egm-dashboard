import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { INVITES_SCHEMA, createInvitation } from './boing-invites.mjs'
import { AUDIT_SCHEMA } from './boing-audit.mjs'
import { checkInvitationReadiness } from './boing-onboarding.mjs'

const now = '2026-10-28T12:00:00.000Z'
const user = { id: 'user_guest', email: 'Guest@example.com', verified: 1, status: 'active' }

async function fixture() {
  const sql = new DatabaseSync(':memory:')
  sql.exec(readFileSync(new URL('./boing-tenancy-schema.sql', import.meta.url), 'utf8'))
  sql.exec(INVITES_SCHEMA)
  sql.exec(AUDIT_SCHEMA)
  sql.exec(`INSERT INTO boing_identities(user_id,email,status) VALUES
    ('user_owner','owner@example.com','active'),('user_guest','guest@example.com','active');
    INSERT INTO boing_organizations VALUES('local1','One','org_One','active',0,'now');
    INSERT INTO boing_memberships VALUES('local1','user_owner','owner','active','now');`)
  const db = {
    prepare(query) { return { bind(...args) { return {
      async first() { return sql.prepare(query).get(...args) ?? null },
      async run() { return { meta: { changes: Number(sql.prepare(query).run(...args).changes) } } },
    } } } },
    async batch(statements) {
      sql.exec('BEGIN')
      try { const result = []; for (const s of statements) result.push(await s.run()); sql.exec('COMMIT'); return result }
      catch (error) { sql.exec('ROLLBACK'); throw error }
    },
  }
  const invite = await createInvitation(db, 'user_owner', 'local1', { organizationId: 'local1', email: user.email, now })
  return { sql, env: { DB: db, WORKOS_API_KEY: 'test' }, token: invite.token }
}

function provider({ status = 'active', organization = 'org_One', onRequest } = {}) {
  return async url => {
    onRequest?.(url)
    return Response.json({ object: 'list', list_metadata: { after: null }, data: [{ user_id: user.id, organization_id: organization, status }] })
  }
}

test('preflight checks the exact mapped WorkOS organization without consuming invitation', async () => {
  const { sql, env, token } = await fixture()
  let requested
  assert.deepEqual(await checkInvitationReadiness(env, token, user, { now, request: provider({ onRequest: url => { requested = new URL(url) } }) }), { status: 'ready' })
  assert.equal(requested.searchParams.get('organization_id'), 'org_One')
  assert.equal(sql.prepare('SELECT accepted_at FROM boing_invitations').get().accepted_at, null)
  assert.equal(sql.prepare('SELECT count(*) n FROM boing_memberships WHERE user_id=?').get(user.id).n, 0)
})

test('rejects invalid or mismatched invitations and never globally approves users', async () => {
  const { sql, env, token } = await fixture()
  let called = false
  const request = provider({ onRequest: () => { called = true } })
  assert.deepEqual(await checkInvitationReadiness(env, token, { ...user, email: 'other@example.com' }, { now, request }), { status: 'denied' })
  sql.prepare('UPDATE boing_identities SET status=? WHERE user_id=?').run('suspended', user.id)
  assert.deepEqual(await checkInvitationReadiness(env, token, user, { now, request }), { status: 'denied' })
  assert.equal(sql.prepare('SELECT status FROM boing_identities WHERE user_id=?').get(user.id).status, 'suspended')
  assert.equal(called, false)
})

test('denies revoked WorkOS access and mapping changes while provider is pending', async () => {
  const { sql, env, token } = await fixture()
  assert.deepEqual(await checkInvitationReadiness(env, token, user, { now, request: provider({ status: 'inactive' }) }), { status: 'denied' })
  assert.deepEqual(await checkInvitationReadiness(env, token, user, { now, request: provider({ organization: 'org_Other' }) }), { status: 'denied' })
  assert.deepEqual(await checkInvitationReadiness(env, token, user, { now, request: async () => { throw Error('offline') } }), { status: 'unavailable' })
  assert.deepEqual(await checkInvitationReadiness(env, token, user, { now, request: provider({ onRequest: () => sql.exec("UPDATE boing_organizations SET workos_organization_id='org_New'") }) }), { status: 'denied' })
  assert.equal(sql.prepare('SELECT accepted_at FROM boing_invitations').get().accepted_at, null)
})
