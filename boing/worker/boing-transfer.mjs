// Offline transfer primitives. Use a frozen or restored legacy database and a
// separate Boing database. A matching fingerprint does not freeze either one.
const MAX_USERS = 100
const MAX_BASELINES = 1000
const MAX_BODY_BYTES = 2_000_000
const encoder = new TextEncoder()

// Archive only: the new collectors do not yet read these values. Apply this
// additive schema before importing and preserve a restorable legacy backup.
export const BOING_LEGACY_BASELINE_SCHEMA = `CREATE TABLE IF NOT EXISTS boing_legacy_repo_baselines (
  project_id TEXT NOT NULL REFERENCES boing_projects(id),
  repo TEXT NOT NULL,
  stars INTEGER NOT NULL CHECK(stars >= 0),
  observed_at TEXT NOT NULL,
  PRIMARY KEY(project_id, repo)
)`

function validatePayload(payload) {
  if (!payload || payload.version !== 2 || !Array.isArray(payload.users) ||
      payload.users.length < 1 || payload.users.length > MAX_USERS || !Array.isArray(payload.baselines) ||
      payload.baselines.length > MAX_BASELINES) throw new Error('invalid transfer')
  const ids = new Set(), emails = new Set()
  for (const user of payload.users) {
    if (!user || typeof user.id !== 'string' || !/^user_[A-Za-z0-9]+$/.test(user.id) || user.id.length > 128 ||
        typeof user.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user.email) || user.email.length > 254 ||
        ids.has(user.id) || emails.has(user.email.toLowerCase())) throw new Error('invalid identity')
    ids.add(user.id); emails.add(user.email.toLowerCase())
  }
  const { snapshot, presentation } = payload
  if (!snapshot || typeof snapshot.body !== 'string' || encoder.encode(snapshot.body).length > MAX_BODY_BYTES ||
      typeof snapshot.generated_at !== 'string' || !snapshot.generated_at || snapshot.generated_at.length > 128 ||
      !presentation || typeof presentation.body !== 'string' || encoder.encode(presentation.body).length > MAX_BODY_BYTES ||
      !Number.isSafeInteger(presentation.revision) || presentation.revision < 0) throw new Error('invalid source data')
  try { JSON.parse(snapshot.body); JSON.parse(presentation.body) } catch { throw new Error('invalid source data') }
  const repos = new Set()
  for (const row of payload.baselines) {
    if (!row || typeof row.repo !== 'string' || !row.repo.trim() || row.repo.length > 512 || repos.has(row.repo) ||
        !Number.isSafeInteger(row.stars) || row.stars < 0 || typeof row.observed_at !== 'string' || !row.observed_at || row.observed_at.length > 128) throw new Error('invalid baseline')
    repos.add(row.repo)
  }
  return { version: 2, users: payload.users.map(({ id, email }) => ({ id, email })).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    snapshot: { body: snapshot.body, generated_at: snapshot.generated_at },
    presentation: { body: presentation.body, revision: presentation.revision },
    baselines: payload.baselines.map(({ repo, stars, observed_at }) => ({ repo, stars, observed_at })).sort((a, b) => a.repo < b.repo ? -1 : a.repo > b.repo ? 1 : 0) }
}

export async function transferFingerprint(payload) {
  const canonical = JSON.stringify(validatePayload(payload))
  const hash = await crypto.subtle.digest('SHA-256', encoder.encode(canonical))
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('')
}

