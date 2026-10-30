// Boing-only ledger. The tables and membership guard are not used by the EGM
// Worker. EGM collection caps live with the EGM refresh code, not here.
const limit = value => typeof value === 'string' && /^[1-9][0-9]{0,5}$/.test(value) ? Number(value) : null

export function providerCallLimits(env, provider) {
  const prefix = provider === 'github' ? 'BOING_GITHUB' : provider === 'pagespeed' ? 'BOING_PAGESPEED' : null
  if (!prefix) return null
  const global = limit(env?.[`${prefix}_DAILY_CALL_LIMIT`])
  const workspace = limit(env?.[`${prefix}_WORKSPACE_DAILY_CALL_LIMIT`])
  return global && workspace && workspace <= global ? { global, workspace } : null
}

// Reserve before every network attempt, including failures and timeouts. One
// SQLite statement serializes concurrent writers and never refunds ambiguity.
export async function reserveProviderCall(env, provider, organizationId, now = Date.now(), claim = null) {
  const limits = providerCallLimits(env, provider)
  if (!limits || !env?.DB?.prepare || !/^[A-Za-z0-9_-]{1,128}$/.test(organizationId ?? '') ||
      !Number.isSafeInteger(now) || now < 0 || now > 8_640_000_000_000_000) return false
  if (claim && (!/^[A-Za-z0-9_-]{1,128}$/.test(claim.id ?? '') || !/^[A-Za-z0-9_-]{1,128}$/.test(claim.claimId ?? '') || !['owner', 'admin', 'member'].includes(claim.membershipRole))) return false
  const day = new Date(now).toISOString().slice(0, 10)
  const bound = env.BOING_MEMBERSHIP_BINDING_REQUIRED === 'true'
  if (claim && bound && (!/^om_[A-Za-z0-9]+$/.test(claim.membershipId ?? '') || typeof claim.membershipUpdatedAt !== 'string' || !claim.membershipUpdatedAt)) return false
  const guard = claim ? `AND EXISTS (SELECT 1 FROM boing_collection_jobs j JOIN boing_projects p ON p.id=j.project_id AND p.organization_id=j.organization_id JOIN boing_organizations o ON o.id=j.organization_id JOIN boing_memberships m ON m.organization_id=o.id AND m.user_id=j.actor_id JOIN boing_identities u ON u.user_id=m.user_id JOIN boing_source_versions v ON v.project_id=p.id AND v.kind=j.kind AND v.revision=j.source_revision WHERE j.id=? AND j.claim_id=? AND j.organization_id=? AND j.kind=? AND j.status='running' AND j.expires_at>? AND j.lease_expires_at>? AND o.status='active' AND p.status='active' AND m.status='active' AND m.role=? AND u.status='active' AND (m.role='owner' OR EXISTS (SELECT 1 FROM boing_project_memberships pm WHERE pm.organization_id=o.id AND pm.project_id=p.id AND pm.user_id=m.user_id)) AND ((j.kind='website' AND p.website_url IS NOT NULL AND p.website_url<>'') OR (j.kind='github' AND EXISTS (SELECT 1 FROM boing_github_repositories r JOIN boing_github_installations i ON i.organization_id=r.organization_id AND i.installation_id=r.installation_id WHERE r.organization_id=o.id AND r.project_id=p.id AND i.status='active'))) ${bound ? "AND EXISTS (SELECT 1 FROM boing_workos_membership_bindings b WHERE b.organization_id=o.id AND b.user_id=m.user_id AND b.workos_membership_id=? AND b.workos_updated_at=?)" : ''})` : ''
  const guardArgs = claim ? [claim.id, claim.claimId, organizationId, provider === 'pagespeed' ? 'website' : 'github', now, now, claim.membershipRole, ...(bound ? [claim.membershipId, claim.membershipUpdatedAt] : [])] : []
  try {
    const result = await env.DB.prepare(`INSERT INTO boing_provider_call_budget(day, provider, organization_id, calls)
      SELECT ?,?,?,1 WHERE (SELECT COALESCE(SUM(calls),0) FROM boing_provider_call_budget WHERE day=? AND provider=?) < ? ${guard}
      ON CONFLICT(day,provider,organization_id) DO UPDATE SET calls=calls+1
      WHERE calls < ? AND (SELECT COALESCE(SUM(calls),0) FROM boing_provider_call_budget WHERE day=? AND provider=?) < ?`)
      .bind(day, provider, organizationId, day, provider, limits.global, ...guardArgs, limits.workspace, day, provider, limits.global).run()
    return result.meta?.changes === 1
  } catch { return false }
}

export function budgetedProviderRequest(env, provider, organizationId, request, clock = Date.now, claim = null) {
  const hostname = provider === 'github' ? 'api.github.com' : provider === 'pagespeed' ? 'www.googleapis.com' : null
  return async (url, options) => {
    let parsed
    try { parsed = new URL(typeof url === 'string' ? url : url.url) } catch { throw new Error('Provider request denied') }
    if (!hostname || parsed.protocol !== 'https:' || parsed.hostname !== hostname || parsed.port ||
        !claim || !await reserveProviderCall(env, provider, organizationId, clock(), claim)) throw new Error('Provider request denied')
    return request(url, options)
  }
}
