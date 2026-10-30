# Boing beta rollout gates

Boing is not ready for external onboarding until the implementation, legal
details, and deployment checks below have all been completed. This document is
an operational checklist, not evidence that any step has already happened.

## Staging

- Use a separate Worker, D1 database, WorkOS application, and GitHub App from
  EGM production. Configure secrets through the platform, never in Git.
- Verify two organizations, multiple projects, membership revocation, and
  private-repository installations with accounts belonging to both tenants.
- Verify every source, exported file, background job, and AI response is scoped
  to the authorized organization and project. Test unavailable integrations,
  provider outages, and deletion of a project with queued work.
- Keep AI disabled until an owner enables it after reviewing processor and data
  disclosures. Do not enable paid collection without an approved budget.

## EGM migration

- Record the deployed Worker version, D1 schema, configuration, and current
  domain routing. Export a recoverable D1 backup and test restoration to a
  separate database before migration.
- WorkOS environments have separate identities. Map each approved legacy user
  one-to-one to a verified target-environment user and verify current target
  organization membership and owner continuity before granting access. A
  matching email or an offline attestation alone does not verify membership.
- The legacy transfer payload is not a complete backup: it omits operational,
  approval, audit, session and synchronization tables. Decide retention and
  migration for each relevant table separately. D1 Time Travel restores the
  original database rather than cloning it; D1 export may affect availability.
  Schedule and verify a separate backup before any production migration.
- Migrate a copy first. Compare access, snapshots, presentation state, sources,
  and timestamps with the existing EGM dashboard; do not treat an empty result
  as a successful migration.
- Run the protected-runtime verifier and existing tests. Switch traffic only
  after staging and identity checks pass. Keep the original Worker and database
  intact until rollback is verified and the migration is accepted.
- Rollback means routing the previous hostname back to the recorded Worker
  version and restoring the verified backup if its database changed. Reconcile
  any writes accepted after cutover before repeating migration.

## Public beta gate

- Confirm the operating legal entity, contact details, jurisdiction, actual
  processors, retention, deletion, and applicable legal requirements. Have the
  draft terms and privacy notice reviewed and replace every placeholder before
  onboarding an outside organization.
- Verify the Boing sender domain and email delivery for test accounts. Sending
  invitations to external people requires explicit authorization.
- Establish named responders, an incident and access-revocation procedure,
  bounded retention and quotas, and backup restoration evidence. Confirm the
  configured GitHub App requests only the permissions needed for selected repos.
- Verify DNS, TLS, login, invitations, export, deletion, and tenant separation
  on the actual staging and production deployments. A completed local build
  does not establish production readiness.