// This is an operator attestation, not a WorkOS verification. A trusted
// operator must independently read both WorkOS environments and verify the
// exact user emails and target organization memberships before constructing
// it. Never accept this data or its digest through a client-facing route.
function validateIdentityAttestation(attestation) {
  if (!attestation || !/^org_[A-Za-z0-9]+$/.test(attestation.targetOrganizationId ?? '') ||
      typeof attestation.checkedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(attestation.checkedAt) ||
      !Number.isFinite(Date.parse(attestation.checkedAt)) || !Array.isArray(attestation.mappings) ||
      attestation.mappings.length < 1 || attestation.mappings.length > MAX_USERS) throw new Error('invalid identity attestation')
  if (attestation.membershipBindingRequired !== undefined && attestation.membershipBindingRequired !== true) throw new Error('invalid identity attestation')
  const bound = attestation.membershipBindingRequired === true
  const sources = new Set(), targets = new Set(), emails = new Set(), memberships = new Set()
  const mappings = attestation.mappings.map(item => {
    const address = typeof item?.email === 'string' ? item.email.toLowerCase() : ''
    if (!/^user_[A-Za-z0-9]+$/.test(item?.sourceId ?? '') || !/^user_[A-Za-z0-9]+$/.test(item?.targetId ?? '') ||
        item.sourceId.length > 128 || item.targetId.length > 128 || address.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address) ||
        item.sourceEmailVerified !== true || item.sourceStatus !== 'active' || item.targetEmailVerified !== true || item.targetStatus !== 'active' || item.targetMembershipStatus !== 'active' ||
        sources.has(item.sourceId) || targets.has(item.targetId) || emails.has(address)) throw new Error('invalid identity attestation')
    if (bound && (!/^om_[A-Za-z0-9]{1,120}$/.test(item.targetMembershipId ?? '') ||
        typeof item.targetMembershipUpdatedAt !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(item.targetMembershipUpdatedAt) ||
        !Number.isFinite(Date.parse(item.targetMembershipUpdatedAt)) || memberships.has(item.targetMembershipId))) throw new Error('invalid identity attestation')
    if (!bound && (Object.hasOwn(item, 'targetMembershipId') || Object.hasOwn(item, 'targetMembershipUpdatedAt'))) throw new Error('invalid identity attestation')
    sources.add(item.sourceId); targets.add(item.targetId); emails.add(address)
    if (bound) memberships.add(item.targetMembershipId)
    return { sourceId: item.sourceId, targetId: item.targetId, email: address, sourceEmailVerified: true, sourceStatus: 'active', targetEmailVerified: true, targetStatus: 'active', targetMembershipStatus: 'active', ...(bound ? { targetMembershipId: item.targetMembershipId, targetMembershipUpdatedAt: item.targetMembershipUpdatedAt } : {}) }
  }).sort((a, b) => a.sourceId < b.sourceId ? -1 : a.sourceId > b.sourceId ? 1 : 0)
  return { targetOrganizationId: attestation.targetOrganizationId, checkedAt: attestation.checkedAt, ...(bound ? { membershipBindingRequired: true } : {}), mappings }
}

export async function identityAttestationFingerprint(attestation) {
  const hash = await crypto.subtle.digest('SHA-256', encoder.encode(JSON.stringify(validateIdentityAttestation(attestation))))
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('')
}

// D1 batch is transactional. A bounded limit detects excess users rather than
// silently truncating them. Other legacy tables remain outside this transfer.
export async function exportLegacyTransfer(source) {
  if (!source?.prepare || !source?.batch) throw new Error('source unavailable')
  const [users, snapshots, presentations, baselines] = await source.batch([
    source.prepare("SELECT id,email FROM users WHERE verified=1 AND status='approved' ORDER BY id LIMIT 101"),
    source.prepare('SELECT body,generated_at FROM snapshots WHERE id=1'),
    source.prepare('SELECT body,revision FROM presentation WHERE id=1'),
    source.prepare('SELECT repo,stars,observed_at FROM repo_baselines ORDER BY repo LIMIT 1001'),
  ])
  const payload = validatePayload({ version: 2, users: users.results, snapshot: snapshots.results?.[0], presentation: presentations.results?.[0], baselines: baselines.results })
  return { payload, fingerprint: await transferFingerprint(payload) }
}

