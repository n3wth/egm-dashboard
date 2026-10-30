import { enqueueCollectionJob } from './boing-jobs.mjs'
import { runCollectionJob } from './boing-runner.mjs'
import { resolveBoingContext } from './boing-context.mjs'
import { collectionReadiness } from './boing-collection-config.mjs'

// Trusted scheduled entrypoint only. Do not route this from HTTP. Configuration
// and source bindings are read from the server; a client cannot select jobs.
export const COLLECTION_BATCH_SIZE = 10
export const COLLECTION_INTERVAL_MS = 60 * 60 * 1000
const SCAN_SIZE = 20
const OWNER_CHECK_LIMIT = 20
const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value)

// Run at most ten jobs per tick, sequentially to bound provider concurrency.
// A queued job is recovered after an interrupted tick; claiming is atomic in
// runCollectionJob. Due-source admission is atomic and rate-limited per source
// by enqueueCollectionJob, including across overlapping scheduled events.
export async function runCollectionTick(env, { now = Date.now(), request = fetch, runJob = runCollectionJob, resolveContext = resolveBoingContext } = {}) {
  if (env?.BOING_COLLECTION_ENABLED !== 'true') return { status: 'disabled', processed: 0 }
  if (!env?.DB?.prepare || !Number.isSafeInteger(now) || now < COLLECTION_INTERVAL_MS || now > 8_640_000_000_000_000 - 900_000) return { status: 'unavailable', processed: 0 }
  const configured = await collectionReadiness(env)
  const kinds = { github: configured.github ? 1 : 0, website: configured.website ? 1 : 0 }
  if (!kinds.github && !kinds.website) return { status: 'disabled', processed: 0 }
  let processed = 0, checkedOwners = 0
  try {
    const pending = await env.DB.prepare(`SELECT j.id FROM boing_collection_jobs j
      JOIN boing_projects p ON p.id=j.project_id AND p.organization_id=j.organization_id
      JOIN boing_organizations o ON o.id=p.organization_id
      JOIN boing_memberships m ON m.organization_id=o.id AND m.user_id=j.actor_id
      JOIN boing_identities u ON u.user_id=m.user_id
      JOIN boing_source_versions v ON v.project_id=p.id AND v.kind=j.kind AND v.revision=j.source_revision
      WHERE j.status='queued' AND j.expires_at>? AND p.status='active' AND o.status='active'
        AND m.status='active' AND u.status='active'
        AND (m.role='owner' OR EXISTS (SELECT 1 FROM boing_project_memberships pm
          WHERE pm.organization_id=o.id AND pm.project_id=p.id AND pm.user_id=m.user_id))
        AND ((j.kind='website' AND ?=1 AND p.website_url IS NOT NULL AND p.website_url<>'')
          OR (j.kind='github' AND ?=1 AND EXISTS (SELECT 1 FROM boing_github_repositories r
            JOIN boing_github_installations i ON i.organization_id=r.organization_id AND i.installation_id=r.installation_id
            WHERE r.project_id=p.id AND r.organization_id=o.id AND i.status='active')))
      ORDER BY j.created_at,j.id LIMIT ?`).bind(now, kinds.website, kinds.github, COLLECTION_BATCH_SIZE).all()
    if (!Array.isArray(pending?.results)) throw new Error('invalid queue')
    for (const row of pending.results) {
      if (!validId(row.id)) continue
      await runJob(env, row.id, { request })
      processed++
    }
    if (processed >= COLLECTION_BATCH_SIZE) return { status: 'ok', processed }
    const cutoff = new Date(now - COLLECTION_INTERVAL_MS).toISOString()
    const candidates = await env.DB.prepare(`WITH candidates AS (SELECT p.id AS project_id,p.organization_id,v.kind,
      (SELECT MAX(j.created_at) FROM boing_collection_jobs j WHERE j.project_id=p.id AND j.kind=v.kind) AS last_attempt
      FROM boing_projects p JOIN boing_organizations o ON o.id=p.organization_id
      JOIN boing_source_versions v ON v.project_id=p.id
      WHERE p.status='active' AND o.status='active'
      AND EXISTS (SELECT 1 FROM boing_memberships m JOIN boing_identities u ON u.user_id=m.user_id
        WHERE m.organization_id=o.id AND m.role='owner' AND m.status='active' AND u.status='active')
      AND ((v.kind='website' AND ?=1 AND p.website_url IS NOT NULL AND p.website_url<>'')
        OR (v.kind='github' AND ?=1 AND EXISTS (SELECT 1 FROM boing_github_repositories r
          JOIN boing_github_installations i ON i.organization_id=r.organization_id AND i.installation_id=r.installation_id
          WHERE r.project_id=p.id AND r.organization_id=p.organization_id AND i.status='active')))
      AND NOT EXISTS (SELECT 1 FROM boing_collection_jobs j WHERE j.project_id=p.id AND j.kind=v.kind AND j.created_at>?)),
      ranked AS (SELECT *,row_number() OVER (ORDER BY last_attempt ASC,project_id,kind)-1 AS position,
        count(*) OVER () AS total FROM candidates)
      SELECT project_id,organization_id,kind FROM ranked
      ORDER BY ((position - (? % total) + total) % total) LIMIT ?`)
      .bind(kinds.website, kinds.github, cutoff, Math.floor(now / 600_000), SCAN_SIZE).all()
    if (!Array.isArray(candidates?.results)) throw new Error('invalid candidates')
    for (const row of candidates.results) {
      if (processed >= COLLECTION_BATCH_SIZE || checkedOwners >= OWNER_CHECK_LIMIT) break
      if (!validId(row.organization_id) || !validId(row.project_id) || !['github', 'website'].includes(row.kind)) continue
      const owners = await env.DB.prepare(`WITH ranked AS (SELECT m.user_id,
        row_number() OVER (ORDER BY m.user_id)-1 AS position,count(*) OVER () AS total
        FROM boing_memberships m JOIN boing_identities u ON u.user_id=m.user_id
        WHERE m.organization_id=? AND m.role='owner' AND m.status='active' AND u.status='active')
        SELECT user_id FROM ranked ORDER BY ((position - (? % total) + total) % total) LIMIT 5`)
        .bind(row.organization_id, Math.floor(now / 600_000)).all()
      if (!Array.isArray(owners?.results)) throw new Error('invalid owners')
      let actor = null, membershipBinding = null
      for (const owner of owners.results) {
        if (checkedOwners >= OWNER_CHECK_LIMIT) break
        if (!/^user_[A-Za-z0-9]+$/.test(owner.user_id ?? '')) continue
        checkedOwners++
        const candidate = { id: owner.user_id, verified: 1, status: 'active' }
        const context = await resolveContext(env, candidate, row.organization_id, request)
        if (context?.status === 'allowed' && context.role === 'owner' && context.organizationId === row.organization_id) {
          if (env.BOING_MEMBERSHIP_BINDING_REQUIRED === 'true' && (!/^om_[A-Za-z0-9]+$/.test(context.membershipId ?? '') || !context.membershipUpdatedAt)) continue
          actor = candidate
          membershipBinding = env.BOING_MEMBERSHIP_BINDING_REQUIRED === 'true' ? { id: context.membershipId, updatedAt: context.membershipUpdatedAt } : null
          break
        }
      }
      if (!actor) continue
      const id = await enqueueCollectionJob(env.DB, actor, row.organization_id, row.project_id, row.kind, now, { minimumIntervalMs: COLLECTION_INTERVAL_MS, membershipBinding })
      if (!id) continue
      await runJob(env, id, { request })
      processed++
    }
    return { status: 'ok', processed }
  } catch {
    return { status: 'unavailable', processed }
  }
}
