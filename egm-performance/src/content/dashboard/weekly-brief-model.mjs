/**
 * View models and formatting helpers for the Weekly Building Brief,
 * OSS Health indicators, and Voluntary First-Workflow / Blocker-Retest Log.
 */

export const UNMEASURED_LABEL = 'Not measured'
export const UNKNOWN_PLACEHOLDER = '—'
export const MAX_HELP_REQUESTS = 3

export function formatUnknownValue(value, fallback = UNKNOWN_PLACEHOLDER) {
  if (value === null || value === undefined || value === '') return fallback
  return value
}

export function weeklyBriefViewModel(queries = {}) {
  const briefQuery = queries.weekly_brief ?? {}
  const rows = Array.isArray(briefQuery.rows) ? briefQuery.rows : []

  const commitments = rows
    .filter(row => row.section === 'commitments')
    .map(row => ({
      ...row,
      outcome: row.outcome ?? 'unknown',
      owner: row.owner || 'Maintainers',
      nextCheck: row.nextCheck || '2026-11-09'
    }))

  const improved = rows.filter(row => row.section === 'improved')
  const userVerified = improved.filter(row => row.stage === 'user-verified')
  const released = improved.filter(row => row.stage === 'released')
  const mergedUnreleased = improved.filter(row => row.stage === 'merged-unreleased')

  const attention = rows
    .filter(row => row.section === 'attention')
    .map(row => ({
      ...row,
      severity: row.severity ?? 'medium',
      independentReports: Number.isFinite(row.independentReports) ? row.independentReports : 1,
      commentCount: Number.isFinite(row.commentCount) ? row.commentCount : 0,
      contraryEvidence: row.contraryEvidence || 'None recorded',
      uncertainty: row.uncertainty || 'Unassessed'
    }))

  // At most three specific requests, proposals only, concrete review date, unassigned volunteer
  const help = rows
    .filter(row => row.section === 'help')
    .slice(0, MAX_HELP_REQUESTS)
    .map(row => ({
      ...row,
      owner: row.owner || 'Unassigned (volunteer needed)',
      status: row.status || 'proposal',
      reviewDate: row.reviewDate || '2026-11-09'
    }))

  const missingEvidence = rows.filter(row => row.section === 'missing_evidence')

  const rawPublicDraft = rows.find(row => row.section === 'public_draft') || {
    id: 'pub-draft',
    title: 'EGM Weekly Building Brief (Draft)',
    draftBanner: 'Draft community update. Requires human maintainer editorial review before public distribution. Private research notes, internal telemetry, and user identities are excluded.',
    summary: 'Public summary pending maintainer editorial review.',
    approvedForPublish: false
  }

  // Ensure public draft has no private PostHog or internal attributes
  const { privateNotes, posthogTelemetry, internalReviewer, ...sanitizedPublicDraft } = rawPublicDraft

  return {
    source: briefQuery.source ?? null,
    commitments,
    improved,
    improvedByStage: {
      userVerified,
      released,
      mergedUnreleased
    },
    attention,
    help,
    missingEvidence,
    publicDraft: sanitizedPublicDraft,
    hasRows: rows.length > 0
  }
}

export function ossHealthViewModel(queries = {}) {
  const ossQuery = queries.oss_health ?? {}
  const rows = Array.isArray(ossQuery.rows) ? ossQuery.rows : []

  const formattedRows = rows.map(row => {
    let display = row.displayValue
    if (display == null) {
      if (row.value === null || row.value === undefined) {
        display = UNMEASURED_LABEL
      } else {
        display = `${row.value}${row.unit ? ` ${row.unit}` : ''}`
      }
    }
    return {
      ...row,
      displayValue: display
    }
  })

  return {
    source: ossQuery.source ?? null,
    rows: formattedRows,
    hasRows: formattedRows.length > 0
  }
}

export function workflowResearchViewModel(queries = {}) {
  const researchQuery = queries.workflow_research ?? {}
  const rows = Array.isArray(researchQuery.rows) ? researchQuery.rows : []

  const completedCount = rows.filter(row => row.outcome === 'completed').length
  const blockedCount = rows.filter(row => row.outcome === 'blocked').length
  const retestedSuccessCount = rows.filter(row => row.voluntaryRetest === 'retested_success').length

  const repeatChoices = {
    chose_egm: rows.filter(row => row.repeatUse === 'chose_egm').length,
    chose_alternative: rows.filter(row => row.repeatUse === 'chose_alternative').length,
    no_opportunity: rows.filter(row => row.repeatUse === 'no_opportunity').length,
    unknown: rows.filter(row => !row.repeatUse || row.repeatUse === 'unknown').length
  }

  return {
    source: researchQuery.source ?? null,
    rows,
    summary: {
      totalObserved: rows.length,
      completedCount,
      blockedCount,
      retestedSuccessCount,
      repeatChoices
    },
    caveat: 'Small selected samples explain mechanisms and friction points, not population conversion rates. Repeat-use inquiry evaluates suitable tasks only.',
    hasRows: rows.length > 0
  }
}
