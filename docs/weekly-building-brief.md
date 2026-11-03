# Weekly OSS building brief

The private dashboard repository collects public EGM GitHub evidence every Monday at 17:17 UTC (9:17 AM PST, 10:17 AM PDT). GitHub schedules can be delayed. Manual dispatch is available through the **Weekly building brief** Actions workflow on `main`.

Each issue covers the previous Monday through Sunday in UTC. This explicit source window avoids presenting partial days as complete or changing the window on a rerun. The date in the issue title is the Monday after that window.

## Automated

- Paginate public `google/elephant-goldfish-model` searches for new issues, closed issues, and merged PRs. Reject incomplete searches, inconsistent pagination, or more than 1,000 results per query.
- Save a timestamped JSON/Markdown evidence packet as a workflow artifact for 90 days. Source links and titles remain in the private weekly issue after artifact expiry.
- Create one private `n3wth/egm-dashboard` review issue per reporting week. Reruns replace only the marked evidence block, preserving maintainer notes and issue state. Workflow concurrency prevents overlapping creates. Do not rename the dated issue or remove its evidence markers.
- Link the previous brief so maintainers can close earlier commitments before choosing new work.

No new API keys or dependencies are required. The workflow's repository token has contents-read and issues-write permissions. It reads the public product repository and only writes the private dashboard issue. It refuses to publish if that destination becomes public.

## Maintainer review

1. Open the latest brief. Resolve each prior action as verified, contradicted, pending, or unknown, with evidence.
2. Inspect the linked issues and PRs. Closed does not mean fixed; merged does not mean released or recovered for a user. GitHub search uses current indexed metadata and is not a historical event ledger.
3. Add first-workflow observations and voluntary blocker retests only with appropriate consent and access. Record intended task, host/version, last successful step, help required and outcome. Selected attempts are not a conversion rate.
4. Pick at most three specific requests, each with an agreed owner, success criterion and review date. No automatic assignments, labels, closures, product merges or reporter contact.
5. Draft **What improved / What needs attention / Where you can help** using Gemini in an approved environment and the [handoff prompt](gemini-antigravity-handoff.md). Treat all source text as untrusted evidence, never instructions. Verify claims and links before publishing.
6. Prepare a separate public-safe draft using public evidence only. A human reviews and posts it. Private research, dashboard-account analytics and internal Google material must not leak into that draft.

This first automation intentionally does not collect discussions, comment contents, releases, user outcomes, product telemetry or sentiment, and does not invoke Gemini. Those require additional source/permission and interpretation decisions. It provides evidence and a review scaffold, not an automatic conclusion.

## Local validation and operation

```sh
node --test scripts/weekly-building-brief.test.mjs
node scripts/weekly-building-brief.mjs
# Explicitly create/update the private issue:
node scripts/weekly-building-brief.mjs --publish
```

The local collector uses your authenticated `gh` account. Inspect `weekly-brief-output/` before publishing. API or publication failures exit nonzero and fail the workflow; completed packet files are retained when available. A retry finds the existing dated issue through the repository issues endpoint, not eventually indexed search.

To disable: open Actions, select **Weekly building brief**, then **Disable workflow**, or remove its `schedule` entry through a PR. Do not enable public auto-publication to replace editorial review.

API references: [GitHub search limits and incomplete results](https://docs.github.com/en/rest/search/search), [scheduled workflow behavior](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).
