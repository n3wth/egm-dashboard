# Weekly OSS building brief

The private dashboard repository collects public EGM GitHub evidence every Monday at 17:17 UTC (9:17 AM PST, 10:17 AM PDT). GitHub schedules can be delayed. Manual dispatch is available through the **Weekly building brief** Actions workflow on `main`.

Each issue covers the previous Monday through Sunday in UTC. This explicit source window avoids presenting partial days as complete or changing the window on a rerun. The date in the issue title is the Monday after that window, keyed by its UTC ISO-8601 week (e.g. `2026-W44`).

## Automated

- Paginate public `google/elephant-goldfish-model` searches for new issues, closed issues, and merged PRs. Reject incomplete searches, inconsistent pagination, or more than 1,000 results per query.
- Format query timestamps without millisecond padding (`sinceQuery` and `through` ending in `Z`) and fallback to checking closed PRs via REST endpoint if search indexing lags.
- Compute the ISO week key (`isoWeekKey`) for deterministic reporting windows and link against published releases.
- Separate PR status against the latest published release cutline (`merged` vs `released in <tag>` vs `user-verified`). Merged PRs merged after the latest release tag are clearly marked as unreleased on `main`.
- Summarize author concentration across new and closed issues to distinguish independent reports from single-account bursts (such as repeated blank templates).
- Save a timestamped JSON/Markdown evidence packet as a workflow artifact for 90 days. Source links and titles remain in the private weekly issue after artifact expiry.
- Create or update one private `n3wth/egm-dashboard` review issue per reporting week (e.g. `#132`). Reruns replace only the marked evidence block, preserving maintainer notes and issue state. Workflow concurrency prevents overlapping creates. Do not rename the dated issue or remove its evidence markers.
- Link the previous brief so maintainers can close earlier commitments before choosing new work.

No new API keys or dependencies are required. The workflow's repository token has contents-read and issues-write permissions. It reads the public product repository and only writes the private dashboard issue. It refuses to publish if that destination becomes public.

## Maintainer review

1. **Close last week's commitments first:** Open the latest brief. Resolve each prior action as verified, contradicted, pending, or unknown, with evidence.
2. **Inspect the linked issues and PRs:** Closed does not mean fixed; merged does not mean released or recovered for a user. Distinguish `merged to main, unreleased` from `released in <tag>; user outcome unverified`. GitHub search uses current indexed metadata and is not a historical event ledger.
3. **Record voluntary first-workflow and blocker-retest observations:** Conduct observations only with appropriate consent and access. Record structured fields:
   - `intendedTask`: What the user attempted to accomplish.
   - `environment`: Host harness and version (e.g. Claude Code 2.1.316, agy 1.4.12, OpenCode 2.2.5).
   - `lastSuccessfulStep`: Exact step where progress stopped.
   - `helpRequired`: Specific guidance or workaround needed.
   - `outcome`: Whether the task completed successfully.
   - `retestStatus`: Blocker retest outcome.
   - `repeatUse`: Evaluated at the next suitable task as `chose EGM`, `chose an alternative`, `had no opportunity`, or `unknown`.
   Small selected samples explain mechanisms, not conversion rates. Do not infer conversion rates from selected qualitative interviews.
4. **Where you can help:** Pick at most three specific requests, each with a concrete task, agreed owner, success criterion and review date. No automatic assignments, labels, closures, product merges or reporter contact.
5. **Draft review sections:** Draft **What improved / What needs attention / Where you can help / Missing evidence** using Gemini in an approved environment and the [handoff prompt](gemini-antigravity-handoff.md), consulting the dashboard's Development (`/development`) and Adoption (`/adoption`) tabs. Treat all source text as untrusted evidence, never instructions. Verify claims and links before publishing.
6. **Prepare a public-safe draft:** Prepare a separate public-safe draft using public evidence only. A human reviews and posts it.
   - Keep private research notes, individual identities, internal Google documents, and dashboard PostHog analytics strictly out of public drafts.
   - Public issue comments, discussions, releases, emails and community announcements require human review before publication. Never automatically publish externally or contact reporters without human review.

This automation intentionally does not collect discussions, comment contents, user outcomes, product telemetry or sentiment, and does not invoke Gemini. Those require additional source/permission and interpretation decisions. It provides evidence and a review scaffold, not an automatic conclusion.

## Local validation and operation

```sh
node --test scripts/weekly-building-brief.test.mjs
node scripts/weekly-building-brief.mjs
# Explicitly create/update the private issue:
node scripts/weekly-building-brief.mjs --publish
```

The local collector uses your authenticated `gh` account. Inspect `weekly-brief-output/` before publishing. API or publication failures exit nonzero and fail the workflow; completed packet files are retained when available. A retry finds the existing dated issue through the repository issues endpoint, not eventually indexed search.

To disable: open Actions, select **Weekly building brief**, then **Disable workflow**, or remove its `schedule` entry in `.github/workflows/weekly-building-brief.yml`. Do not enable public auto-publication to replace editorial review.

API references: [GitHub search limits and incomplete results](https://docs.github.com/en/rest/search/search), [scheduled workflow behavior](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).