// expectedFingerprint must come from a fresh, operator-verified source read.
// Re-read and compare after import; freeze legacy writes before traffic switch.
export async function importLegacyTransfer(target, payload, { expectedFingerprint, identityAttestation, expectedIdentityFingerprint, organizationId, projectId, ownerId, workosOrganizationId, repository, websiteUrl, now, membershipBindingRequired = false } = {}) {
  if (!target?.prepare || !target?.batch) throw new Error('target unavailable')
  const data = validatePayload(payload)
  if (!/^[a-f0-9]{64}$/.test(expectedFingerprint ?? '') || await transferFingerprint(data) !== expectedFingerprint) throw new Error('source fingerprint mismatch')
  if (![organizationId, projectId, ownerId, workosOrganizationId, repository, websiteUrl, now].every(v => typeof v === 'string' && v.trim() && v.length <= 512) ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(organizationId) || !/^user_[A-Za-z0-9]+$/.test(ownerId) || !/^org_[A-Za-z0-9]+$/.test(workosOrganizationId) ||
      !data.users.some(user => user.id === ownerId)) throw new Error('invalid migration parameters')
  const attestation = validateIdentityAttestation(identityAttestation)
  if (typeof membershipBindingRequired !== 'boolean' || (membershipBindingRequired && attestation.membershipBindingRequired !== true)) throw new Error('invalid identity attestation')
  const at = Date.parse(now), checkedAt = Date.parse(attestation.checkedAt)
  if (!Number.isFinite(at) || checkedAt > at || at - checkedAt > 15 * 60_000 || attestation.targetOrganizationId !== workosOrganizationId ||
      !/^[a-f0-9]{64}$/.test(expectedIdentityFingerprint ?? '') || await identityAttestationFingerprint(attestation) !== expectedIdentityFingerprint ||
      attestation.mappings.length !== data.users.length || data.users.some(user => !attestation.mappings.some(item => item.sourceId === user.id && item.email === user.email.toLowerCase()))) throw new Error('invalid identity attestation')
  // Ensure the archive schema exists even if the source currently has no
  // baseline rows; otherwise a seemingly successful import is incomplete.
  await target.prepare('SELECT project_id,repo,stars,observed_at FROM boing_legacy_repo_baselines LIMIT 0').all()
  if (attestation.membershipBindingRequired) await target.prepare('SELECT organization_id,user_id,workos_membership_id,workos_updated_at FROM boing_workos_membership_bindings LIMIT 0').all()
  const statements = [
    target.prepare("INSERT INTO boing_organizations(id,name,workos_organization_id,status,ai_enabled,created_at) VALUES(?,'EGM',?,'active',0,?)").bind(organizationId, workosOrganizationId, now),
    target.prepare("INSERT INTO boing_projects(id,organization_id,name,repository,website_url,status,created_at) VALUES(?,?,'EGM',?,?,'active',?)").bind(projectId, organizationId, repository, websiteUrl, now),
  ]
  for (const item of attestation.mappings) {
    // Require an independently established active target identity. The NULL
    // role aborts the transaction if identity/email changed or was suspended.
    statements.push(target.prepare(`INSERT INTO boing_memberships(organization_id,user_id,role,status,created_at)
      VALUES(?,?,CASE WHEN EXISTS (SELECT 1 FROM boing_identities WHERE user_id=? AND status='active' AND lower(email)=?)
        AND NOT EXISTS (SELECT 1 FROM boing_identities WHERE user_id<>? AND lower(email)=?)
        THEN ? ELSE NULL END,'active',?)`).bind(organizationId, item.targetId, item.targetId, item.email, item.targetId, item.email, item.sourceId === ownerId ? 'owner' : 'member', now))
    statements.push(target.prepare('INSERT INTO boing_project_memberships(organization_id,project_id,user_id,created_at) VALUES(?,?,?,?)').bind(organizationId, projectId, item.targetId, now))
    if (attestation.membershipBindingRequired) statements.push(target.prepare('INSERT INTO boing_workos_membership_bindings(organization_id,user_id,workos_membership_id,workos_updated_at) VALUES(?,?,?,?)').bind(organizationId, item.targetId, item.targetMembershipId, item.targetMembershipUpdatedAt))
  }
  statements.push(target.prepare('INSERT INTO boing_snapshots(project_id,body,generated_at) VALUES(?,?,?)').bind(projectId, data.snapshot.body, data.snapshot.generated_at))
  statements.push(target.prepare('INSERT INTO boing_presentations(project_id,body,revision) VALUES(?,?,?)').bind(projectId, data.presentation.body, data.presentation.revision))
  for (const baseline of data.baselines) statements.push(target.prepare('INSERT INTO boing_legacy_repo_baselines(project_id,repo,stars,observed_at) VALUES(?,?,?,?)').bind(projectId, baseline.repo, baseline.stars, baseline.observed_at))
  statements.push(target.prepare("INSERT INTO boing_migrations(id,completed_at) VALUES('legacy-egm-v1',?)").bind(now))
  await target.batch(statements)
  return { status: 'imported', fingerprint: expectedFingerprint }
}
