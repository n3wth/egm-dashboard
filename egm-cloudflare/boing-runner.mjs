import { claimCollectionJob, finishCollectionJob, publishCollectionSnapshot } from './boing-jobs.mjs'
import { resolveBoingContext } from './boing-context.mjs'
import { collectGitHubProject, collectWebsitePerformance } from './boing-integrations.mjs'
import { budgetedProviderRequest, providerCallLimits } from './boing-provider-budget.mjs'
import { beginCollectionExecution, finishCollectionExecution } from './boing-execution-fence.mjs'

// A trusted scheduler passes one server-side job ID, never client-provided
// provider configuration. The caller must not expose this function as a route.
// This runner is not wired to a scheduler or deployed Worker.
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null
const metric = value => ({ count: count(value?.count), uniques: count(value?.uniques), status: value?.status === 'available' ? 'available' : 'unavailable' })

function safeGitHub(result, config) {
  if (!result || result.repository?.id !== config.repository_id) throw new Error('invalid result')
  return {
    source: 'GitHub', repository: { id: config.repository_id, fullName: config.repository_full_name, private: result.repository.private === true },
    metrics: { stars: count(result.metrics?.stars), forks: count(result.metrics?.forks), openIssues: count(result.metrics?.openIssues) },
    traffic: { views: metric(result.traffic?.views), clones: metric(result.traffic?.clones) },
  }
}

function safeWebsite(result) {
  if (result?.status !== 'available' || !Number.isInteger(result.performanceScore) || result.performanceScore < 0 || result.performanceScore > 100) throw new Error('unavailable')
  return { source: 'PageSpeed Insights', status: 'available', performanceScore: result.performanceScore }
}

