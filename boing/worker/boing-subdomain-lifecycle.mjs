const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value)
const validUser = value => typeof value === 'string' && /^user_[A-Za-z0-9]{1,120}$/.test(value)
const validWorkosOrg = value => typeof value === 'string' && /^org_[A-Za-z0-9]{1,120}$/.test(value)
const reserved = new Set(['app', 'www', 'api', 'admin', 'mail', 'auth', 'staging'])
const validSlug = value => typeof value === 'string' && /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(value) && !value.startsWith('xn--') && !reserved.has(value)
const requiredTriggers = ['boing_subdomain_no_reuse', 'boing_subdomain_record', 'boing_subdomain_immutable', 'boing_subdomain_delete_guard', 'boing_subdomain_retire', 'boing_subdomain_ledger_no_delete', 'boing_subdomain_ledger_no_replace', 'boing_subdomain_ledger_immutable']
const schemaGuard = `(SELECT count(*) FROM sqlite_master WHERE type='trigger' AND name IN (${requiredTriggers.map(() => '?').join(',')}))=?`

// This primitive is for a trusted operator workflow only. It is not an HTTP
// handler: the caller must independently authenticate the operator and verify
// the exact local and WorkOS organization identifiers before invoking it.
async function change(env, input, revoke, now) {
  const { actorId, organizationId, workosOrganizationId, slug } = input ?? {}
  if (!env?.DB?.prepare || !env.DB.batch || !validUser(actorId) || !validId(organizationId) ||
      !validWorkosOrg(workosOrganizationId) || !validSlug(slug) ||
      typeof env.BOING_PLATFORM_ADMIN_IDS !== 'string' ||
      !env.BOING_PLATFORM_ADMIN_IDS.split(',').map(id => id.trim()).includes(actorId) ||
      !Number.isSafeInteger(now) || now < 0 || now > 8_640_000_000_000_000) return { status: 'denied' }
  const db = env.DB, event = crypto.randomUUID(), at = new Date(now).toISOString()
  try {
    const eligible = revoke
      ? `AND EXISTS (SELECT 1 FROM boing_organization_subdomains s JOIN boing_subdomain_generations g ON g.slug=s.slug AND g.organization_id=s.organization_id AND g.state='active' WHERE s.slug=? AND s.organization_id=o.id)`
      : `AND NOT EXISTS (SELECT 1 FROM boing_subdomain_generations g WHERE g.slug=?) AND NOT EXISTS (SELECT 1 FROM boing_organization_subdomains s WHERE s.organization_id=o.id)`
    const mutation = revoke
      ? db.prepare(`DELETE FROM boing_organization_subdomains WHERE slug=? AND organization_id=? AND EXISTS (SELECT 1 FROM boing_audit_events WHERE id=? AND organization_id=? AND actor_id=?)`).bind(slug, organizationId, event, organizationId, actorId)
      : db.prepare(`INSERT INTO boing_organization_subdomains(slug,organization_id,created_at) SELECT ?,?,? WHERE EXISTS (SELECT 1 FROM boing_audit_events WHERE id=? AND organization_id=? AND actor_id=?)`).bind(slug, organizationId, at, event, organizationId, actorId)
    const result = await db.batch([
      db.prepare(`INSERT INTO boing_audit_events(id,organization_id,actor_id,project_id,action,occurred_at)
        SELECT ?,o.id,i.user_id,NULL,?,? FROM boing_organizations o JOIN boing_identities i ON i.user_id=? AND i.status='active'
        WHERE o.id=? AND o.workos_organization_id=? AND o.status='active' AND ${schemaGuard} ${eligible}`)
        .bind(event, revoke ? 'workspace.hostname_revoked' : 'workspace.hostname_assigned', at, actorId, organizationId, workosOrganizationId, ...requiredTriggers, requiredTriggers.length, slug),
      mutation,
      db.prepare(`UPDATE boing_audit_events SET action=CASE WHEN changes()=1 THEN action ELSE NULL END WHERE id=?`).bind(event),
    ])
    return result[0]?.meta?.changes === 1 && result[1]?.meta?.changes === 1 && result[2]?.meta?.changes === 1
      ? { status: revoke ? 'revoked' : 'assigned' } : { status: 'denied' }
  } catch { return { status: 'unavailable' } }
}

export const assignWorkspaceSubdomain = (env, input, { now = Date.now() } = {}) => change(env, input, false, now)
export const revokeWorkspaceSubdomain = (env, input, { now = Date.now() } = {}) => change(env, input, true, now)

// Future mutation handlers may use this server-read proof only if they check
// the slug, organization, generation and active state inside each write.
export async function readWorkspaceSubdomainProof(db, slug, organizationId) {
  if (!db?.prepare || !validSlug(slug) || !validId(organizationId)) return null
  try {
    const row = await db.prepare(`SELECT g.generation FROM boing_subdomain_generations g
      JOIN boing_organization_subdomains s ON s.slug=g.slug AND s.organization_id=g.organization_id
      JOIN boing_organizations o ON o.id=s.organization_id
      WHERE g.slug=? AND g.organization_id=? AND g.state='active' AND o.status='active'`).bind(slug, organizationId).first()
    return /^[a-f0-9]{32}$/.test(row?.generation ?? '') ? { slug, organizationId, generation: row.generation } : null
  } catch { return null }
}
