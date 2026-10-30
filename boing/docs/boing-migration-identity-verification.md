# Migration identity verification

`verifyMigrationIdentities` in `boing/worker/boing-migration-verify.mjs` is a
trusted operator-side helper. It is not an HTTP endpoint. Before calling it,
obtain a consistent approved-user transfer payload from the legacy database,
independently record its fingerprint, and prepare an explicit one-to-one
source-to-target user ID mapping. Both WorkOS environments and the target
organization must be selected and independently confirmed by the operator.
The target Boing database must already contain active identities for the
mapped target users.

The `verifyAndImportLegacyTransfer` operator helper runs the verifier immediately
before the offline import. It accepts no prebuilt attestation and performs no
provider writes. Use the same isolated target database for verification and
import. Failed verification leaves that database unchanged.

When the target environment requires membership-version bindings, the
verifier captures each active WorkOS membership ID and update timestamp in
the fingerprinted attestation. It rechecks each version before importing, and
the destination D1 transaction inserts the bindings with the local grants.
Apply the membership-binding schema to the separate target database first.
Use the trusted orchestrator, not a client-supplied attestation or an offline
import with the requirement omitted. A changed or unverifiable membership
aborts the import; an operator must reverify and explicitly approve the grant.

On 2026-10-28, one disposable membership in the Boing WorkOS staging
environment retained its ID and received a new `updatedAt` value after both
deactivation and reactivation. This is an observed test, not a provider
guarantee or proof against missed events, races, or timestamp collisions.
The version-binding gate remains disabled until all grant paths and lifecycle
reconciliation have been validated. WorkOS and D1 cannot share a transaction,
so provider state can change after the final check and before import. Recheck
membership versions after import and before routing traffic.

The verifier checks the source and target WorkOS users' verified email
addresses, the target user's active WorkOS organization membership, and the
active target Boing identity and matching email. It returns the attestation and
fingerprint expected by `importLegacyTransfer`. It does not create users,
memberships, invitations or sessions. Keep credentials, the mapping, the
payload and returned attestation out of logs and committed files.

The helper uses the source payload as evidence of local approval; the WorkOS
user endpoint does not establish the user's local approval or a general
active/suspended state. The returned attestation is point-in-time evidence,
not a lock. Recheck source approval, target identity and provider membership
immediately before import and cutover, freeze relevant writes, and validate
the migrated workspace and rollback. Revoke or abandon the migration if any
state changes. A transfer payload is not a full database backup; a separate
recoverable backup and verified restore are still required. No live migration
or backup is performed by this helper.
