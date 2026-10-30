import { resolveBoingContext } from './boing-context.mjs'
import { handleBoingApi } from './boing-api.mjs'
import { handleBoingAiInsight } from './boing-ai.mjs'
import { handleBoingProjectExport } from './boing-export.mjs'
import { updateProjectWebsite } from './boing-website.mjs'
import { publicWebsiteUrl } from './boing-integrations.mjs'
import { bindWorkosInvitation, createInvitation, listInvitations, revokeInvitation } from './boing-invites.mjs'
import { handleBoingMembers } from './boing-members.mjs'
import { consumeQuota } from './boing-quotas.mjs'
import { handleBoingAiSettings } from './boing-ai-settings.mjs'
import { handleMembershipRevocation } from './boing-membership-admin.mjs'
import { handleProjectArchive } from './boing-project-archive.mjs'
import { handleArchivedProjects } from './boing-archived-list.mjs'
import { handleBoingAuditView } from './boing-audit-view.mjs'
import { readMetricHistory } from './boing-history.mjs'
import { authorizeProjectData, recheckProjectData } from './boing-project-data-guard.mjs'
import { verifiedProjectList } from './boing-project-list.mjs'
import { admitManualCollection } from './boing-manual-collection.mjs'
import { runCollectionJob } from './boing-runner.mjs'
import { collectionReadiness } from './boing-collection-config.mjs'
import { readCollectionStatus } from './boing-collection-status.mjs'
import { handleBoingWorkspaceExport } from './boing-workspace-export.mjs'

const failure = (error, status) => Response.json({ error }, {
  status, headers: { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' }
})
const oversized = Symbol('oversized')

async function websiteBody(request) {
  const reader = request.body?.getReader()
  if (!reader) return null
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let text = '', size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > 4096) { await reader.cancel(); return oversized }
      text += decoder.decode(value, { stream: true })
    }
    return JSON.parse(text + decoder.decode())
  } finally { reader.releaseLock() }
}

