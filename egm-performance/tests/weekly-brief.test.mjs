import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { createServer } from 'vite'

import {
  weeklyBriefViewModel,
  ossHealthViewModel,
  workflowResearchViewModel,
  MAX_HELP_REQUESTS,
  UNMEASURED_LABEL
} from '../src/content/dashboard/weekly-brief-model.mjs'

test('weekly brief view model partitions stages, bounds help proposals, and enforces caveats', () => {
  const snapshot = JSON.parse(readFileSync('src/data.json', 'utf8'))
  const brief = weeklyBriefViewModel(snapshot.queries)

  // 1. Commitments
  assert.ok(brief.commitments.length >= 1, 'contains commitments')
  assert.equal(brief.commitments[0].outcome, 'unknown', 'inaugural commitments have outcome unknown')

  // 2. What improved
  assert.ok(brief.improved.length >= 3, 'contains improved rows')
  assert.ok(brief.improvedByStage.userVerified.length > 0, 'has user-verified items')
  assert.ok(brief.improvedByStage.released.length > 0, 'has released items')
  assert.ok(brief.improvedByStage.mergedUnreleased.length > 0, 'has merged-unreleased items')
  assert.equal(
    brief.improved.length,
    brief.improvedByStage.userVerified.length +
      brief.improvedByStage.released.length +
      brief.improvedByStage.mergedUnreleased.length,
    'all improved items are partitioned into the 3 stages'
  )

  // 3. What needs attention
  assert.ok(brief.attention.length > 0, 'has attention items')
  for (const item of brief.attention) {
    assert.ok(['high', 'medium', 'low'].includes(item.severity), 'severity is high/medium/low')
    assert.ok(Number.isInteger(item.independentReports), 'independent reports is integer')
    assert.ok(Number.isInteger(item.commentCount), 'comment count is integer')
    assert.ok(item.contraryEvidence, 'contrary evidence is specified')
    assert.ok(item.uncertainty, 'uncertainty is specified')
  }

  // 4. Where you can help
  assert.ok(brief.help.length <= MAX_HELP_REQUESTS, 'help requests strictly <= 3')
  for (const item of brief.help) {
    assert.match(item.owner, /Unassigned/, 'volunteer help proposals have unassigned owner')
    assert.equal(item.status, 'proposal', 'status is proposal')
    assert.ok(item.reviewDate, 'review date is present')
  }

  // 5. Missing evidence
  assert.ok(brief.missingEvidence.length > 0, 'missing evidence items present')
  for (const item of brief.missingEvidence) {
    assert.ok(item.unresolvedQuestion, 'unresolved question is present')
    assert.ok(item.smallestObservation, 'smallest observation is present')
  }

  // Public draft
  assert.ok(brief.publicDraft.draftBanner, 'public draft requires editorial review banner')
  assert.equal(brief.publicDraft.posthogTelemetry, undefined, 'no posthog telemetry in public draft')
  assert.equal(brief.publicDraft.privateNotes, undefined, 'no private notes in public draft')
})

test('oss health view model reports unmeasured turnarounds without zero substitution', () => {
  const snapshot = JSON.parse(readFileSync('src/data.json', 'utf8'))
  const health = ossHealthViewModel(snapshot.queries)

  assert.ok(health.rows.length >= 4, 'contains health metrics')
  const responseMetric = health.rows.find(r => r.metric === 'first_response_time')
  const reviewMetric = health.rows.find(r => r.metric === 'pr_review_turnaround')
  assert.equal(responseMetric.displayValue, UNMEASURED_LABEL, 'first response time displays Not measured')
  assert.equal(reviewMetric.displayValue, UNMEASURED_LABEL, 'pr review turnaround displays Not measured')
  assert.notEqual(responseMetric.displayValue, '0', 'unmeasured latency is never 0')
  assert.notEqual(reviewMetric.displayValue, '0', 'unmeasured latency is never 0')

  const returning = health.rows.find(r => r.metric === 'returning_contributors')
  assert.ok(returning.value > 0, 'returning contributors counted')
})

test('workflow research view model computes mechanism summary with sample caveat', () => {
  const snapshot = JSON.parse(readFileSync('src/data.json', 'utf8'))
  const research = workflowResearchViewModel(snapshot.queries)

  assert.ok(research.rows.length > 0, 'contains research attempts')
  assert.equal(research.summary.totalObserved, research.rows.length)
  assert.ok(research.summary.completedCount >= 0)
  assert.ok(research.summary.blockedCount >= 0)
  assert.match(research.caveat, /mechanisms.*not.*conversion rates/i, 'includes mechanisms caveat')
  assert.ok(research.summary.repeatChoices.chose_egm >= 0)
})

