// Staging primitives only. The caller must authenticate the actor and freshly
// verify WorkOS membership for organizationId before enqueueing. Workers must
// resolve all provider credentials and project configuration at execution time.
// No caller-provided payload, credential, provider response or error is stored.
export const JOBS_SCHEMA = `CREATE TABLE IF NOT EXISTS boing_source_versions (
  project_id TEXT NOT NULL REFERENCES boing_projects(id),
  kind TEXT NOT NULL CHECK (kind IN ('github', 'website')),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  PRIMARY KEY (project_id, kind)
);
CREATE TABLE IF NOT EXISTS boing_collection_jobs (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('github', 'website')),
  source_revision INTEGER NOT NULL CHECK (source_revision >= 1),
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
  claim_id TEXT,
  created_at TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  lease_expires_at INTEGER,
  finished_at TEXT,
  FOREIGN KEY (organization_id, project_id) REFERENCES boing_projects(organization_id, id),
  FOREIGN KEY (organization_id, actor_id) REFERENCES boing_memberships(organization_id, user_id)
);
CREATE INDEX IF NOT EXISTS boing_jobs_queue ON boing_collection_jobs(status, created_at, id);
CREATE TABLE IF NOT EXISTS boing_collection_results (
  project_id TEXT NOT NULL REFERENCES boing_projects(id),
  kind TEXT NOT NULL CHECK (kind IN ('github', 'website')),
  source_revision INTEGER NOT NULL CHECK (source_revision >= 1),
  body TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  PRIMARY KEY (project_id, kind)
);
CREATE TABLE IF NOT EXISTS boing_metric_history (
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('github', 'website')),
  source_revision INTEGER NOT NULL CHECK (source_revision >= 1),
  day TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  metrics TEXT NOT NULL,
  PRIMARY KEY (project_id, kind, source_revision, day),
  FOREIGN KEY (organization_id, project_id) REFERENCES boing_projects(organization_id, id)
);`

const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value)
const validActor = actor => actor && validId(actor.id) && actor.verified === 1
const kinds = new Set(['github', 'website'])
const QUEUE_TTL_MS = 15 * 60_000
const LEASE_MS = 5 * 60_000
const validNow = now => Number.isSafeInteger(now) && now >= 0 && now <= 8_640_000_000_000_000 - QUEUE_TTL_MS
export const COLLECTION_WINDOW_MS = 3_600_000
// Applied inside each INSERT so concurrent admission paths share one limit.
export const collectionAdmissionLimit = `AND (SELECT count(*) FROM boing_collection_jobs j WHERE j.created_at>?) < 10
  AND (SELECT count(*) FROM boing_collection_jobs j WHERE j.organization_id=o.id AND j.created_at>?) < 5`
export const collectionWindowCutoff = now => new Date(Math.max(0, now - COLLECTION_WINDOW_MS)).toISOString()

// Re-evaluate the requesting user's local access at every state transition.
const authorized = `EXISTS (SELECT 1 FROM boing_projects p
  JOIN boing_organizations o ON o.id=p.organization_id
  JOIN boing_memberships m ON m.organization_id=o.id
  JOIN boing_identities u ON u.user_id=m.user_id
  WHERE p.id=boing_collection_jobs.project_id
    AND p.organization_id=boing_collection_jobs.organization_id
    AND p.status='active' AND o.status='active' AND m.user_id=boing_collection_jobs.actor_id
    AND m.status='active' AND u.status='active'
    AND (m.role='owner' OR EXISTS (SELECT 1 FROM boing_project_memberships pm
      WHERE pm.organization_id=o.id AND pm.project_id=p.id AND pm.user_id=m.user_id)))`

// Every source edit, GitHub rebind, and installation status transition must
// advance the corresponding revision in the same transaction as the change.
// A missing revision is unavailable rather than implicitly current.
const currentSource = `EXISTS (SELECT 1 FROM boing_source_versions v
  JOIN boing_projects p ON p.id=v.project_id
  WHERE v.project_id=boing_collection_jobs.project_id AND v.kind=boing_collection_jobs.kind
    AND v.revision=boing_collection_jobs.source_revision
    AND ((v.kind='website' AND p.website_url IS NOT NULL AND p.website_url<>'') OR
      (v.kind='github' AND EXISTS (SELECT 1 FROM boing_github_repositories r
        JOIN boing_github_installations i ON i.organization_id=r.organization_id AND i.installation_id=r.installation_id
        WHERE r.project_id=p.id AND r.organization_id=p.organization_id AND i.status='active'))))`

