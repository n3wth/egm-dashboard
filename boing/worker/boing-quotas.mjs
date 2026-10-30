// Bounded request-quota primitives for Boing. Only ai.insight is wired
// (boing-router.mjs calls consumeQuota before boing-ai). A caller must derive `user` from a verified server session
// and `organizationId` from a freshly verified server-side membership (for
// example resolveBoingContext in boing-context.mjs). Neither value is ever
// parsed from a request, and no client-supplied organization id grants access.
//
// Trust and safety model:
// - Scope is exactly (organization_id, user_id, quota, window_start). One
//   tenant or user can never consume from, observe, or exhaust another's
//   bucket, because membership is rechecked inside the consuming statement.
// - Admission is a single atomic D1/SQLite statement (INSERT ... SELECT ...
//   ON CONFLICT ... DO UPDATE ... WHERE count + cost <= limit RETURNING).
//   No read-then-write pair decides admission, so concurrent callers cannot
//   both observe the last free slot. Denial classification afterwards only
//   reads for reporting and never admits.
// - Default deny: a missing or malformed DB binding, a missing quota table
//   (migration not yet applied), an unverified user, an inactive identity,
//   organization or membership, an unknown quota without explicit bounded
//   limits, or any invalid limit, window, cost, or timestamp denies with no
//   consumption.
// - Limits are bounded twice over: named quotas carry fixed defaults, and
//   every caller-supplied limit, window, and cost is clamped by rejection
//   against BOING_QUOTA_LIMITS. Nothing here performs network calls, reads
//   provider data, or writes anything except its own usage counters.
//
// Schema migration needed before wiring (additive, staging first; do not
// apply to the live database from this module):
//   1. Apply BOING_QUOTA_SCHEMA below to the D1 database (for example append
//      it to a new migration applied alongside boing-tenancy-schema.sql,
//      after boing_organizations, boing_memberships, and boing_identities exist).
//   2. Periodically run pruneQuotaUsage (trusted maintenance only) so
//      expired fixed windows cannot grow the table without bound.
// Until step 1 lands, every call denies as `unavailable`, which is safe but
// blocks any route that chooses to gate on these primitives.

export const BOING_QUOTA_SCHEMA = `CREATE TABLE IF NOT EXISTS boing_quota_usage (
  organization_id TEXT NOT NULL REFERENCES boing_organizations(id),
  user_id TEXT NOT NULL,
  quota TEXT NOT NULL,
  window_start INTEGER NOT NULL CHECK (window_start >= 0),
  count INTEGER NOT NULL CHECK (count >= 0),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (organization_id, user_id, quota, window_start),
  FOREIGN KEY (organization_id, user_id) REFERENCES boing_memberships(organization_id, user_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS boing_quota_usage_window ON boing_quota_usage(window_start);`

// Fixed defaults for the expensive or abusable Boing operations that exist
// today. Windows are fixed windows aligned to the epoch.
export const BOING_QUOTAS = Object.freeze({
  'api.read': Object.freeze({ limit: 600, windowMs: 60_000 }),
  'api.write': Object.freeze({ limit: 120, windowMs: 60_000 }),
  'ai.insight': Object.freeze({ limit: 20, windowMs: 3_600_000 }),
  export: Object.freeze({ limit: 10, windowMs: 3_600_000 }),
})

// Absolute bounds no caller may exceed, whatever quota it names.
export const BOING_QUOTA_LIMITS = Object.freeze({
  maxLimit: 10_000,
  maxCost: 100,
  minWindowMs: 1_000,
  maxWindowMs: 7 * 24 * 3_600_000,
  maxPruneRows: 10_000,
})

const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value)
const validUser = user => Boolean(user && validId(user.id) && user.verified === 1)
const validQuota = value => typeof value === 'string' && /^[a-z][a-z0-9._-]{0,63}$/.test(value)

function resolveNow(now) {
  if (now === undefined) return Date.now()
  const value = now instanceof Date ? now.getTime() : now
  return Number.isSafeInteger(value) && value >= 0 ? value : null
}

// Returns null for anything unbounded or malformed; callers deny on null.
function resolvePolicy(quota, options) {
  const defaults = BOING_QUOTAS[quota]
  const limit = options.limit === undefined ? defaults?.limit : options.limit
  const windowMs = options.windowMs === undefined ? defaults?.windowMs : options.windowMs
  const cost = options.cost === undefined ? 1 : options.cost
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > BOING_QUOTA_LIMITS.maxLimit) return null
  if (!Number.isSafeInteger(windowMs) || windowMs < BOING_QUOTA_LIMITS.minWindowMs || windowMs > BOING_QUOTA_LIMITS.maxWindowMs) return null
  if (!Number.isSafeInteger(cost) || cost < 1 || cost > BOING_QUOTA_LIMITS.maxCost) return null
  return { limit, windowMs, cost }
}

function denied(reason, policy, windowStart, now) {
  return {
    allowed: false,
    reason,
    limit: policy?.limit ?? 0,
    remaining: 0,
    count: 0,
    windowStart,
    windowEnd: policy ? windowStart + policy.windowMs : windowStart,
    retryAfterMs: reason === 'quota_exceeded' && policy ? Math.max(0, windowStart + policy.windowMs - now) : 0,
  }
}

function membershipUsageQuery(db, user, organizationId, quota, windowStart) {
  return db.prepare(`SELECT q.count AS count FROM boing_organizations o
    JOIN boing_memberships m ON m.organization_id = o.id
    JOIN boing_identities u ON u.user_id = m.user_id
    LEFT JOIN boing_quota_usage q
      ON q.organization_id = o.id AND q.user_id = m.user_id AND q.quota = ? AND q.window_start = ?
    WHERE o.id = ? AND m.user_id = ?
      AND o.status = 'active' AND m.status = 'active'
      AND u.status = 'active'`)
    .bind(quota, windowStart, organizationId, user.id).first()
}

