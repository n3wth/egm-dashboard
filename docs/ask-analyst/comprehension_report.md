# Comprehension review

## What this proposes

Add one deterministic Ask operation comparing observed net repository star
growth across two consecutive seven-interval periods. Fifteen retained daily
observations ending on Pacific yesterday produce two net changes, their signed
difference, chart rows and inspectable evidence. Missing, stale, invalid or
incomplete observations produce unavailable; other questions retain the model.

## How the existing system works, per this document

Ask sends sampled snapshot rows to a model, normally selecting 20 dated rows
and reducing large records to three. The dashboard already stores observations
and has deterministic comparison helpers, charts and citations. The Worker
provides authentication, validation, quotas and streaming. The transport can
render a final result without earlier text deltas.

## Findings

* Major: duplicate-day selection and invalid samples were unstated. Resolved:
  latest valid sample wins; invalid rows do not erase another valid sample.
* Nit: absolute difference was ambiguous. Resolved: signed difference is
  latest net minus previous net; percentages excluded.
* Nit: Eve was undefined. Resolved: Vercel's Slack/Postgres analyst template.

Reviewer read only the target and comprehension persona. No source files,
history or memory were supplied to this stage.
