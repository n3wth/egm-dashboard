// Generates the schema for a NEW, separate Boing database. It does not connect
// to D1 or apply migrations. Existing databases require an explicit migration:
// CREATE TABLE IF NOT EXISTS does not repair existing tables or foreign keys.
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { BOING_IDENTITY_SCHEMA } from './boing-identity.mjs'
import { BOING_AUTH_SCHEMA } from './boing-auth.mjs'
import { GITHUB_APP_SCHEMA } from './boing-github-app.mjs'
import { GITHUB_OAUTH_SCHEMA } from './boing-github-oauth.mjs'
import { INVITES_SCHEMA } from './boing-invites.mjs'
import { AUDIT_SCHEMA } from './boing-audit.mjs'
import { JOBS_SCHEMA } from './boing-jobs.mjs'
import { BOING_QUOTA_SCHEMA } from './boing-quotas.mjs'
import { BOING_AI_CONSENT_SCHEMA } from './boing-ai-settings.mjs'
import { BOING_MEMBERSHIP_AUDIT_SCHEMA } from './boing-membership-admin.mjs'
import { BOING_WEBHOOK_SCHEMA } from './boing-webhook.mjs'
import { BOING_LEGACY_BASELINE_SCHEMA } from './boing-transfer.mjs'

export async function createBoingSchema() {
  const tenancy = await readFile(new URL('./boing-tenancy-schema.sql', import.meta.url), 'utf8')
  const membershipBinding = await readFile(new URL('./boing-membership-binding-migration.sql', import.meta.url), 'utf8')
  return [BOING_IDENTITY_SCHEMA, tenancy, BOING_AUTH_SCHEMA, GITHUB_APP_SCHEMA, GITHUB_OAUTH_SCHEMA,
    INVITES_SCHEMA, AUDIT_SCHEMA, BOING_MEMBERSHIP_AUDIT_SCHEMA, JOBS_SCHEMA, BOING_QUOTA_SCHEMA, BOING_AI_CONSENT_SCHEMA,
    `${BOING_WEBHOOK_SCHEMA};`, `${BOING_LEGACY_BASELINE_SCHEMA};`, membershipBinding].join('\n\n') + '\n'
}

// Redirect stdout to a temporary file for review and manual D1 application.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.write(await createBoingSchema())
}
