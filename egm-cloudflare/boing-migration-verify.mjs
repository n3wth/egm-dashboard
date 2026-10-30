import { identityAttestationFingerprint, importLegacyTransfer, transferFingerprint } from './boing-transfer.mjs'
import { readVerifiedWorkosEmail } from './workos-identity.mjs'
import { verifyWorkosMembership } from './boing-workos.mjs'

const validUserId = value => typeof value === 'string' && /^user_[A-Za-z0-9]{1,120}$/.test(value)
const validOrgId = value => typeof value === 'string' && /^org_[A-Za-z0-9]{1,120}$/.test(value)

// Trusted offline operator workflow only. This function reads both WorkOS
// environments but never mutates them or grants access. The caller must obtain
// the source payload from a consistent trusted source and independently pin
// its fingerprint. Never expose this function as an HTTP endpoint or accept
// client-controlled transports, credentials, mapping, clock or fingerprint.
// A successful result is point-in-time evidence, not a lock: membership or
// email may change after this function returns and before import/cutover.
export async function verifyMigrationIdentities({ payload, expectedSourceFingerprint, mappings, targetOrganizationId, sourceEnv, targetEnv, targetDb, request = fetch, clock = Date.now } = {}) {
  if (typeof sourceEnv?.WORKOS_API_KEY !== 'string' || !sourceEnv.WORKOS_API_KEY.trim() || typeof targetEnv?.WORKOS_API_KEY !== 'string' || !targetEnv.WORKOS_API_KEY.trim() || !targetDb?.prepare || typeof request !== 'function' || typeof clock !== 'function' ||
      !validOrgId(targetOrganizationId) || !/^[a-f0-9]{64}$/.test(expectedSourceFingerprint ?? '') ||
      !Array.isArray(mappings) || mappings.length < 1 || mappings.length > 100) throw new Error('identity verification unavailable')
  let sourceFingerprint
  try { sourceFingerprint = await transferFingerprint(payload) } catch { throw new Error('invalid migration mapping') }
  if (sourceFingerprint !== expectedSourceFingerprint || !Array.isArray(payload.users) || mappings.length !== payload.users.length) throw new Error('invalid migration mapping')
  const sourceById = new Map(payload.users.map(user => [user.id, user.email.toLowerCase()]))
  const sourceIds = new Set(), targetIds = new Set()
  for (const mapping of mappings) {
    if (!mapping || Object.keys(mapping).sort().join(',') !== 'sourceId,targetId' || !validUserId(mapping.sourceId) || !validUserId(mapping.targetId) ||
        !sourceById.has(mapping.sourceId) || sourceIds.has(mapping.sourceId) || targetIds.has(mapping.targetId)) throw new Error('invalid migration mapping')
    sourceIds.add(mapping.sourceId); targetIds.add(mapping.targetId)
  }
  const started = clock()
  if (!Number.isSafeInteger(started) || started < 0 || started > 8_640_000_000_000_000) throw new Error('identity verification unavailable')
  const checkTarget = async (targetId, address) => {
    const identity = await targetDb.prepare(`SELECT user_id FROM boing_identities WHERE user_id=? AND status='active' AND lower(email)=?
      AND NOT EXISTS (SELECT 1 FROM boing_identities other WHERE other.user_id<>? AND lower(other.email)=?)`)
      .bind(targetId, address, targetId, address).first()
    if (!identity) throw new Error('identity verification failed')
  }
  const verified = []
  // Bounded concurrency and fail closed on ambiguity or provider outages.
  for (let offset = 0; offset < mappings.length; offset += 4) {
    const batch = mappings.slice(offset, offset + 4)
    const results = await Promise.all(batch.map(async mapping => {
      await checkTarget(mapping.targetId, sourceById.get(mapping.sourceId))
      const [sourceEmail, targetEmail, membership] = await Promise.all([
        readVerifiedWorkosEmail(sourceEnv, mapping.sourceId, request),
        readVerifiedWorkosEmail(targetEnv, mapping.targetId, request),
        verifyWorkosMembership(targetEnv, { id: mapping.targetId, verified: 1, status: 'active' }, targetOrganizationId, request),
      ])
      if (!sourceEmail || sourceEmail !== sourceById.get(mapping.sourceId) || targetEmail !== sourceEmail || membership.status !== 'allowed') throw new Error('identity verification failed')
      await checkTarget(mapping.targetId, sourceEmail)
      // "active" describes locally approved source/target identity records;
      // WorkOS user objects do not expose a general active/suspended status.
      return { sourceId: mapping.sourceId, targetId: mapping.targetId, email: sourceEmail, sourceEmailVerified: true, sourceStatus: 'active', targetEmailVerified: true, targetStatus: 'active', targetMembershipStatus: 'active', ...(targetEnv.BOING_MEMBERSHIP_BINDING_REQUIRED === 'true' ? { targetMembershipId: membership.membershipId, targetMembershipUpdatedAt: membership.updatedAt } : {}) }
    }))
    verified.push(...results)
  }
  const finished = clock()
  // Set checkedAt to the earliest observation, not the completion time.
  // Refuse slow or backward-clock runs rather than extending evidence freshness.
  if (!Number.isSafeInteger(finished) || finished < started || finished - started > 15 * 60_000) throw new Error('identity verification unavailable')
  const attestation = { targetOrganizationId, checkedAt: new Date(started).toISOString(), ...(targetEnv.BOING_MEMBERSHIP_BINDING_REQUIRED === 'true' ? { membershipBindingRequired: true } : {}), mappings: verified }
  return { sourceFingerprint, identityAttestation: attestation, identityFingerprint: await identityAttestationFingerprint(attestation) }
}

