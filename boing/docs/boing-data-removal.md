# Boing data removal runbook (draft)

This is an operator workflow, not an automated deletion feature. Do not promise
deletion completion until the steps below are implemented and verified for the
actual deployment, processors, retention policy and backups. The public beta
remains gated on legal review and a tested deletion procedure.

## Before changing data

1. Authenticate the requester through an independent channel and verify that
   they own the workspace. Identify the exact organization and project IDs from
   server records, not from an unauthenticated request. Record the scope and
   request time in the operator's incident or request system, without copying
   invitation tokens, credentials or project content.
2. Explain the effect and confirm the requested scope with the requester. Offer
   project exports before removal. The current project export includes project
   settings, the visible legacy snapshot, presentation and current source
   results and current-source metric history; it is not a complete workspace
   export or an audit archive.
3. Record the Worker version and take a recoverable backup. Verify restoration
   on a separate database. Identify all copies and their expiry schedules,
   including D1 backups, logs, processor records, provider-side integrations and
   any migration artifacts. Do not delete shared users, integrations, audit
   records, or backups solely because they also reference the target.

## Restrict and remove

1. Suspend the target organization or archive the target project using a
   reviewed, tenant-scoped operation. Verify reads and writes fail for ordinary
   members and that jobs cannot be claimed or publish data after this point.
   Stop and investigate if any in-flight operation remains capable of writing.
2. Revoke pending invitations and project grants, disconnect the target
   project's GitHub binding and revoke the provider installation only when it
   is not shared by another workspace. Cancel queued and running collection
   work; verify no new work can be admitted. The operator must separately
   verify WorkOS membership and GitHub permissions at the providers.
3. Use a reviewed, transactional, organization-scoped deletion procedure to
   remove the project or workspace records in foreign-key order. Check the
   deployed schema first: project snapshots, presentations, collection results,
   jobs, source versions, metric history, GitHub bindings, grants, audit events and legacy
   baselines can refer to the project. Workspace-level rows include membership,
   invitations and their provider bindings, AI consent, quota usage and hostname
   mapping. Preserve only records required by the confirmed retention policy.
   Shared identities and sessions must not be removed without separately
   checking all remaining workspaces.
4. Remove or schedule expiry of data at configured processors and other copies
   according to their actual capabilities and the reviewed retention policy.
   A D1 deletion does not erase provider records or historical backups.

## Verify and communicate

Re-query each affected store using the verified scope, test a previously
authorized account, and check that queued or in-flight work cannot recreate
the records. Document what was deleted, what remains, why it remains, and when
backups or processor copies are due to expire. Have a second operator review
the evidence before reporting completion. If verification fails, leave the
workspace or project restricted and record the outstanding work.

The codebase currently lacks a complete transactional removal operation and a
tested provider-and-backup deletion procedure. This document does not authorize
or perform deletion, and is not evidence that the launch gate has passed.
