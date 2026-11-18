# Reproducible star-growth analysis in Ask

* Author: Oliver
* Status: Implemented and independently reviewed
* Date: 2026-11-18

## Overview

Ask should calculate an inspectable comparison over retained repository star
observations. The first slice compares the latest seven closed sampling
intervals with the preceding seven. It keeps the existing Cloudflare Worker,
authentication, snapshot storage and chat interface.

## The problem

The current Ask backend passes selected snapshot rows to a language model.
It normally selects the latest 20 dated rows, and reduces large records to
three rows. Arithmetic over those samples cannot reliably answer a period
comparison. The dashboard already has deterministic star comparison helpers,
charts, source citations and retained observations. Ask does not use those
calculations to produce its answers.

## Goals

1. A reader can request the supported comparison from an Overview Ask starter.
2. Arithmetic uses all retained observed-total rows before any prompt sampling.
3. The answer, chart and evidence describe the same computed result.
4. Missing, invalid or stale boundaries produce an explicit unavailable result.
5. The reader can inspect the definition, reporting zone, actual sample
   timestamps, boundary totals, subtraction and source observation time.
6. Existing free-form questions continue through the current model path.

## Non-goals

No platform migration, Postgres, Slack integration, arbitrary SQL, new data
collection, paid services, general analysis agent, tenant expansion, or causal
explanations. Do not combine reconstructed current-stargazer history with
observed repository totals. Historical star events, daily net changes and
current repository totals are distinct measurements.

## User journeys

### Compare observed growth

Given an approved signed-in reader and 15 consecutive valid closed daily
samples ending yesterday in America/Los_Angeles, when the reader asks
"Compare EGM net star growth over the last 7 complete sampling days with the
previous 7?", then Ask returns the two endpoint differences, their signed
difference (latest net minus previous net), a chart of the 14 daily net changes,
and calculation evidence.
The latest source sampling day is always excluded even when collection is
stale. A negative endpoint difference is a valid observed net decline.

The chart and answer describe sampling intervals, not exact midnight days.
Sample times can vary. Show all three actual boundary timestamps and the
Pacific sampling-date ranges. Never call this an exact calendar-week count.
Explain that Overview may show reconstructed new stars from current
stargazers; this analysis measures net changes in observed repository totals
and can differ. Report the signed difference (latest net minus previous net)
in stars, without percentages.

### Insufficient history

Given missing dates, stale observations, invalid timestamps, or fewer than
15 valid closed samples, the same request returns an unavailable comparison,
the available source range and the reason. It must not substitute reconstructed
history, show a partial comparison, fill gaps with zeros or invoke the model
to guess a result. A source timestamp later than request time is invalid.

### Other questions

Given any unsupported question, including another duration, date range, peer,
metric or ambiguous follow-up, Ask retains its existing model behavior. Only
the explicitly supported starter question selects this operation, normalizing
case, whitespace and a trailing question mark. No broad keyword routing or
follow-up inference.

## Technical plan