test('rendered dashboard components bind provenance and preserve adoption measurement gaps', async () => {
  const server = await createServer({ server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const { DataAppShell } = await server.ssrLoadModule('/src/DataAppShell.jsx')
    const { DashboardContent } = await server.ssrLoadModule('/src/content/dashboard/DashboardContent.jsx')
    const { WeeklyBriefSection, OssHealthSection, WorkflowResearchSection } = await server.ssrLoadModule(
      '/src/content/dashboard/WeeklyBrief.jsx'
    )
    const snapshot = JSON.parse(readFileSync('src/data.json', 'utf8'))

    // 1. Direct component render tests
    const briefHtml = renderToStaticMarkup(
      React.createElement(
        DataAppShell,
        { snapshot, hosted: false, persistLocally: false },
        React.createElement(WeeklyBriefSection, { queries: snapshot.queries })
      )
    )
    assert.match(briefHtml, /data-query-id="weekly_brief"/, 'WeeklyBriefSection binds weekly_brief provenance')
    assert.match(briefHtml, /Close last week.*commitments/, 'Commitments header rendered')
    assert.match(briefHtml, /User-verified/, 'User-verified stage badge rendered')
    assert.match(briefHtml, /Released/, 'Released stage badge rendered')
    assert.match(briefHtml, /Merged \(unreleased\)/, 'Merged stage badge rendered')
    assert.match(briefHtml, /Where you can help/, 'Help proposals section rendered')
    assert.match(briefHtml, /Missing evidence/, 'Missing evidence section rendered')
    assert.match(briefHtml, /Internal brief \(draft\)/, 'View switcher contains internal brief option')
    assert.match(briefHtml, /Public-safe draft \(requires review\)/, 'View switcher contains public draft option')

    const healthHtml = renderToStaticMarkup(
      React.createElement(
        DataAppShell,
        { snapshot, hosted: false, persistLocally: false },
        React.createElement(OssHealthSection, { queries: snapshot.queries })
      )
    )
    assert.match(healthHtml, /data-query-id="oss_health"/, 'OssHealthSection binds oss_health provenance')
    assert.match(healthHtml, /Open source project health/, 'Health title rendered')
    assert.match(healthHtml, /Not measured/, 'Unmeasured metrics render Not measured')
    assert.doesNotMatch(healthHtml, />0 hours</, 'Latency never displays 0 hours')

    const researchHtml = renderToStaticMarkup(
      React.createElement(
        DataAppShell,
        { snapshot, hosted: false, persistLocally: false },
        React.createElement(WorkflowResearchSection, { queries: snapshot.queries })
      )
    )
    assert.match(researchHtml, /data-query-id="workflow_research"/, 'WorkflowResearchSection binds workflow_research')
    assert.match(researchHtml, /Voluntary first-workflow and blocker-retest log/, 'Research log title rendered')
    assert.match(researchHtml, /Small selected samples explain mechanisms/, 'Mechanism caveat rendered')

    // 2. Tab Integration: Adoption Tab
    const adoptionHtml = renderToStaticMarkup(
      React.createElement(
        DataAppShell,
        {
          snapshot,
          hosted: true,
          persistLocally: false,
          initialPresentation: { tabs: [{ id: 'adoption', label: 'Adoption' }] }
        },
        React.createElement(DashboardContent)
      )
    )
    assert.match(
      adoptionHtml,
      /First successful workflow<\/dt><dd>Not measured/,
      'Adoption measurement gap dl preserved intact'
    )
    assert.match(
      adoptionHtml,
      /Repeat use after seven days<\/dt><dd>Not measured/,
      'Repeat use dl preserved intact'
    )
    assert.match(
      adoptionHtml,
      /data-component-id="adoption-workflow-research"/,
      'Workflow research component rendered on adoption tab'
    )
    assert.ok(
      adoptionHtml.indexOf('First use and repeat use') < adoptionHtml.indexOf('Voluntary first-workflow'),
      'Measurement gap card appears above voluntary workflow research card'
    )

    // 3. Tab Integration: Development Tab
    const devHtml = renderToStaticMarkup(
      React.createElement(
        DataAppShell,
        {
          snapshot,
          hosted: true,
          persistLocally: false,
          initialPresentation: { tabs: [{ id: 'development', label: 'Development' }] }
        },
        React.createElement(DashboardContent)
      )
    )
    assert.match(devHtml, /data-component-id="weekly-brief-commitments"/, 'Weekly brief rendered on development tab')
    assert.match(devHtml, /data-component-id="oss-health-metrics"/, 'OSS health rendered on development tab')
    assert.match(devHtml, /data-component-id="open-issues"/, 'Existing open-issues card still rendered')
  } finally {
    await server.close()
  }
})
