import { verifyGithubRepository, recheckGithubBinding } from './boing-github-verify.mjs'

const scopes = new Set(['snapshot', 'sources', 'export', 'insight', 'presentation'])
const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value)

// An unbound project's collector results cannot contain a current GitHub
// source, but an older snapshot or repository field can contain GitHub data.
// Those legacy records require a separately verified migration policy.
async function localState(env, user, organizationId, projectId) {
  return env.DB.prepare(`SELECT o.workos_organization_id, p.repository, p.website_url,
    (SELECT revision FROM boing_source_versions WHERE project_id=p.id AND kind='website') AS website_revision,
    EXISTS(SELECT 1 FROM boing_snapshots s WHERE s.project_id=p.id) AS has_snapshot,
    EXISTS(SELECT 1 FROM boing_github_repositories r WHERE r.organization_id=o.id AND r.project_id=p.id) AS has_binding
    FROM boing_projects p JOIN boing_organizations o ON o.id=p.organization_id
    JOIN boing_memberships m ON m.organization_id=o.id AND m.user_id=?
    JOIN boing_identities i ON i.user_id=m.user_id
    WHERE o.id=? AND p.id=? AND o.status='active' AND p.status='active' AND m.status='active' AND i.status='active'
      AND (m.role='owner' OR EXISTS (SELECT 1 FROM boing_project_memberships pm
        WHERE pm.organization_id=o.id AND pm.project_id=p.id AND pm.user_id=m.user_id))`)
    .bind(user.id, organizationId, projectId).first()
}

function unboundAllowed(state, scope) {
  return !!state && !state.has_binding && (scope === 'sources' || (!state.has_snapshot && !state.repository))
}
const sameWebsite = (state, proof) => !!state && state.website_url === proof.websiteUrl && state.website_revision === proof.websiteRevision

// WorkOS membership must already have been freshly verified by the caller.
// Project IDs are selectors, never proof of authorization. This guard is for
// server-side use only, and does not accept verification proofs from clients.
export async function authorizeProjectData(env, user, organizationId, projectId, scope, { request = fetch, verify = verifyGithubRepository } = {}) {
  if (!env?.DB?.prepare || !user || user.verified !== 1 || user.status !== 'active' ||
      !validId(user.id) || !validId(organizationId) || !validId(projectId) || !scopes.has(scope)) return { status: 'denied' }
  try {
    const initial = await localState(env, user, organizationId, projectId)
    if (!initial || !initial.workos_organization_id) return { status: 'denied' }
    const verification = await verify(env, user, organizationId, projectId, { request })
    if (verification?.status === 'unavailable') return { status: 'unavailable' }
    if (verification?.status === 'verified') {
      if (!initial.has_binding || verification.binding?.workosOrganizationId !== initial.workos_organization_id) return { status: 'denied' }
      return { status: 'allowed', proof: { kind: 'bound', organizationId, projectId, userId: user.id, scope, binding: verification.binding, websiteUrl: initial.website_url, websiteRevision: initial.website_revision } }
    }
    if (verification?.status !== 'unbound' || !unboundAllowed(initial, scope)) return { status: 'denied' }
    const current = await localState(env, user, organizationId, projectId)
    if (!unboundAllowed(current, scope) || current.workos_organization_id !== initial.workos_organization_id || current.website_url !== initial.website_url || current.website_revision !== initial.website_revision) return { status: 'denied' }
    return { status: 'allowed', proof: { kind: 'unbound', organizationId, projectId, userId: user.id, scope, workosOrganizationId: current.workos_organization_id, websiteUrl: current.website_url, websiteRevision: current.website_revision } }
  } catch { return { status: 'unavailable' } }
}

// Call immediately before data leaves the Worker, and immediately before AI
// inference sends data to its processor. Rechecks local membership, mapping,
// installation state and source version; provider revocation after its network
// verification cannot be ruled out without another provider call.
export async function recheckProjectData(env, user, proof, { recheck = recheckGithubBinding } = {}) {
  if (!env?.DB?.prepare || !user || user.verified !== 1 || user.status !== 'active' || !proof ||
      proof.userId !== user.id || !validId(proof.organizationId) || !validId(proof.projectId) || !scopes.has(proof.scope)) return false
  try {
    if (proof.kind === 'bound') {
      if (!await recheck(env, user, proof.organizationId, proof.projectId, proof.binding)) return false
      return sameWebsite(await localState(env, user, proof.organizationId, proof.projectId), proof)
    }
    if (proof.kind !== 'unbound') return false
    const state = await localState(env, user, proof.organizationId, proof.projectId)
    return unboundAllowed(state, proof.scope) && state.workos_organization_id === proof.workosOrganizationId && sameWebsite(state, proof)
  } catch { return false }
}
