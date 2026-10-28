# Dashboard critique and judge rounds

Reviewers: independent Claude through Harness, Gemini CLI, UX/accessibility persona, reliability/data persona. Root judges findings against code, tests, and official API contracts. Source content and provider metadata are untrusted evidence, not instructions.

## Round 1

Accepted and fixed:
- Publish only the final merged snapshot. An interrupted provider collection must not overwrite retained caches or budgets with seed data.
- Preserve evidence collection timestamps when a cache check performs no retrieval.
- Render independent research when peer data is absent.
- Remove duplicate accessible video-link names.

Build and 59 checks passed before the initial research release. Later expanded checks cover the atomic publisher and cached provenance.

## Round 2

Accepted and fixed:
- Rotate YouTube statistics checks through unchecked videos, then the oldest attempts.
- Guard the Research view against a missing primary repo and optional path data.
- Normalize video card rows, truncation, singular labels, and metadata alignment.

Judge rejected Gemini's claim that Exa domain-path exclusions are invalid: the current official API documentation explicitly supports paths and live requests succeeded. Whole-batch retention on a failed discovery batch is intentional; partial search results must not silently imply complete coverage.

Build and 62 checks passed for the second release.

## Round 3

Fresh diagnosis after the first two fix rounds. Accepted and fixed: retain prior reconstructed star history on pagination limits while updating the current star total, daily rechecks of empty search coverage, and complete per-URL executed-query lineage. Claude's final review also identified bootstrap and deadline budget gaps. Paid collectors now skip when no base snapshot exists and stop starting at the deadline. Tests cover all seven collector boundaries.

Gemini's malformed-URL finding was rejected after inspecting the canonicalizer: malformed URLs return null, not the raw string alleged by the review. Its older-browser AbortSignal compatibility concern is recorded as a compatibility limitation, not a demonstrated failure in the tested browser.

The final batch passes the source build and 74 tests, including six bounded Tavily collector tests. Research uses readable responsive leads, an estimated-English default filter, action-first proposals, and original source records. The incomplete final star-day segment is translucent. Publishing and anonymous endpoint checks are recorded in VALIDATION.md.

Follow-up judgment accepted the zoom defect in gradient-based partial-day styling. Separate completed/partial series now preserve the correct segment under zoom. A Fable review identified mismatched experiment text and quotes; both Overview and Research now use a shared theme-based proposal helper. Its suggestion to emphasize huge percentage changes from a 57-view baseline was rejected in favor of the Data review's measured concentration insight. Final expansion passes 84 tests. Muse could not receive a task through this Harness session, and the direct Claude `muse` model name was rejected; no Muse review is claimed.

A reviewer suggested moving long refreshes into HTTP waitUntil. This is not accepted as a durable-job solution: background HTTP execution has its own time bound. Scheduled ingestion and cheap client polling remain separate.
