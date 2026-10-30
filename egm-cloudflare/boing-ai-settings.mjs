import { resolveBoingContext } from './boing-context.mjs'

// Additive schema. The digest binds consent to the exact text shown to the
// owner; a changed disclosure requires a new opt-in before inference.
export const BOING_AI_CONSENT_SCHEMA = `CREATE TABLE IF NOT EXISTS boing_ai_consents (
  organization_id TEXT PRIMARY KEY REFERENCES boing_organizations(id),
  disclosure_hash TEXT NOT NULL,
  accepted_by TEXT NOT NULL REFERENCES boing_identities(user_id),
  accepted_at TEXT NOT NULL
);`

const reply = (body, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' } })
const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value)
const owner = `EXISTS (SELECT 1 FROM boing_memberships m JOIN boing_identities i ON i.user_id=m.user_id
  WHERE m.organization_id=boing_organizations.id AND m.user_id=? AND m.role='owner' AND m.status='active' AND i.status='active')`
const member = `EXISTS (SELECT 1 FROM boing_memberships m JOIN boing_identities i ON i.user_id=m.user_id
  WHERE m.organization_id=o.id AND m.user_id=? AND m.status='active' AND i.status='active')`

export async function configuredAiDisclosure(env) {
  const text = env?.BOING_AI_PROCESSOR_DISCLOSURE
  if (typeof text !== 'string' || text.trim() !== text || text.length < 20 || text.length > 2000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) return null
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))
  return { id: Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join(''), text }
}

// Used at inference time as well as by settings. A stale or missing consent is
// never sufficient, even if an old organization row still has ai_enabled=1.
export async function hasCurrentAiConsent(env, organizationId) {
  if (!validId(organizationId) || env?.BOING_AI_BUDGET_APPROVED !== 'true' || typeof env?.AI?.run !== 'function') return false
  const disclosure = await configuredAiDisclosure(env)
  if (!disclosure || !env?.DB?.prepare) return false
  try {
    const row = await env.DB.prepare(`SELECT o.id FROM boing_organizations o JOIN boing_ai_consents c ON c.organization_id=o.id
      WHERE o.id=? AND o.status='active' AND o.ai_enabled=1 AND c.disclosure_hash=?`).bind(organizationId, disclosure.id).first()
    return !!row
  } catch { return false }
}

