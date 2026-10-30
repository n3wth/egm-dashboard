import { validatePresentation } from '../egm-performance/src/presentation-state.js'
import { listProjects, projectAccess, readProjectPresentation, readProjectSnapshot, readProjectSources, updateProjectPresentation } from './boing-tenancy.mjs'
import { collectionReadiness } from './boing-collection-config.mjs'
import { resolveBoingContext } from './boing-context.mjs'

const MAX_BODY = 130000
const json = (body, status = 200, extra = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json', 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff', ...extra },
})

async function boundedText(request, limit = MAX_BODY) {
  if (!request.body) return ''
  const reader = request.body.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let size = 0, result = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > limit) { await reader.cancel(); return null }
      result += decoder.decode(value, { stream: true })
    }
    return result + decoder.decode()
  } finally { reader.releaseLock() }
}

// Only call this after the Worker verifies its session and current WorkOS
// identity and current WorkOS membership for organizationId. Both user and
// organizationId are server arguments, never parsed from the request.
// Returns null for routes outside this API so the caller can continue routing.
export async function handleBoingApi(request, env, user, organizationId, { context, requestWorkos = fetch } = {}) {
  const url = new URL(request.url)
  if (url.pathname !== '/api/boing' && !url.pathname.startsWith('/api/boing/')) return null
  if (!user || typeof user.id !== 'string' || !user.id || user.verified !== 1 || user.status !== 'active') return json({ error: 'sign_in_required' }, 401)
  if (typeof organizationId !== 'string' || !organizationId) return json({ error: 'verified_organization_required' }, 403)
  if (!env?.DB) return json({ error: 'service_unavailable' }, 503)
  const projects = url.pathname === '/api/boing/projects'
  const match = /^\/api\/boing\/projects\/([A-Za-z0-9_-]{1,128})\/(snapshot|presentation|sources|name)$/.exec(url.pathname)
  if (!projects && !match) return json({ error: 'not_found' }, 404)
  const allowed = projects ? ['GET', 'POST'] : match[2] === 'name' ? ['PUT'] : match[2] !== 'presentation' ? ['GET'] : ['GET', 'PUT']
  if (!allowed.includes(request.method)) return json({ error: 'method_not_allowed' }, 405, { allow: allowed.join(', ') })
  try {
    if (projects && request.method === 'GET') return json({ projects: await listProjects(env.DB, user.id, organizationId) })
    if (projects) {
      if (!env.APP_URL || url.origin !== env.APP_URL || request.headers.get('origin') !== env.APP_URL) return json({ error: 'invalid_origin' }, 403)
      if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) return json({ error: 'json_required' }, 415)
      if (Number(request.headers.get('content-length')) > 4096) return json({ error: 'too_large' }, 413)
      let input
      try {
        const text = await boundedText(request, 4096)
        if (text === null) return json({ error: 'too_large' }, 413)
        input = JSON.parse(text)
      } catch { return json({ error: 'invalid_json' }, 400) }
      if (!input || typeof input !== 'object' || Array.isArray(input) ||
          Object.keys(input).length !== 1 || typeof input.name !== 'string') return json({ error: 'invalid_project' }, 400)
      const name = input.name.trim()
      if (!name || name.length > 100 || /[\u0000-\u001f\u007f]/.test(name)) return json({ error: 'invalid_project' }, 400)
      const binding = await mutationBinding(env, user, organizationId, context, requestWorkos, ['owner'])
      if (binding === false) return json({ error: 'forbidden' }, 403)
      const id = crypto.randomUUID()
      // Authorization and the per-workspace bound are checked in the insert,
      // so a revoked membership cannot win a read-then-write race.
      const result = await env.DB.prepare(`INSERT INTO boing_projects(id,organization_id,name,repository,website_url,status,created_at)
        SELECT ?,o.id,?,NULL,NULL,'active',? FROM boing_organizations o
        JOIN boing_memberships m ON m.organization_id=o.id
        JOIN boing_identities u ON u.user_id=m.user_id
        WHERE o.id=? AND o.status='active' AND m.user_id=? AND m.status='active'
          AND m.role='owner' AND u.status='active'
          AND (SELECT COUNT(*) FROM boing_projects p WHERE p.organization_id=o.id AND p.status='active')<100
          ${binding ? `AND EXISTS (SELECT 1 FROM boing_workos_membership_bindings b WHERE b.organization_id=o.id AND b.user_id=m.user_id AND b.workos_membership_id=? AND b.workos_updated_at=?)` : ''}`)
        .bind(id, name, new Date().toISOString(), organizationId, user.id, ...(binding ? [binding.membershipId, binding.membershipUpdatedAt] : [])).run()
      if (result?.meta?.changes !== 1) return json({ error: 'project_creation_unavailable' }, 403)
      return json({ project: { id, name } }, 201)
    }
    const [, projectId, resource] = match
    if (resource === 'name') {
      if (!env.APP_URL || url.origin !== env.APP_URL || request.headers.get('origin') !== env.APP_URL) return json({ error: 'invalid_origin' }, 403)
      if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) return json({ error: 'json_required' }, 415)
      if (Number(request.headers.get('content-length')) > 4096) return json({ error: 'too_large' }, 413)
      let input
      try {
        const text = await boundedText(request, 4096)
        if (text === null) return json({ error: 'too_large' }, 413)
        input = JSON.parse(text)
      } catch { return json({ error: 'invalid_json' }, 400) }
      if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== 1 || typeof input.name !== 'string') return json({ error: 'invalid_project' }, 400)
      const name = input.name.trim()
      if (!name || name.length > 100 || /[\u0000-\u001f\u007f]/.test(name)) return json({ error: 'invalid_project' }, 400)
      const binding = await mutationBinding(env, user, organizationId, context, requestWorkos, ['owner'])
      if (binding === false) return json({ error: 'forbidden' }, 403)
      if (typeof env.DB.batch !== 'function') return json({ error: 'service_unavailable' }, 503)
      const event = crypto.randomUUID()
      const results = await env.DB.batch([
        env.DB.prepare(`UPDATE boing_projects SET name=? WHERE id=? AND organization_id=? AND status='active'
          AND EXISTS (SELECT 1 FROM boing_organizations o JOIN boing_memberships m ON m.organization_id=o.id
            JOIN boing_identities i ON i.user_id=m.user_id WHERE o.id=boing_projects.organization_id AND o.status='active'
              AND m.user_id=? AND m.status='active' AND m.role='owner' AND i.status='active')
          ${binding ? `AND EXISTS (SELECT 1 FROM boing_workos_membership_bindings b WHERE b.organization_id=boing_projects.organization_id AND b.user_id=? AND b.workos_membership_id=? AND b.workos_updated_at=?)` : ''}`)
          .bind(name, projectId, organizationId, user.id, ...(binding ? [user.id, binding.membershipId, binding.membershipUpdatedAt] : [])),
        env.DB.prepare(`INSERT INTO boing_audit_events(id,organization_id,actor_id,project_id,action,occurred_at)
          SELECT ?,?,?,?,'project.renamed',? WHERE changes()=1`)
          .bind(event, organizationId, user.id, projectId, new Date().toISOString()),
      ])
      if (results[0]?.meta?.changes !== 1 || results[1]?.meta?.changes !== 1) return json({ error: 'project_unavailable' }, 404)
      return json({ project: { id: projectId, name } })
    }
    if (resource === 'sources') {
      const records = await readProjectSources(env.DB, user.id, projectId, organizationId)
      if (!records.length) return json({ error: 'not_found' }, 404)
      const configured = await collectionReadiness(env)
      const sources = records.map(record => {
        const data = record.body === null ? null : JSON.parse(record.body)
        if (record.body !== null && (!data || typeof data !== 'object' || Array.isArray(data))) throw new Error('invalid source result')
        // A collector can complete successfully while reporting that its
        // provider is unavailable. Do not present that response as metrics or
        // disclose its raw provider error. The stored row has no history, so an
        // unavailable publication cannot recover an older successful result.
        const unavailable = data?.status === 'unavailable'
        const available = data !== null && !unavailable
        return {
          kind: record.kind,
          collectionConfigured: configured[record.kind] === true,
          available,
          data: available ? data : null,
          generatedAt: available ? record.generated_at ?? null : null,
          lastCollection: record.job_status ? { status: record.job_status, finishedAt: record.finished_at ?? null } : null,
          error: record.job_status === 'failed' ? 'collection_failed' : unavailable ? 'source_unavailable' : null,
        }
      })
      return json({ sources })
    }
    if (resource === 'snapshot') {
      const record = await readProjectSnapshot(env.DB, user.id, projectId, organizationId)
      if (!record) return json({ error: 'not_found' }, 404)
      // Reject malformed stored JSON rather than returning an unrelated seed.
      return json({ snapshot: JSON.parse(record.body), generatedAt: record.generated_at })
    }
    if (request.method === 'GET') {
      const record = await readProjectPresentation(env.DB, user.id, projectId, organizationId)
      if (!record) return json({ error: 'not_found' }, 404)
      return json({ presentation: JSON.parse(record.body), revision: record.revision, canEdit: ['owner', 'admin'].includes(record.role) })
    }
    if (!env.APP_URL || url.origin !== env.APP_URL || request.headers.get('origin') !== env.APP_URL) return json({ error: 'invalid_origin' }, 403)
    const access = await projectAccess(env.DB, user.id, projectId, organizationId)
    if (!access) return json({ error: 'not_found' }, 404)
    if (!['owner', 'admin'].includes(access.role)) return json({ error: 'forbidden' }, 403)
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) return json({ error: 'json_required' }, 415)
    if (Number(request.headers.get('content-length')) > MAX_BODY) return json({ error: 'too_large' }, 413)
    let text
    try { text = await boundedText(request) } catch { return json({ error: 'invalid_json' }, 400) }
    if (text === null) return json({ error: 'too_large' }, 413)
    let presentation, revision
    try {
      const input = JSON.parse(text)
      if (!input || !Number.isSafeInteger(input.revision) || input.revision < 0) throw new Error('invalid revision')
      revision = input.revision
      presentation = validatePresentation(input.presentation)
      if (presentation.verification) throw new Error('verification cannot be set here')
    } catch { return json({ error: 'invalid_presentation' }, 400) }
    const binding = await mutationBinding(env, user, organizationId, context, requestWorkos, ['owner', 'admin'])
    if (binding === false) return json({ error: 'forbidden' }, 403)
    const updated = await updateProjectPresentation(env.DB, user.id, projectId, JSON.stringify(presentation), revision, organizationId, binding)
    if (!updated && binding) return json({ error: 'update_unavailable' }, 409)
    const record = await readProjectPresentation(env.DB, user.id, projectId, organizationId)
    if (!record) return json({ error: 'not_found' }, 404)
    return json({ presentation: JSON.parse(record.body), revision: record.revision, canEdit: ['owner', 'admin'].includes(record.role) }, updated ? 200 : 409)
  } catch {
    // Never leak provider errors, SQL, tokens, or inaccessible tenant data.
    return json({ error: 'service_unavailable' }, 503)
  }
}

// Preserve the router's verified membership generation across body streaming.
async function mutationBinding(env, user, organizationId, context, requestWorkos, roles) {
  if (env.BOING_MEMBERSHIP_BINDING_REQUIRED !== 'true') return null
  if (context?.status !== 'allowed' || context.userId !== user.id || context.organizationId !== organizationId ||
      !roles.includes(context.role) || typeof context.membershipId !== 'string' || !context.membershipId ||
      typeof context.membershipUpdatedAt !== 'string' || !context.membershipUpdatedAt) return false
  const current = await resolveBoingContext(env, user, organizationId, requestWorkos)
  if (current.status === 'unavailable') throw new Error('membership unavailable')
  if (current.status !== 'allowed' || current.role !== context.role || current.membershipId !== context.membershipId ||
      current.membershipUpdatedAt !== context.membershipUpdatedAt) return false
  return { role: context.role, membershipId: context.membershipId, membershipUpdatedAt: context.membershipUpdatedAt }
}