// Staging dispatcher only. The caller must authenticate and freshly verify the
// session and identity before passing user. organizationSelector is a resource
// selector, not proof of access. requestWorkos is for injecting a test transport;
// callers must not let clients control it. This does not route legacy endpoints.
async function dispatchBoingRoute(request, env, user, organizationSelector, { requestWorkos, requestGithub, authorizeData = authorizeProjectData, recheckData = recheckProjectData, projectList = verifiedProjectList, waitUntil, runJob = runCollectionJob } = {}) {
  const path = new URL(request.url).pathname
  if (path !== '/api/boing' && !path.startsWith('/api/boing/')) return null
  if (!user || user.verified !== 1 || user.status !== 'active') return failure('sign_in_required', 401)
  try {
    const mapping = () => env.DB.prepare('SELECT workos_organization_id FROM boing_organizations WHERE id=?')
      .bind(organizationSelector).first()
    const before = path === '/api/boing/insights' ? await mapping() : null
    const context = await resolveBoingContext(env, user, organizationSelector, requestWorkos)
    if (context.status === 'unavailable') return failure('service_unavailable', 503)
    if (context.status !== 'allowed') return failure('organization_access_required', 403)
    if (path === '/api/boing/workspace/export') return await handleBoingWorkspaceExport(request, env, user, context.organizationId, { requestWorkos, requestGithub })
    const manualCollection = /^\/api\/boing\/projects\/([A-Za-z0-9_-]{1,128})\/collect$/.exec(path)
    if (manualCollection) {
      if (request.method !== 'POST') return failure('method_not_allowed', 405)
      if (!env.APP_URL || new URL(request.url).origin !== env.APP_URL || request.headers.get('origin') !== env.APP_URL) return failure('invalid_origin', 403)
      if (request.body) return failure('invalid_request', 400)
      if (context.role !== 'owner') return failure('not_found', 404)
      const configured = await collectionReadiness(env)
      if ((!configured.github && !configured.website) || typeof waitUntil !== 'function') return failure('collection_unavailable', 503)
      const current = await resolveBoingContext(env, user, context.organizationId, requestWorkos)
      if (current.status !== 'allowed' || current.role !== 'owner' || current.membershipId !== context.membershipId || current.membershipUpdatedAt !== context.membershipUpdatedAt) return failure(current.status === 'unavailable' ? 'service_unavailable' : 'organization_access_required', current.status === 'unavailable' ? 503 : 403)
      const result = await admitManualCollection(env, current, manualCollection[1])
      if (result.admitted.length) {
        // Only server-created IDs are dispatched, sequentially; runner rechecks
        // membership and source permissions before collection and publication.
        waitUntil((async () => { for (const job of result.admitted) await runJob(env, job.id) })().catch(() => {}))
        return Response.json({ status: 'queued', partial: result.status === 'unavailable' }, { status: 202, headers: { 'cache-control': 'private, no-store' } })
      }
      if (result.status === 'unavailable' || result.status === 'disabled' || result.status === 'denied') return failure('collection_unavailable', 503)
      return failure('collection_not_queued', 409)
    }
    if (path === '/api/boing/audit') return await handleBoingAuditView(request, env, user, context.organizationId, { requestWorkos })
    const collectionStatus = /^\/api\/boing\/projects\/([A-Za-z0-9_-]{1,128})\/collection-status$/.exec(path)
    if (collectionStatus) {
      if (request.method !== 'GET') return failure('method_not_allowed', 405)
      const result = await readCollectionStatus(env, user, context.organizationId, collectionStatus[1], { requestWorkos, requestGithub })
      if (result.status !== 'allowed') return failure(result.status === 'unavailable' ? 'service_unavailable' : 'not_found', result.status === 'unavailable' ? 503 : 404)
      return Response.json({ jobs: result.jobs }, { headers: { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' } })
    }
    const history = /^\/api\/boing\/projects\/([A-Za-z0-9_-]{1,128})\/history$/.exec(path)
    if (history) {
      if (request.method !== 'GET') return failure('method_not_allowed', 405)
      const result = await readMetricHistory(env, user, context.organizationId, history[1], { requestWorkos, requestGithub })
      if (result.status !== 'allowed') return failure(result.status === 'unavailable' ? 'service_unavailable' : 'not_found', result.status === 'unavailable' ? 503 : 404)
      return Response.json({ history: result.history }, { headers: { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' } })
    }
    if (path === '/api/boing/projects/archived') return await handleArchivedProjects(request, env, user, context.organizationId, { requestWorkos })
    if (/^\/api\/boing\/projects\/[A-Za-z0-9_-]{1,128}\/(archive|restore)$/.test(path)) return await handleProjectArchive(request, env, user, context.organizationId, { requestWorkos })
    if (path === '/api/boing/projects' && request.method === 'GET') {
      const result = await projectList(env, user, context.organizationId, { request: requestGithub })
      return result.status === 'ok' ? Response.json({ projects: result.projects }, { headers: { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' } }) : failure('service_unavailable', 503)
    }
    if (/^\/api\/boing\/members\/user_[A-Za-z0-9]+\/revoke$/.test(path)) return await handleMembershipRevocation(request, env, user, context.organizationId, { requestWorkos })
    if (path === '/api/boing/ai-settings') return await handleBoingAiSettings(request, env, user, context.organizationId, { requestWorkos })
    const invitation = /^\/api\/boing\/invitations(?:\/([A-Za-z0-9_-]{1,128})\/(bind|revoke))?$/.exec(path)
    if (invitation) {
      if (context.role !== 'owner') return failure('owner_required', 403)
      if (!invitation[1] && request.method === 'GET') {
        const invitations = await listInvitations(env.DB, user.id, context.organizationId, context.organizationId)
        return invitations ? Response.json({ invitations }, { headers: { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' } }) : failure('owner_required', 403)
      }
      if (request.method !== 'POST') return failure('method_not_allowed', 405)
      if (!env.APP_URL || new URL(request.url).origin !== env.APP_URL || request.headers.get('origin') !== env.APP_URL) return failure('invalid_origin', 403)
      if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) return failure('json_required', 415)
      if (Number(request.headers.get('content-length')) > 4096) return failure('too_large', 413)
      let input
      try { input = await websiteBody(request) } catch { return failure('invalid_request', 400) }
      if (input === oversized) return failure('too_large', 413)
      if (!input || typeof input !== 'object' || Array.isArray(input)) return failure('invalid_request', 400)
      const current = await resolveBoingContext(env, user, context.organizationId, requestWorkos)
      if (current.status !== 'allowed' || current.role !== 'owner' || current.membershipId !== context.membershipId || current.membershipUpdatedAt !== context.membershipUpdatedAt) return failure(current.status === 'unavailable' ? 'service_unavailable' : 'organization_access_required', current.status === 'unavailable' ? 503 : 403)
      const membershipBinding = env.BOING_MEMBERSHIP_BINDING_REQUIRED === 'true' ? { id: current.membershipId, updatedAt: current.membershipUpdatedAt } : null
      if (!invitation[1]) {
        if (Object.keys(input).some(key => !['email', 'role'].includes(key)) || typeof input.email !== 'string' || !['admin', 'member'].includes(input.role)) return failure('invalid_request', 400)
        const created = await createInvitation(env.DB, user.id, context.organizationId, { organizationId: context.organizationId, email: input.email, role: input.role, membershipBinding })
        return created ? Response.json({ invitation: created }, { status: 201, headers: { 'cache-control': 'private, no-store', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff' } }) : failure('invitation_unavailable', 409)
      }
      if (invitation[2] === 'revoke') {
        if (Object.keys(input).length) return failure('invalid_request', 400)
        const revoked = await revokeInvitation(env.DB, user.id, context.organizationId, context.organizationId, invitation[1], membershipBinding)
        return revoked ? Response.json({ revoked: true }, { headers: { 'cache-control': 'private, no-store' } }) : failure('invitation_unavailable', 404)
      }
      if (Object.keys(input).length !== 1 || typeof input.providerToken !== 'string') return failure('invalid_request', 400)
      const bound = await bindWorkosInvitation(env, user, context.organizationId, invitation[1], input.providerToken, { request: requestWorkos })
      return bound ? Response.json({ bound: true }, { headers: { 'cache-control': 'private, no-store', 'referrer-policy': 'no-referrer' } }) : failure('invitation_unavailable', 409)
    }
    const website = /^\/api\/boing\/projects\/([A-Za-z0-9_-]{1,128})\/website$/.exec(path)
    if (website) {
      if (request.method !== 'PUT') return failure('method_not_allowed', 405)
      if (!env.APP_URL || new URL(request.url).origin !== env.APP_URL || request.headers.get('origin') !== env.APP_URL) return failure('invalid_origin', 403)
      if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) return failure('json_required', 415)
      if (Number(request.headers.get('content-length')) > 4096) return failure('too_large', 413)
      let input
      try { input = await websiteBody(request) } catch { return failure('invalid_request', 400) }
      if (input === oversized) return failure('too_large', 413)
      if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== 1 || !Object.hasOwn(input, 'website') || (input.website !== null && typeof input.website !== 'string')) return failure('invalid_request', 400)
      try { if (input.website !== null) publicWebsiteUrl(input.website) } catch { return failure('invalid_website', 400) }
      if (context.role !== 'owner') return failure('not_found', 404)
      const current = await resolveBoingContext(env, user, context.organizationId, requestWorkos)
      if (current.status !== 'allowed' || current.role !== 'owner' || current.membershipId !== context.membershipId || current.membershipUpdatedAt !== context.membershipUpdatedAt) return failure(current.status === 'unavailable' ? 'service_unavailable' : 'organization_access_required', current.status === 'unavailable' ? 503 : 403)
      const membershipBinding = env.BOING_MEMBERSHIP_BINDING_REQUIRED === 'true' ? { id: current.membershipId, updatedAt: current.membershipUpdatedAt } : null
      const updated = await updateProjectWebsite(env.DB, { userId: user.id, verifiedOrganizationId: context.organizationId, projectId: website[1], website: input.website, membershipBinding })
      return updated ? Response.json({ updated: true }, { headers: { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' } }) : failure('not_found', 404)
    }
    if (path === '/api/boing/insights') {
      if (request.method !== 'POST') return failure('method_not_allowed', 405)
      if (!env.APP_URL || new URL(request.url).origin !== env.APP_URL || request.headers.get('origin') !== env.APP_URL) return failure('invalid_origin', 403)
      // No provider call is permitted until the operator explicitly configures
      // a budget and the workspace owner opts in. Quotas fail closed.
      if (env.BOING_AI_BUDGET_APPROVED !== 'true') return failure('ai_unavailable', 503)
      const verifiedMapping = await mapping()
      if (!before?.workos_organization_id || before.workos_organization_id !== verifiedMapping?.workos_organization_id) return failure('organization_access_required', 403)
      const quota = await consumeQuota(env.DB, user, context.organizationId, { quota: 'ai.insight' })
      if (!quota.allowed) return failure(quota.reason === 'quota_exceeded' ? 'quota_exceeded' : 'ai_unavailable', quota.reason === 'quota_exceeded' ? 429 : 503)
      const response = await handleBoingAiInsight(request, env, user, context.organizationId, { requestWorkos, requestGithub })
      if (!response.ok) return response
      // Revalidate before disclosing an insight. This cannot retract data
      // already transmitted to the provider during an in-flight request.
      const current = await resolveBoingContext(env, user, organizationSelector, requestWorkos)
      if (current.status === 'unavailable') return failure('service_unavailable', 503)
      const after = await mapping()
      if (current.status !== 'allowed' || current.organizationId !== context.organizationId ||
          current.userId !== context.userId || current.role !== context.role ||
          after?.workos_organization_id !== before.workos_organization_id) return failure('organization_access_required', 403)
      return response
    }
    const protectedRead = /^\/api\/boing\/projects\/([A-Za-z0-9_-]{1,128})\/(snapshot|sources|export|presentation)$/.exec(path)
    if (protectedRead && (request.method === 'GET' || (protectedRead[2] === 'presentation' && request.method === 'PUT'))) {
      const guard = await authorizeData(env, user, context.organizationId, protectedRead[1], protectedRead[2], { request: requestGithub })
      if (guard.status !== 'allowed') return failure(guard.status === 'unavailable' ? 'service_unavailable' : 'not_found', guard.status === 'unavailable' ? 503 : 404)
      let response = protectedRead[2] === 'export' ? await handleBoingProjectExport(request, env, user, context.organizationId) : await handleBoingApi(request, env, user, context.organizationId, { context, requestWorkos })
      if (!response?.ok) return response ?? failure('not_found', 404)
      if (protectedRead[2] === 'export') {
        const history = await readMetricHistory(env, user, context.organizationId, protectedRead[1], { requestWorkos, requestGithub })
        if (history.status !== 'allowed') return failure(history.status === 'unavailable' ? 'service_unavailable' : 'not_found', history.status === 'unavailable' ? 503 : 404)
        const body = JSON.stringify({ ...await response.json(), history: history.history })
        if (new TextEncoder().encode(body).byteLength > 1024 * 1024) return failure('export_too_large', 413)
        response = new Response(body, { headers: response.headers })
      }
      if (!await recheckData(env, user, guard.proof)) return failure('service_unavailable', 503)
      return response
    }
    return await handleBoingMembers(request, env, user, context.organizationId, { requestWorkos }) ??
      await handleBoingApi(request, env, user, context.organizationId, { context, requestWorkos }) ?? failure('not_found', 404)
  } catch {
    return failure('service_unavailable', 503)
  }
}

// Recheck provider membership after asynchronous reads before returning data.
// This narrows, but cannot eliminate, revocation races across services.
export async function handleBoingRoute(request, env, user, organizationSelector, options = {}) {
  const path = new URL(request.url).pathname
  if (request.method !== 'GET' || (path !== '/api/boing' && !path.startsWith('/api/boing/'))) return dispatchBoingRoute(request, env, user, organizationSelector, options)
  if (!user || user.verified !== 1 || user.status !== 'active') return failure('sign_in_required', 401)
  const before = await resolveBoingContext(env, user, organizationSelector, options.requestWorkos)
  if (before.status !== 'allowed') return failure(before.status === 'unavailable' ? 'service_unavailable' : 'organization_access_required', before.status === 'unavailable' ? 503 : 403)
  const response = await dispatchBoingRoute(request, env, user, organizationSelector, options)
  if (!response?.ok) return response
  const after = await resolveBoingContext(env, user, organizationSelector, options.requestWorkos)
  if (after.status !== 'allowed' || after.organizationId !== before.organizationId || after.userId !== before.userId || after.role !== before.role ||
      after.membershipId !== before.membershipId || after.membershipUpdatedAt !== before.membershipUpdatedAt) {
    return failure(after.status === 'unavailable' ? 'service_unavailable' : 'organization_access_required', after.status === 'unavailable' ? 503 : 403)
  }
  return response
}