// One queued/running job of each kind per project bounds concurrent work.
export async function enqueueCollectionJob(db, actor, organizationId, projectId, kind, now = Date.now(), { minimumIntervalMs = 0, membershipBinding = null } = {}) {
  if (!db?.prepare || !validActor(actor) || !validId(organizationId) || !validId(projectId) || !kinds.has(kind) || !validNow(now) || !Number.isSafeInteger(minimumIntervalMs) || minimumIntervalMs < 0 || minimumIntervalMs > 7 * 24 * 3_600_000) return null
  if (membershipBinding !== null && (!/^om_[A-Za-z0-9]+$/.test(membershipBinding?.id ?? '') || typeof membershipBinding.updatedAt !== 'string' || !membershipBinding.updatedAt)) return null
  // Clear invalid or expired work for this project before the admission check.
  // Every transition rechecks its state in SQL; an expired claim cannot finish.
  await db.prepare(`UPDATE boing_collection_jobs SET status='cancelled', finished_at=?
    WHERE organization_id=? AND project_id=? AND status IN ('queued','running')
      AND (expires_at<=? OR (status='running' AND lease_expires_at<=?) OR NOT ${authorized} OR NOT ${currentSource})`)
    .bind(new Date(now).toISOString(), organizationId, projectId, now, now).run()
  const id = crypto.randomUUID()
  const result = await db.prepare(`INSERT INTO boing_collection_jobs (id, organization_id, project_id, actor_id, kind, source_revision, status, created_at, expires_at)
    SELECT ?, o.id, p.id, m.user_id, v.kind, v.revision, 'queued', ?, ? FROM boing_projects p
    JOIN boing_organizations o ON o.id=p.organization_id
    JOIN boing_memberships m ON m.organization_id=o.id JOIN boing_identities u ON u.user_id=m.user_id
    JOIN boing_source_versions v ON v.project_id=p.id AND v.kind=?
    WHERE o.id=? AND p.id=? AND o.status='active' AND p.status='active'
      AND m.user_id=? AND m.status='active' AND u.status='active'
      AND (m.role='owner' OR EXISTS (SELECT 1 FROM boing_project_memberships pm
        WHERE pm.organization_id=o.id AND pm.project_id=p.id AND pm.user_id=m.user_id))
      AND ((v.kind='website' AND p.website_url IS NOT NULL AND p.website_url<>'') OR
        (v.kind='github' AND EXISTS (SELECT 1 FROM boing_github_repositories r
          JOIN boing_github_installations i ON i.organization_id=r.organization_id AND i.installation_id=r.installation_id
          WHERE r.project_id=p.id AND r.organization_id=o.id AND i.status='active')))
      AND NOT EXISTS (SELECT 1 FROM boing_collection_jobs j WHERE j.project_id=p.id
        AND j.kind=? AND j.status IN ('queued','running'))
      AND (?=0 OR NOT EXISTS (SELECT 1 FROM boing_collection_jobs recent WHERE recent.project_id=p.id
        AND recent.kind=v.kind AND recent.created_at>?))
      ${membershipBinding ? `AND m.role='owner' AND EXISTS (SELECT 1 FROM boing_workos_membership_bindings b WHERE b.organization_id=o.id AND b.user_id=m.user_id AND b.workos_membership_id=? AND b.workos_updated_at=?)` : ''}
      ${collectionAdmissionLimit}`)
    .bind(id, new Date(now).toISOString(), now + QUEUE_TTL_MS, kind, organizationId, projectId, actor.id, kind, minimumIntervalMs, new Date(Math.max(0, now - minimumIntervalMs)).toISOString(), ...(membershipBinding ? [membershipBinding.id, membershipBinding.updatedAt] : []), collectionWindowCutoff(now), collectionWindowCutoff(now)).run()
  return result.meta?.changes === 1 ? id : null
}

// A specific ID and fresh random claim token ensure a single atomic claim.
// A trusted scheduler chooses the ID; users cannot invoke this directly.
export async function claimCollectionJob(db, jobId, now = Date.now()) {
  if (!db?.prepare || !validId(jobId) || !validNow(now)) return null
  const claimId = crypto.randomUUID()
  const row = await db.prepare(`UPDATE boing_collection_jobs SET status='running', claim_id=?, lease_expires_at=?
    WHERE id=? AND status='queued' AND expires_at>? AND ${authorized} AND ${currentSource}
    RETURNING id, organization_id, project_id, actor_id, kind, source_revision`)
    .bind(claimId, now + LEASE_MS, jobId, now).first()
  return row ? { ...row, claimId } : null
}

// Completion doesn't publish a snapshot. Publishing must independently check
// the same authorization in its own atomic transaction. Revoked jobs fail shut.
export async function finishCollectionJob(db, jobId, claimId, succeeded, now = Date.now()) {
  if (!db?.prepare || !validId(jobId) || !validId(claimId) || typeof succeeded !== 'boolean' || !validNow(now)) return false
  const result = await db.prepare(`UPDATE boing_collection_jobs SET status=?, finished_at=?
    WHERE id=? AND claim_id=? AND status='running' AND expires_at>? AND lease_expires_at>? AND ${authorized} AND ${currentSource}`)
    .bind(succeeded ? 'completed' : 'failed', new Date(now).toISOString(), jobId, claimId, now, now).run()
  return result.meta?.changes === 1
}