/**
 * Atomically consume `cost` units from the (organization, user, quota)
 * fixed-window bucket. `now` is epoch milliseconds (injectable for tests).
 * Resolves to { allowed, reason, limit, remaining, count, windowStart,
 * windowEnd, retryAfterMs }; every failure denies and consumes nothing.
 */
export async function consumeQuota(db, user, organizationId, { quota, limit, windowMs, cost, now } = {}) {
  const at = resolveNow(now)
  if (!validUser(user) || !validId(organizationId) || !validQuota(quota) || at === null) {
    return denied('invalid_request', null, 0, at ?? 0)
  }
  const policy = resolvePolicy(quota, { limit, windowMs, cost })
  if (!policy) return denied('invalid_request', null, 0, at)
  const windowStart = Math.floor(at / policy.windowMs) * policy.windowMs
  if (!db?.prepare) return { ...denied('unavailable', policy, windowStart, at), limit: policy.limit }

  let row
  try {
    // The only statement that can admit. The SELECT both proves current
    // tenant membership and, with `cost <= limit`, guards a first insert;
    // the conflict branch guards every later increment in the same write.
    row = await db.prepare(`INSERT INTO boing_quota_usage(organization_id, user_id, quota, window_start, count, updated_at)
      SELECT o.id, m.user_id, ?, ?, ?, ?
      FROM boing_organizations o
      JOIN boing_memberships m ON m.organization_id = o.id
      JOIN boing_identities u ON u.user_id = m.user_id
      WHERE o.id = ? AND m.user_id = ?
        AND o.status = 'active' AND m.status = 'active'
        AND u.status = 'active'
        AND ? <= ?
      ON CONFLICT(organization_id, user_id, quota, window_start)
      DO UPDATE SET count = count + excluded.count, updated_at = excluded.updated_at
      WHERE boing_quota_usage.count + ? <= ?
      RETURNING count`)
      .bind(quota, windowStart, policy.cost, at, organizationId, user.id, policy.cost, policy.limit, policy.cost, policy.limit)
      .first()
  } catch {
    // Missing table (migration pending) or any D1 failure: deny, never admit.
    return { ...denied('unavailable', policy, windowStart, at), limit: policy.limit }
  }
  if (row && Number.isSafeInteger(row.count)) {
    return {
      allowed: true,
      reason: 'ok',
      limit: policy.limit,
      remaining: policy.limit - row.count,
      count: row.count,
      windowStart,
      windowEnd: windowStart + policy.windowMs,
      retryAfterMs: 0,
    }
  }

  // Denied by the atomic statement. Report quota exhaustion only when the
  // caller's own scoped bucket proves it; anything else stays an opaque
  // denial so tenant or membership state never leaks across scopes.
  try {
    const usage = await membershipUsageQuery(db, user, organizationId, quota, windowStart)
    if (usage && (usage.count ?? 0) + policy.cost > policy.limit) {
      return { ...denied('quota_exceeded', policy, windowStart, at), limit: policy.limit, count: usage.count ?? 0 }
    }
  } catch { /* keep the opaque denial below */ }
  return { ...denied('unauthorized', policy, windowStart, at), limit: policy.limit }
}

/** Convenience wrapper for Worker callers: a missing DB binding denies. */
export async function consumeEnvQuota(env, user, organizationId, options = {}) {
  if (!env?.DB?.prepare) {
    const at = resolveNow(options.now) ?? 0
    return denied('unavailable', null, 0, at)
  }
  return consumeQuota(env.DB, user, organizationId, options)
}

/**
 * Read the caller's own current usage without consuming. Returns null for
 * any unauthorized, invalid, or unavailable scope instead of another
 * tenant's count.
 */
export async function peekQuota(db, user, organizationId, { quota, limit, windowMs, now } = {}) {
  const at = resolveNow(now)
  if (!db?.prepare || !validUser(user) || !validId(organizationId) || !validQuota(quota) || at === null) return null
  const policy = resolvePolicy(quota, { limit, windowMs, cost: 1 })
  if (!policy) return null
  const windowStart = Math.floor(at / policy.windowMs) * policy.windowMs
  try {
    const usage = await membershipUsageQuery(db, user, organizationId, quota, windowStart)
    if (!usage) return null
    const count = usage.count ?? 0
    return {
      limit: policy.limit,
      remaining: Math.max(0, policy.limit - count),
      count,
      windowStart,
      windowEnd: windowStart + policy.windowMs,
    }
  } catch {
    return null
  }
}

/**
 * Trusted maintenance only (no tenant scope exists to check): delete usage
 * windows that ended before `before` (epoch ms), in one bounded statement.
 * Returns the number of rows deleted, or 0 for invalid input or failure.
 */
export async function pruneQuotaUsage(db, { before, maxRows = 1_000 } = {}) {
  const cutoff = resolveNow(before)
  if (!db?.prepare || cutoff === null || !Number.isSafeInteger(maxRows)
    || maxRows < 1 || maxRows > BOING_QUOTA_LIMITS.maxPruneRows) return 0
  try {
    // Deletes windows that start before the cutoff. Callers should pass a
    // cutoff at least BOING_QUOTA_LIMITS.maxWindowMs in the past so every
    // deleted window has certainly ended.
    const result = await db.prepare(`DELETE FROM boing_quota_usage WHERE rowid IN (
      SELECT rowid FROM boing_quota_usage WHERE window_start < ? ORDER BY window_start LIMIT ?)`)
      .bind(cutoff, maxRows).run()
    return result.meta?.changes ?? 0
  } catch {
    return 0
  }
}
