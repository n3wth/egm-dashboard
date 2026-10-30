import { providerCallLimits } from './boing-provider-budget.mjs'

// These flags describe configuration, not whether a cron trigger is deployed
// or whether a provider call will succeed.
export function collectionConfiguration(env = {}) {
  const enabled = env.BOING_COLLECTION_ENABLED === 'true'
  return {
    github: enabled && env.BOING_GITHUB_COLLECTION_ENABLED === 'true' &&
      /^[1-9][0-9]*$/.test(env.GITHUB_APP_ID ?? '') && typeof env.GITHUB_APP_PRIVATE_KEY === 'string' && !!env.GITHUB_APP_PRIVATE_KEY && !!providerCallLimits(env, 'github'),
    website: enabled && env.BOING_PAGESPEED_BUDGET_APPROVED === 'true' && typeof env.PAGESPEED_API_KEY === 'string' && !!env.PAGESPEED_API_KEY && !!providerCallLimits(env, 'pagespeed'),
  }
}

// Check the storage used by both request reservations and execution tracking.
// No data is read: the column references make a missing or incomplete
// migration fail closed. This does not establish that a scheduler is deployed.
export async function collectionReadiness(env = {}) {
  const configured = collectionConfiguration(env)
  if (!configured.github && !configured.website) return configured
  if (!env.DB?.prepare) return { github: false, website: false }
  try {
    const checks = await Promise.all([
      env.DB.prepare('SELECT day, provider, organization_id, calls FROM boing_provider_call_budget LIMIT 0').bind().all(),
      env.DB.prepare('SELECT id, organization_id, job_id, claim_id, state, started_at, finished_at FROM boing_collection_executions LIMIT 0').bind().all(),
    ])
    if (checks.some(result => !result || result.success === false || !Array.isArray(result.results))) throw new Error('unavailable')
    return configured
  } catch {
    return { github: false, website: false }
  }
}