// Trusted operator-only orchestration. Verify immediately before the D1 batch;
// no caller-supplied attestation or HTTP entrypoint may bypass the live checks.
// D1 and WorkOS cannot participate in one transaction: provider state can
// change after verification. The operator must still freeze relevant changes
// and recheck both environments and migration results before cutover.
export async function verifyAndImportLegacyTransfer({ targetDb, payload, expectedSourceFingerprint, mappings, targetOrganizationId, sourceEnv, targetEnv, organizationId, projectId, ownerId, repository, websiteUrl, request = fetch, clock = Date.now } = {}) {
  const proof = await verifyMigrationIdentities({ payload, expectedSourceFingerprint, mappings, targetOrganizationId, sourceEnv, targetEnv, targetDb, request, clock })
  if (targetEnv.BOING_MEMBERSHIP_BINDING_REQUIRED === 'true') {
    // Fail if the provider version changed while the attestation was assembled.
    // Provider state can still change after this check and before the D1 batch.
    const items = proof.identityAttestation.mappings
    for (let offset = 0; offset < items.length; offset += 4) {
      await Promise.all(items.slice(offset, offset + 4).map(async item => {
        const membership = await verifyWorkosMembership(targetEnv, { id: item.targetId, verified: 1, status: 'active' }, targetOrganizationId, request)
        if (membership.status !== 'allowed' || membership.membershipId !== item.targetMembershipId || membership.updatedAt !== item.targetMembershipUpdatedAt) throw new Error('identity verification failed')
      }))
    }
  }
  const now = clock()
  if (!Number.isSafeInteger(now) || now < 0 || now > 8_640_000_000_000_000) throw new Error('identity verification unavailable')
  return importLegacyTransfer(targetDb, payload, {
    expectedFingerprint: proof.sourceFingerprint,
    identityAttestation: proof.identityAttestation,
    expectedIdentityFingerprint: proof.identityFingerprint,
    organizationId, projectId, ownerId, workosOrganizationId: targetOrganizationId, repository, websiteUrl,
    now: new Date(now).toISOString(), membershipBindingRequired: targetEnv.BOING_MEMBERSHIP_BINDING_REQUIRED === 'true',
  })
}
