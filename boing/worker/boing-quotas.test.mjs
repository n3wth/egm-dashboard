import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { BOING_QUOTA_LIMITS, BOING_QUOTA_SCHEMA, BOING_QUOTAS, consumeEnvQuota, consumeQuota, peekQuota, pruneQuotaUsage } from './boing-quotas.mjs'
import { BOING_IDENTITY_SCHEMA } from './boing-identity.mjs'

// Exercise the actual SQL against SQLite rather than matching mock SQL strings.
function database({ withQuotaSchema = true } = {}) {
  const sql = new DatabaseSync(':memory:')
  sql.exec('PRAGMA foreign_keys=ON')
  sql.exec(BOING_IDENTITY_SCHEMA)
  sql.exec(readFileSync(new URL('./boing-tenancy-schema.sql', import.meta.url), 'utf8'))
  if (withQuotaSchema) sql.exec(BOING_QUOTA_SCHEMA)
  sql.exec(`INSERT INTO boing_identities(user_id,email,status) VALUES
    ('owner','o@example.com','active'),
    ('member','m@example.com','active'),
    ('other','x@example.com','active');
    INSERT INTO boing_organizations VALUES('a','A','org_a','active',0,'now'),('b','B','org_b','active',0,'now');
    INSERT INTO boing_memberships VALUES
      ('a','owner','owner','active','now'),
      ('a','member','member','active','now'),
      ('b','owner','owner','active','now'),
      ('b','other','owner','active','now');`)
  const db = {
    prepare(query) {
      return {
        bind(...args) { return statement(query, args) },
        ...statement(query, []),
      }
    },
  }
  function statement(query, args) {
    return {
      async first() { return sql.prepare(query).get(...args) ?? null },
      async all() { return { results: sql.prepare(query).all(...args) } },
      async run() { const result = sql.prepare(query).run(...args); return { meta: { changes: Number(result.changes) } } },
    }
  }
  return { db, sql }
}

const user = id => ({ id, verified: 1 })
const T0 = 1_700_000_040_000 // aligned inside a 60s window

test('consumes up to the named quota limit, then denies with a retry delay', async () => {
  const { db } = database()
  const limit = BOING_QUOTAS['ai.insight'].limit
  for (let i = 0; i < limit; i++) {
    const result = await consumeQuota(db, user('owner'), 'a', { quota: 'ai.insight', now: T0 })
    assert.equal(result.allowed, true)
    assert.equal(result.remaining, limit - i - 1)
    assert.equal(result.count, i + 1)
  }
  const denied = await consumeQuota(db, user('owner'), 'a', { quota: 'ai.insight', now: T0 })
  assert.equal(denied.allowed, false)
  assert.equal(denied.reason, 'quota_exceeded')
  assert.equal(denied.remaining, 0)
  assert.equal(denied.count, limit)
  assert.ok(denied.retryAfterMs > 0 && denied.retryAfterMs <= BOING_QUOTAS['ai.insight'].windowMs)
  // A denied attempt consumes nothing.
  assert.equal((await peekQuota(db, user('owner'), 'a', { quota: 'ai.insight', now: T0 })).count, limit)
})

test('buckets are isolated by organization, user and quota', async () => {
  const { db } = database()
  const options = { quota: 'custom.op', limit: 2, windowMs: 60_000, now: T0 }
  assert.equal((await consumeQuota(db, user('owner'), 'a', options)).allowed, true)
  assert.equal((await consumeQuota(db, user('owner'), 'a', options)).allowed, true)
  assert.equal((await consumeQuota(db, user('owner'), 'a', options)).allowed, false)
  // Same user, other organization: untouched bucket.
  assert.equal((await consumeQuota(db, user('owner'), 'b', options)).allowed, true)
  // Same organization, other user: untouched bucket.
  assert.equal((await consumeQuota(db, user('member'), 'a', options)).allowed, true)
  // Same scope, other quota: untouched bucket.
  assert.equal((await consumeQuota(db, user('owner'), 'a', { ...options, quota: 'other.op' })).allowed, true)
  assert.equal((await peekQuota(db, user('owner'), 'a', options)).count, 2)
  assert.equal((await peekQuota(db, user('owner'), 'b', options)).count, 1)
  assert.equal((await peekQuota(db, user('member'), 'a', options)).count, 1)
})