export async function runCollectionJob(env, jobId, options = {}) {
  const db = env?.DB
  if (!db?.prepare || !db?.batch || typeof jobId !== 'string') return { status: 'unavailable' }
  const clock = options.clock ?? Date.now
  const upstreamRequest = options.request ?? fetch
  let networkUncertain = false
  const request = async (...args) => {
    try {
      const response = await upstreamRequest(...args)
      if (!response?.ok) networkUncertain = true
      return response
    } catch (error) {
      networkUncertain = true
      throw error
    }
  }
  const github = options.githubCollector ?? collectGitHubProject
  const website = options.websiteCollector ?? collectWebsitePerformance
  let claim
  let executionId
  let completed = false
  try {
    claim = await claimCollectionJob(db, jobId, clock())
    if (!claim) return { status: 'unavailable' }
    // Record before any WorkOS or collector request. A missing migration or a
    // concurrent suspension prevents all network work, rather than bypassing
    // the deletion fence. This record survives cancellation of the claim.
    executionId = await beginCollectionExecution(db, { organizationId: claim.organization_id, jobId: claim.id, claimId: claim.claimId, now: clock() })
    if (!executionId) return { status: 'unavailable' }
    const actor = { id: claim.actor_id, status: 'active', verified: 1 }
    const verify = () => resolveBoingContext(env, actor, claim.organization_id, request)
    const originalMapping = await db.prepare('SELECT workos_organization_id FROM boing_organizations WHERE id=?').bind(claim.organization_id).first()
    const context = await verify()
    if (context.status !== 'allowed') return { status: context.status }

    // Re-read the binding after WorkOS verification and enforce the claim's
    // source revision, active project, identity and grant in this query.
    const config = await db.prepare(`SELECT p.website_url, v.revision, o.workos_organization_id,
      r.installation_id, r.repository_id, r.repository_full_name
      FROM boing_collection_jobs j
      JOIN boing_projects p ON p.id=j.project_id AND p.organization_id=j.organization_id
      JOIN boing_organizations o ON o.id=p.organization_id
      JOIN boing_memberships m ON m.organization_id=o.id AND m.user_id=j.actor_id
      JOIN boing_identities u ON u.user_id=m.user_id
      JOIN boing_source_versions v ON v.project_id=p.id AND v.kind=j.kind AND v.revision=j.source_revision
      LEFT JOIN boing_github_repositories r ON r.organization_id=o.id AND r.project_id=p.id AND j.kind='github'
      LEFT JOIN boing_github_installations i ON i.organization_id=r.organization_id AND i.installation_id=r.installation_id
      WHERE j.id=? AND j.claim_id=? AND j.status='running' AND j.expires_at>? AND j.lease_expires_at>?
      AND p.status='active' AND o.status='active' AND m.status='active' AND u.status='active'
      AND (m.role='owner' OR EXISTS (SELECT 1 FROM boing_project_memberships pm WHERE pm.organization_id=o.id AND pm.project_id=p.id AND pm.user_id=m.user_id))
      AND ((j.kind='website' AND p.website_url IS NOT NULL AND p.website_url<>'') OR (j.kind='github' AND i.status='active'))`)
      .bind(claim.id, claim.claimId, clock(), clock()).first()
    if (!config || !originalMapping || originalMapping.workos_organization_id !== config.workos_organization_id) return { status: 'denied' }
    let output
    const budgetClaim = { ...claim, membershipId: context.membershipId, membershipUpdatedAt: context.membershipUpdatedAt, membershipRole: context.role }
    if (claim.kind === 'github') {
      if (!providerCallLimits(env, 'github')) return { status: 'unavailable' }
      if (typeof env.GITHUB_APP_PRIVATE_KEY !== 'string' || !env.GITHUB_APP_PRIVATE_KEY || !Number.isSafeInteger(Number(env.GITHUB_APP_ID))) return { status: 'unavailable' }
      const parts = String(config.repository_full_name).split('/')
      if (parts.length !== 2) return { status: 'unavailable' }
      const includeTraffic = env.BOING_GITHUB_TRAFFIC_ENABLED === 'true'
      const result = await github({ installationId: config.installation_id, repositoryId: config.repository_id, owner: parts[0], repository: parts[1], appId: Number(env.GITHUB_APP_ID), privateKey: env.GITHUB_APP_PRIVATE_KEY, includeTraffic }, budgetedProviderRequest(env, 'github', claim.organization_id, request, clock, budgetClaim))
      // Optional traffic failures are intentionally swallowed by the collector.
      // Keep the execution uncertain if either request could not be observed.
      if (includeTraffic && (result?.traffic?.views?.status !== 'available' || result?.traffic?.clones?.status !== 'available')) networkUncertain = true
      output = safeGitHub(result, config)
    } else if (claim.kind === 'website') {
      // Collection must be explicitly budget-enabled before provider calls.
      if (env.BOING_PAGESPEED_BUDGET_APPROVED !== 'true' || !env.PAGESPEED_API_KEY || !providerCallLimits(env, 'pagespeed')) return { status: 'unavailable' }
      output = safeWebsite(await website(config.website_url, env.PAGESPEED_API_KEY, budgetedProviderRequest(env, 'pagespeed', claim.organization_id, request, clock, budgetClaim)))
    } else return { status: 'unavailable' }

    // WorkOS can revoke access while a provider is running. Never publish if
    // verification fails or the organization's mapping changed in flight.
    const after = await verify()
    const mapping = await db.prepare('SELECT workos_organization_id FROM boing_organizations WHERE id=?').bind(claim.organization_id).first()
    if (after.status !== 'allowed' || after.organizationId !== context.organizationId || after.userId !== context.userId ||
        after.role !== context.role || after.membershipId !== context.membershipId || after.membershipUpdatedAt !== context.membershipUpdatedAt ||
        mapping?.workos_organization_id !== config.workos_organization_id) return { status: after.status === 'unavailable' ? 'unavailable' : 'denied' }
    const membershipBinding = env.BOING_MEMBERSHIP_BINDING_REQUIRED === 'true' ? { id: context.membershipId, updatedAt: context.membershipUpdatedAt, role: context.role } : null
    const published = await publishCollectionSnapshot(db, { organizationId: claim.organization_id, projectId: claim.project_id, jobId: claim.id, claimId: claim.claimId, snapshot: JSON.stringify(output), membershipBinding, now: clock() })
    completed = published && !networkUncertain
    return { status: published ? 'completed' : 'denied' }
  } catch {
    return { status: 'unavailable' }
  } finally {
    if (claim) {
      try { await finishCollectionJob(db, claim.id, claim.claimId, false, clock()) } catch {}
    }
    if (executionId) {
      // Failed or interrupted requests remain uncertain indefinitely. This
      // does not assert that a remote server has stopped processing them.
      await finishCollectionExecution(db, { id: executionId, organizationId: claim.organization_id, claimId: claim.claimId, observedComplete: completed, now: clock() })
    }
  }
}