// The caller must fetch provider data only after a fresh WorkOS membership
// check. This transaction gates publication on the current local grant and
// lease and consumes that lease once. A completed job cannot be published a
// second time, even if a caller retries with the original claim token.
// Source content must be assembled by the trusted collector and must not
// contain provider credentials. Source results are stored separately from the
// legacy project snapshot and other source results. Readers must explicitly
// incorporate these results; this primitive does not overwrite or merge the
// existing snapshot, whose schema may be provider-specific or legacy EGM.
export async function publishCollectionSnapshot(db, { organizationId, projectId, jobId, claimId, snapshot, membershipBinding = null, now = Date.now() } = {}) {
  if (!db?.prepare || !db?.batch || !validId(organizationId) || !validId(projectId) || !validId(jobId) || !validId(claimId) || !validNow(now) || typeof snapshot !== 'string') return false
  if (new TextEncoder().encode(snapshot).byteLength > 262_144) return false
  if (membershipBinding !== null && (!/^om_[A-Za-z0-9]+$/.test(membershipBinding?.id ?? '') || typeof membershipBinding.updatedAt !== 'string' || !['owner', 'admin', 'member'].includes(membershipBinding.role))) return false
  const bindingSql = membershipBinding ? ` AND EXISTS (SELECT 1 FROM boing_workos_membership_bindings b JOIN boing_memberships m
    ON m.organization_id=b.organization_id AND m.user_id=b.user_id WHERE b.organization_id=boing_collection_jobs.organization_id
    AND b.user_id=boing_collection_jobs.actor_id AND b.workos_membership_id=? AND b.workos_updated_at=? AND m.role=?)` : ''
  let data
  try {
    data = JSON.parse(snapshot)
    // An unavailable collection is a failed job, never a replacement for the
    // last successful source. Caller should finish it with succeeded=false.
    if (!data || typeof data !== 'object' || Array.isArray(data) || data.status === 'unavailable') return false
  } catch { return false }

  const publicationId = crypto.randomUUID()
  const at = new Date(now).toISOString()
  const day = at.slice(0, 10)
  const cutoff = new Date(Math.max(0, now - 89 * 86_400_000)).toISOString().slice(0, 10)
  const number = value => Number.isSafeInteger(value) && value >= 0 ? value : null
  // Only a fixed allowlist of numeric aggregates is retained, never provider
  // names, repository details, arbitrary strings, or raw response bodies.
  const github = JSON.stringify({ stars: number(data.metrics?.stars), forks: number(data.metrics?.forks), openIssues: number(data.metrics?.openIssues), views: number(data.traffic?.views?.count), clones: number(data.traffic?.clones?.count) })
  const website = JSON.stringify({ performanceScore: Number.isInteger(data.performanceScore) && data.performanceScore >= 0 && data.performanceScore <= 100 ? data.performanceScore : null })
  const results = await db.batch([
    db.prepare(`UPDATE boing_collection_jobs SET status='completed', claim_id=?, finished_at=?
      WHERE id=? AND organization_id=? AND project_id=? AND claim_id=? AND status='running'
        AND expires_at>? AND lease_expires_at>? AND ${authorized} AND ${currentSource}${bindingSql}`)
      .bind(...[publicationId, at, jobId, organizationId, projectId, claimId, now, now, ...(membershipBinding ? [membershipBinding.id, membershipBinding.updatedAt, membershipBinding.role] : [])]),
    db.prepare(`INSERT INTO boing_collection_results(project_id,kind,source_revision,body,generated_at)
      SELECT project_id,kind,source_revision,?,? FROM boing_collection_jobs
      WHERE id=? AND organization_id=? AND project_id=? AND status='completed' AND claim_id=?
      ON CONFLICT(project_id,kind) DO UPDATE SET source_revision=excluded.source_revision,body=excluded.body,generated_at=excluded.generated_at`)
      .bind(snapshot, at, jobId, organizationId, projectId, publicationId),
    db.prepare(`INSERT INTO boing_metric_history(organization_id,project_id,kind,source_revision,day,generated_at,metrics)
      SELECT organization_id,project_id,kind,source_revision,?,?,CASE kind WHEN 'github' THEN ? ELSE ? END
      FROM boing_collection_jobs WHERE id=? AND organization_id=? AND project_id=? AND status='completed' AND claim_id=?
      ON CONFLICT(project_id,kind,source_revision,day) DO UPDATE SET generated_at=excluded.generated_at,metrics=excluded.metrics`)
      .bind(day, at, github, website, jobId, organizationId, projectId, publicationId),
    db.prepare(`DELETE FROM boing_metric_history WHERE organization_id=? AND project_id=? AND kind=(SELECT kind FROM boing_collection_jobs WHERE id=? AND status='completed' AND claim_id=?)
      AND (day<? OR source_revision<>(SELECT source_revision FROM boing_collection_jobs WHERE id=? AND claim_id=?))`)
      .bind(organizationId, projectId, jobId, publicationId, cutoff, jobId, publicationId),
  ])
  return results[0]?.meta?.changes === 1 && results[1]?.meta?.changes === 1 && results[2]?.meta?.changes === 1
}
