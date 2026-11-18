# Validation

Validated against current main on 2026-11-18 before PR submission.

* `npm test`: 596 passed (389 backend and related tests, 207 app tests), zero
  failures. The app suite passed again after the shorter starter label.
* `npm run build`: passed, including the 256-file protected-runtime verifier
  and Cloudflare asset packaging. Existing large-chunk warning remains.
* `wrangler deploy --dry-run`: passed; bundles the Worker's cross-directory
  imports. Bundle output stayed outside the repository. No deployment occurred
  during this check.
* `git diff --check`: passed.
* Independent correctness and adversarial code reviews: no actionable findings.

## Browser checks

* Metric numbers and sparklines share a row; charts fill the available space
  to the right. Verified at 679px, with retained chronological gaps intact.
* Adoption and Development tables have three main columns. Details exposes
  supporting fields and links. Both pages fit a 390px viewport without page
  overflow.
* Current stored snapshot produces an unavailable star comparison, with source
  range and reason. November 4 is missing from the 15 required closed samples
  for the checked request date; missing observations were not filled.
* Labeled synthetic boundaries 100, 170 and 205 produce prior 70, latest 35,
  signed difference -35, the 14-row chart and exact evidence formulas.
* Complete calculation verified in light and dark appearances. Expanded
  evidence and chart fit a 390px viewport without horizontal page overflow.
* Appearance was restored to System after testing. Temporary viewport overrides
  were cleared. The user-facing dev tab remains open.

The live snapshot copy and temporary loopback-only API preview are ignored or
outside the repository. They do not modify production data or collection.
The local API preview supports the deterministic analysis; free-form model
queries require configured backend model credentials.

Screenshots attached to the PR use labeled synthetic analysis data.
