# Live staging isolation rehearsal (draft)

This is a procedure for a dedicated, disposable staging fixture. It is not
evidence that live isolation has passed. Do not use EGM production data or
external beta accounts. Do not send invitations or email.

1. Confirm the Boing staging Worker, D1 database, WorkOS project and client ID
   together before any writes. Record their identifiers and the Worker version.
   Use two newly created test organizations and two unique synthetic identities
   on `example.com`; WorkOS documents that staging messages to reserved example
   domains are not delivered. Give each identity access only to its own test
   organization. Create at least one distinct project in each workspace.
2. Use an ephemeral, randomly generated password for each identity. WorkOS's
   user API supports `email_verified: true` for test fixtures. Keep passwords,
   API keys, tokens, cookies and provider responses out of command arguments,
   logs, committed files and test reports. The WorkOS connector's `createUser`
   operation does not expose `email_verified`; an independently reviewed API
   client is needed for that field. Do not change existing users or settings.
3. Sign each identity in through Boing's actual AuthKit authorization-code and
   PKCE callback in a separate browser context. This is the supported entry
   path to `createBoingSession`; a password-issued token passed directly to the
   helper is a different flow and does not validate the browser callback. Verify
   WorkOS session and verified email, then provision local test organizations,
   memberships and current WorkOS membership-version bindings through the
   staging operator workflow. Verify exact IDs and ownership before proceeding.
   The existing platform provisioning route requires a separately authorized
   platform admin and an active local owner identity; do not grant admin to a
   synthetic user or bypass its checks.
4. From each actual session, verify its own workspace and project are readable.
   Request the other workspace selector and the other project's ID through
   snapshot, source, history, project export, workspace export and collection
   status endpoints. Assert denial and no other tenant's data. Attempt a
   cross-tenant write against disposable projects and verify neither project
   changed. Also verify denial after revoking one test membership, including an
   in-flight read where the test harness can control timing.
5. Record status codes, test IDs, assertions and time, but no tokens or data
   content. Revoke test sessions and remove only resources created for this
   rehearsal, checking identifiers before each operation. Keep provider and
   local cleanup records until their completion is verified. Never remove shared
   users, existing workspaces or production data. Follow provider confirmation
   requirements for irreversible deletion.

An independent harness must support secure credential input and isolated browser
contexts before this procedure can be executed. WorkOS Radar, MFA or email
verification may interrupt the flow; stop rather than weakening those controls.
The local mocked Worker tests and synthetic D1 restore do not substitute for this
live provider test. WorkOS and D1 do not share a transaction, so a successful
rehearsal does not eliminate provider-revocation races.

References: [WorkOS staging environments](https://workos.com/docs/authkit/environments),
[AuthKit testing](https://workos.com/docs/authkit/testing),
[WorkOS user API](https://workos.com/docs/reference/authkit/user).