test('cross-tenant scope denies and never leaks another tenant count', async () => {
  const { db } = database()
  const options = { quota: 'custom.op', limit: 5, windowMs: 60_000, now: T0 }
  assert.equal((await consumeQuota(db, user('other'), 'b', options)).allowed, true)
  // `other` has no membership in a, and `member` has none in b.
  const denied = await consumeQuota(db, user('other'), 'a', options)
  assert.equal(denied.allowed, false)
  assert.notEqual(denied.reason, 'quota_exceeded')
  assert.equal(await peekQuota(db, user('other'), 'a', options), null)
  assert.equal(await peekQuota(db, user('member'), 'b', options), null)
  assert.equal((await consumeQuota(db, user('member'), 'b', options)).allowed, false)
  // The real tenant bucket is unaffected by cross-tenant attempts.
  assert.equal((await peekQuota(db, user('other'), 'b', options)).count, 1)
})

test('concurrent consumers cannot exceed the limit', async () => {
  const { db } = database()
  const options = { quota: 'custom.op', limit: 10, windowMs: 60_000, now: T0 }
  const results = await Promise.all(
    Array.from({ length: 50 }, () => consumeQuota(db, user('owner'), 'a', options)),
  )
  assert.equal(results.filter(result => result.allowed).length, 10)
  assert.equal(results.filter(result => !result.allowed).length, 40)
  assert.equal((await peekQuota(db, user('owner'), 'a', options)).count, 10)
})

test('a new window resets the bucket and weighted costs are bounded atomically', async () => {
  const { db } = database()
  const options = { quota: 'custom.op', limit: 5, windowMs: 60_000, now: T0 }
  assert.equal((await consumeQuota(db, user('owner'), 'a', { ...options, cost: 3 })).count, 3)
  // 3 + 3 would exceed 5: denied whole, nothing partially consumed.
  assert.equal((await consumeQuota(db, user('owner'), 'a', { ...options, cost: 3 })).allowed, false)
  assert.equal((await peekQuota(db, user('owner'), 'a', options)).count, 3)
  assert.equal((await consumeQuota(db, user('owner'), 'a', { ...options, cost: 2 })).allowed, true)
  // A single cost above the limit never creates an over-limit first row.
  assert.equal((await consumeQuota(db, user('member'), 'a', { ...options, cost: 6 })).allowed, false)
  assert.equal((await peekQuota(db, user('member'), 'a', options)).count, 0)
  const nextWindow = await consumeQuota(db, user('owner'), 'a', { ...options, now: T0 + 60_000 })
  assert.equal(nextWindow.allowed, true)
  assert.equal(nextWindow.count, 1)
  assert.equal(nextWindow.windowStart, T0 + 60_000)
})

test('defaults deny for missing bindings, missing table and unverified scope', async () => {
  const { db, sql } = database()
  const options = { quota: 'api.read', now: T0 }
  assert.equal((await consumeQuota(null, user('owner'), 'a', options)).reason, 'unavailable')
  assert.equal((await consumeQuota({}, user('owner'), 'a', options)).allowed, false)
  assert.equal((await consumeQuota(undefined, user('owner'), 'a', options)).allowed, false)
  assert.equal((await consumeEnvQuota({}, user('owner'), 'a', options)).reason, 'unavailable')
  assert.equal((await consumeEnvQuota(null, user('owner'), 'a', options)).allowed, false)
  assert.equal(await peekQuota(null, user('owner'), 'a', options), null)

  // Migration not applied yet: deny instead of admitting or throwing.
  const unmigrated = database({ withQuotaSchema: false })
  assert.equal((await consumeQuota(unmigrated.db, user('owner'), 'a', options)).reason, 'unavailable')

  assert.equal((await consumeQuota(db, { ...user('owner'), verified: 0 }, 'a', options)).allowed, false)
  sql.exec("UPDATE boing_identities SET status='suspended' WHERE user_id='owner'")
  assert.equal((await consumeQuota(db, user('owner'), 'a', options)).allowed, false)
  assert.equal(await peekQuota(db, user('owner'), 'a', options), null)
  assert.equal((await consumeQuota(db, user('owner'), null, options)).allowed, false)
  assert.equal((await consumeQuota(db, user('owner'), '', options)).allowed, false)

  sql.exec("UPDATE boing_memberships SET status='suspended' WHERE organization_id='a' AND user_id='member'")
  assert.equal((await consumeQuota(db, user('member'), 'a', options)).allowed, false)
  assert.equal(await peekQuota(db, user('member'), 'a', options), null)
  sql.exec("UPDATE boing_organizations SET status='suspended' WHERE id='b'")
  assert.equal((await consumeQuota(db, user('other'), 'b', options)).allowed, false)
})