// The caller must authenticate the session; membership and ownership are
// revalidated here. Organization ID is a selector, never authorization.
export async function handleBoingAiSettings(request, env, user, organizationId, { requestWorkos = fetch, now = Date.now() } = {}) {
  if (new URL(request.url).pathname !== '/api/boing/ai-settings') return null
  if (!validId(organizationId) || !user || user.verified !== 1 || user.status !== 'active') return reply({ error: 'access_required' }, 403)
  if (!env?.DB?.prepare || !env.DB.batch) return reply({ error: 'service_unavailable' }, 503)
  try {
    const original = await env.DB.prepare('SELECT workos_organization_id FROM boing_organizations WHERE id=? AND status=\'active\'').bind(organizationId).first()
    const context = await resolveBoingContext(env, user, organizationId, requestWorkos)
    if (context.status === 'unavailable') return reply({ error: 'service_unavailable' }, 503)
    if (context.status !== 'allowed' || !original?.workos_organization_id) return reply({ error: 'access_required' }, 403)
    const disclosure = await configuredAiDisclosure(env)
    const available = !!disclosure && env.BOING_AI_BUDGET_APPROVED === 'true' && typeof env.AI?.run === 'function'
    const read = async () => env.DB.prepare(`SELECT o.ai_enabled, c.disclosure_hash FROM boing_organizations o
      LEFT JOIN boing_ai_consents c ON c.organization_id=o.id WHERE o.id=? AND o.status='active'
      AND o.workos_organization_id=? AND ${member}`).bind(organizationId, original.workos_organization_id, user.id).first()
    if (request.method === 'GET') {
      const row = await read()
      if (!row) return reply({ error: 'owner_required' }, 403)
      return reply({ enabled: row.ai_enabled === 1 && !!disclosure && row.disclosure_hash === disclosure.id,
        available, disclosure })
    }
    if (request.method !== 'PUT') return reply({ error: 'method_not_allowed' }, 405)
    if (context.role !== 'owner') return reply({ error: 'owner_required' }, 403)
    if (!env.APP_URL || new URL(request.url).origin !== env.APP_URL || request.headers.get('origin') !== env.APP_URL) return reply({ error: 'invalid_origin' }, 403)
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) return reply({ error: 'json_required' }, 415)
    if (Number(request.headers.get('content-length')) > 1024 || !request.body) return reply({ error: 'invalid_request' }, 400)
    const reader = request.body.getReader()
    let size = 0, raw = ''
    try {
      const decoder = new TextDecoder('utf-8', { fatal: true })
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > 1024) { await reader.cancel(); return reply({ error: 'invalid_request' }, 400) }
        raw += decoder.decode(value, { stream: true })
      }
      raw += decoder.decode()
    } finally { reader.releaseLock() }
    let input
    try { input = JSON.parse(raw) } catch { return reply({ error: 'invalid_request' }, 400) }
    if (!input || Array.isArray(input) || typeof input.enabled !== 'boolean' ||
        (input.enabled ? Object.keys(input).sort().join(',') !== 'disclosureId,enabled' : Object.keys(input).join(',') !== 'enabled')) return reply({ error: 'invalid_request' }, 400)
    if (input.enabled && (!available || input.disclosureId !== disclosure.id)) return reply({ error: 'ai_unavailable_or_disclosure_changed' }, 409)
    if (!Number.isSafeInteger(now) || now < 0 || now > 8_640_000_000_000_000) return reply({ error: 'service_unavailable' }, 503)
    const bindingRequired = env.BOING_MEMBERSHIP_BINDING_REQUIRED === 'true'
    if (bindingRequired) {
      // The request body can arrive over time. Recheck the provider after it
      // has been consumed and compare to the original verified grant.
      const current = await resolveBoingContext(env, user, organizationId, requestWorkos)
      if (current.status === 'unavailable') return reply({ error: 'service_unavailable' }, 503)
      if (current.status !== 'allowed' || current.role !== 'owner' || current.organizationId !== context.organizationId ||
          current.userId !== context.userId || current.membershipId !== context.membershipId ||
          current.membershipUpdatedAt !== context.membershipUpdatedAt) return reply({ error: 'owner_required' }, 403)
    }
    const stamp = new Date(now).toISOString(), action = input.enabled ? 'ai.enabled' : 'ai.disabled'
    const bindingCheck = `EXISTS (SELECT 1 FROM boing_workos_membership_bindings b
      JOIN boing_memberships m ON m.organization_id=b.organization_id AND m.user_id=b.user_id
      JOIN boing_identities i ON i.user_id=m.user_id JOIN boing_organizations o ON o.id=m.organization_id
      WHERE b.organization_id=? AND b.user_id=? AND b.workos_membership_id=? AND b.workos_updated_at=?
        AND m.role='owner' AND m.status='active' AND i.status='active' AND o.status='active' AND o.workos_organization_id=?)`
    const bindingArgs = [organizationId, user.id, context.membershipId, context.membershipUpdatedAt, original.workos_organization_id]
    const update = env.DB.prepare(`UPDATE boing_organizations SET ai_enabled=? WHERE id=? AND status='active' AND workos_organization_id=? AND ${owner}${bindingRequired ? ` AND ${bindingCheck}` : ''}`)
      .bind(input.enabled ? 1 : 0, organizationId, original.workos_organization_id, user.id, ...(bindingRequired ? bindingArgs : []))
    // A NOT NULL failure aborts the transactional batch if the previous write
    // or its binding predicate fails, rather than committing a partial update.
    const audit = bindingRequired
      ? env.DB.prepare(`INSERT INTO boing_audit_events(id,organization_id,actor_id,project_id,action,occurred_at)
          VALUES(?,CASE WHEN changes()=1 AND ${bindingCheck} THEN ? ELSE NULL END,?,NULL,?,?)`)
        .bind(crypto.randomUUID(), ...bindingArgs, organizationId, user.id, action, stamp)
      : env.DB.prepare(`INSERT INTO boing_audit_events(id,organization_id,actor_id,project_id,action,occurred_at)
          SELECT ?,?,?,NULL,?,? WHERE changes()=1`).bind(crypto.randomUUID(), organizationId, user.id, action, stamp)
    const statements = [update, audit]
    if (input.enabled) statements.push(bindingRequired
      ? env.DB.prepare(`INSERT INTO boing_ai_consents(organization_id,disclosure_hash,accepted_by,accepted_at)
          VALUES(CASE WHEN changes()=1 AND ${bindingCheck} THEN ? ELSE NULL END,?,?,?)
          ON CONFLICT(organization_id) DO UPDATE SET disclosure_hash=excluded.disclosure_hash,accepted_by=excluded.accepted_by,accepted_at=excluded.accepted_at`)
        .bind(...bindingArgs, organizationId, disclosure.id, user.id, stamp)
      : env.DB.prepare(`INSERT INTO boing_ai_consents(organization_id,disclosure_hash,accepted_by,accepted_at)
          SELECT ?,?,?,? WHERE changes()=1 ON CONFLICT(organization_id) DO UPDATE SET disclosure_hash=excluded.disclosure_hash,
          accepted_by=excluded.accepted_by,accepted_at=excluded.accepted_at`).bind(organizationId, disclosure.id, user.id, stamp))
    const result = await env.DB.batch(statements)
    if (result[0]?.meta?.changes !== 1 || result[1]?.meta?.changes !== 1 || (input.enabled && result[2]?.meta?.changes !== 1)) return reply({ error: 'owner_required' }, 403)
    return reply({ enabled: input.enabled })
  } catch { return reply({ error: 'service_unavailable' }, 503) }
}