Add a thin pure wrapper in editable dashboard content. Reuse
observedStarGrowth and observedStarChange for subtraction and timestamp
validation. Add freshness validation, unavailable reasons, boundary evidence
and the 14 daily result rows. Require the expected closed end date
(request's Pacific yesterday); reject future source timestamps. The operation
reads the source's Observed net star change definition, with a fixed fallback
matching the existing collector definition. Do not modify collectors.
The existing observedStarGrowth helper retains the latest valid observation
per Pacific date. Invalid observations are ignored; another valid observation
can still establish that date. It rejects a sample later than source time.

The Worker recognizes the supported question and evaluates the operation
against the full saved snapshot. It returns deterministic text and structured
evidence without calling a language model or fetching a current total. All
existing authentication, origin, input validation and hourly quota checks
still apply. This path works without model credentials. It does not change
the snapshot. Existing unrelated questions preserve their current behavior.

The response extends the current result with an optional calculation object.
It has a fixed operation ID and definition, status (complete or unavailable),
reporting zone, source query ID, observed time, exact boundary records,
comparison values. It contains no generated query text
and no claims that SQL ran. Citation ID 1 points to star_observations. Chart
rows come from calculation output in an ordinary chart card. Reuse the
existing chart card layout. A calculated card always uses the public Chart
export inside the same titled section and citation footer. This avoids
EvidenceChart's browser query registry dependency and ensures the plot and
evidence use the same server-returned rows. Never attach this calculation to
unrelated or newer browser source rows.

Return a single existing-protocol result event when stream=true. The current
transport already accepts a final result without preceding text deltas.
Use private/no-store and nosniff headers on both response forms. Preserve the
request's abort handling and avoid recording a model generation for a path
that never invoked one.

In Ask, add a collapsed native details element titled "How calculated" below
the answer evidence. Show plain-language definition and formulas, actual
boundary dates/timestamps/totals, freshness and caveats. Use existing theme
tokens and accessible summary keyboard behavior. A calculation chart must
render its own returned rows even if browser queries are absent or newer.
Use the public Chart export for calculated cards and existing citation styles.

## Alternatives considered

* Keep sampled model answers: least work, but does not solve reproducibility.
* Supply a precomputed comparison to the model: reuses the model path, but
  permits the model to misstate calculated values. This slice guarantees that
  prose, chart and evidence use identical values by formatting them directly.
* Deploy Eve, Vercel's Slack/Postgres analyst template, as a service: adds a
  second runtime and Postgres-oriented
  integration for a calculation supported by existing helpers and snapshots.
* Let the model write SQL: substantially expands validation and permission
  work without being needed for this first metric.

The approved direction is the bounded Cloudflare operation.

## Detailed Implementation Plan

The Worker imports the pure wrapper from editable content; verify Wrangler
bundles that dependency using a separate pre-merge `wrangler deploy --dry-run`
with output outside tracked files; npm build alone does not bundle the Worker.
Add frontend rendering checks in
`egm-performance/tests/ask-calculation.test.mjs`, including a missing browser
query, matching numerical evidence and absent calculations on model answers.

The pure wrapper takes the `star_observations` query and a request timestamp.
It returns `calculation` and `rows`. Calculation has `id:
'observed-net-stars-7d'`, `status`, `definition`, `timeZone`, `observedAt`,
`availableRange: {startDate,endDate}` (or null), `reason` (or null), and
`boundaries: [{label,date,observedAt,stars}]`. Complete results also have
`previous`, `current` and `difference`. Rows contain only `{date,netStars}`
for the 14 calculated intervals. Unavailable results have no numeric
comparison fields, no boundaries and no chart rows. Reasons distinguish
missing observations, invalid source time, insufficient/gapped history and
stale final boundary. Invalid/future samples are never evidence rows.

The backend wraps this in the existing result envelope with a fixed source
`id:'1', queryId:'star_observations'`, the existing Overview tab link, and the
query's observation time. Only a complete result gets a standard chart card
with `calculated:true`, `xKey:'date'`, `series:['netStars']`, and 14 computed
rows. The calculation field is absent on model answers but always present
and rendered for this operation.
The operation scans retained snapshot rows in memory and inherits existing
snapshot/storage limits. No additional datastore or unbounded query is added.

Only the latest question is recognized. The route normalizes case,
whitespace, and a trailing question mark. It does not infer an operation from
history. Return a final NDJSON result event or JSON after the same quota
check, before model preparation. Honor an already aborted request by closing
the stream without a result. Do not record a model generation on this route.

1. Create `egm-performance/src/content/dashboard/ask-analysis.mjs` and
   `ask-analysis.test.mjs`. Export the exact starter question and pure
   analysis wrapper; reuse `weekly-change.mjs` and `star-growth.mjs`.
2. Create `egm-cloudflare/ask-analysis.mjs` for the exact prompt recognizer and
   deterministic response assembly. Integrate into ask.mjs after validated
   snapshot loading and the existing atomic quota; make model availability
   apply only to the model path. Include the source and observation range
   even in unavailable responses when known.
   Create `egm-cloudflare/ask-analysis.test.mjs` for endpoint behavior and
   response assembly. Modify `egm-cloudflare/ask.mjs` for routing only.
3. Modify `egm-performance/src/content/dashboard/AskPanel.jsx` and
   `ask-panel.css` for calculation evidence and existing-card chart rendering.
   Modify `egm-performance/src/content/dashboard/ask-starters.mjs` to replace
   the second Overview question with the supported question. A missing calculation
   field leaves existing answers unchanged. Keep all edits in editable content
   or the Worker; preserve runtime integrity files and dependency locks.
4. Test known answers, net declines, zero baseline, duplicate-day selection,
   malformed dates, future samples, stale collection, missing boundaries,
   gaps, partial latest day, Pacific date handling across DST, and old rows
   outside the default prompt sample. Test auth/quota, model-free operation,
   both response formats and no model/network calls on this route. Check
   unsupported prompts fall through. Add frontend rendering and transport
   checks that inspect values and disclosure rather than source-string tests.
5. Run the repository's npm test and npm run build. Use its locked install
   command if needed. Check the actual UI on desktop/mobile and both themes,
   including expansion, citation, chart and unavailable result. Record any
   check that cannot run.
6. Open a PR to main after independent review, enable supported auto-merge,
   wait for checks and merge, then verify the existing deployment workflow
   and live health/version. Do not bypass protections or change policy.

## Rollout and rollback

No schema migration or new secret is required. Existing clients ignore the
optional calculation field. Removing the new route returns those prompts to
the existing Ask path. Deploy through the repository's existing workflow;
confirm actual workflow success before claiming deployment.

## Acceptance examples

For three boundary totals 100, 170 and 205 on the expected dates, the prior
interval net is 70, the latest interval net is 35, and the difference is -35.
The evidence shows the exact three samples and both subtractions. With a zero
or negative previous net, report the signed difference without a percentage. With any
missing required date or stale final boundary, show unavailable and no chart.

## Open questions

None required for the authorized slice. Deployment permissions and live
authentication are to be verified during delivery, not assumed from source.

## Source reading list

* [Ask backend](../../egm-cloudflare/ask.mjs)
* [Star observation provenance](../../egm-cloudflare/star-observations.mjs)
* [Weekly comparison helpers](../../egm-performance/src/content/dashboard/weekly-change.mjs)
* [Observed series validation](../../egm-performance/src/content/dashboard/star-growth.mjs)
* [Ask interface](../../egm-performance/src/content/dashboard/AskPanel.jsx)
* [Transport](../../egm-performance/src/content/dashboard/ask-transport.mjs)