test('invalid quotas, limits, windows, costs and times deny without consuming', async () => {
  const { db } = database()
  const base = { quota: 'custom.op', limit: 5, windowMs: 60_000, now: T0 }
  assert.equal((await consumeQuota(db, user('owner'), 'a', { quota: 'unknown.op', now: T0 })).allowed, false)
  assert.equal((await consumeQuota(db, user('owner'), 'a', { ...base, quota: 'Bad Quota!' })).allowed, false)
  assert.equal((await consumeQuota(db, user('owner'), 'a', { ...base, quota: '' })).allowed, false)
  assert.equal((await consumeQuota(db, user('owner'), 'a', { ...base, limit: 0 })).allowed, false)
  assert.equal((await consumeQuota(db, user('owner'), 'a', { ...base, limit: BOING_QUOTA_LIMITS.maxLimit + 1 })).allowed, false)
  assert.equal((await consumeQuota(db, user('owner'), 'a', { ...base, limit: 1.5 })).allowed, false)
  assert.equal((await consumeQuota(db, user('owner'), 'a', { ...base, windowMs: BOING_QUOTA_LIMITS.minWindowMs - 1 })).allowed, false)
  assert.equal((await consumeQuota(db, user('owner'), 'a', { ...base, windowMs: BOING_QUOTA_LIMITS.maxWindowMs + 1 })).allowed, false)
  assert.equal((await consumeQuota(db, user('owner'), 'a', { ...base, cost: 0 })).allowed, false)
  assert.equal((await consumeQuota(db, user('owner'), 'a', { ...base, cost: BOING_QUOTA_LIMITS.maxCost + 1 })).allowed, false)
  assert.equal((await consumeQuota(db, user('owner'), 'a', { ...base, now: -1 })).allowed, false)
  assert.equal((await consumeQuota(db, user('owner'), 'a', { ...base, now: 'now' })).allowed, false)
  assert.equal((await peekQuota(db, user('owner'), 'a', base)).count, 0)
})

test('peek never consumes and revocation takes effect immediately', async () => {
  const { db, sql } = database()
  const options = { quota: 'api.read', now: T0 }
  assert.equal((await peekQuota(db, user('owner'), 'a', options)).count, 0)
  assert.equal((await peekQuota(db, user('owner'), 'a', options)).count, 0)
  assert.equal((await consumeQuota(db, user('owner'), 'a', options)).allowed, true)
  assert.equal((await peekQuota(db, user('owner'), 'a', options)).count, 1)
  sql.exec("DELETE FROM boing_memberships WHERE organization_id='a' AND user_id='owner'")
  assert.equal((await consumeQuota(db, user('owner'), 'a', options)).allowed, false)
  assert.equal(await peekQuota(db, user('owner'), 'a', options), null)
})

test('prune deletes only expired windows and is bounded', async () => {
  const { db, sql } = database()
  const options = { quota: 'custom.op', limit: 5, windowMs: 60_000 }
  await consumeQuota(db, user('owner'), 'a', { ...options, now: T0 })
  await consumeQuota(db, user('owner'), 'a', { ...options, now: T0 + 120_000 })
  assert.equal(await pruneQuotaUsage(db, { before: 0 }), 0)
  assert.equal(await pruneQuotaUsage(db, { before: T0 + 60_000, maxRows: BOING_QUOTA_LIMITS.maxPruneRows + 1 }), 0)
  assert.equal(await pruneQuotaUsage(db, { before: T0 + 60_000 }), 1)
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM boing_quota_usage').get().n, 1)
  assert.equal(await pruneQuotaUsage(null, { before: T0 }), 0)
})
