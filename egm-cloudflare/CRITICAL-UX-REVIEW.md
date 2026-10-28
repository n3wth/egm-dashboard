# Critical PM review of the EGM dashboard

## Scope and evidence

Read-only review of all seven current page implementations: Overview, Acquisition, Adoption, Website, Development, Research, and Mentions. Persona: a growth PM who has two minutes to decide what changed, what matters, and what to do next.

Evidence: current `egm-performance/src/content/dashboard/{DashboardContent,Research,Mentions}.jsx`, shared research proposal mapping, and reviewed `src/data.json`. Previously supplied `work/published-research-leads.png` and `work/research-final.png` were inspected as historical context. Those captures predate several current fixes and do not establish the present visual state. No authenticated browser, keyboard, screen-reader, or contrast checks were performed in this review. This is a decision-support critique, not a completed live accessibility audit.

Preserve the current restrained visual system, blue/orange chart palette, seven requested pages, native Sources and editing controls, compact language, and honest unavailable states. These recommendations do not require a redesign.

## 1. Acquisition is measurable; actual adoption and website performance still are not

**Impact: high. Effort: medium for measurement, small for presentation.**

The Adoption page shows unique cloners, clone operations, and release downloads. It correctly avoids claiming installations or active users. Website shows GitHub referrals from egm.dev, not total website visitors or first-party search performance. A PM can identify attention but cannot tell whether visitors successfully use EGM or return. This is a product measurement limit, not a styling defect.

**Evidence:** `DashboardContent.jsx` sections `adoption-signals-heading`, `adoption-measurement-gap`, and `website-flow-title`. The source data has traffic, referrals, downloads, and maintenance queries; no first-success or repeat-use query. Semrush organic reports returned no matching records and cannot fill that outcome gap.

**Smallest useful next change:** make the missing outcome an explicit task rather than another proxy: define one successful-workflow event and a repeat-use observation, with privacy and attribution decisions owned by the product. Until collected, keep the existing adoption page and show its unmeasured outcome concisely near the primary signals. For Website, connect first-party measurement separately; do not infer website conversion from repo referral shares.

**Success test:** a PM can answer whether successful workflows increased, give the matching observation window, and distinguish first-time success from repeat use. Before that source exists, a five-second comprehension test should produce “code acquisition is measured; successful use is not.” Never substitute a new estimated conversion rate.

## 2. The dashboard offers experiments without establishing which problem deserves priority

**Impact: high. Effort: small to medium.**

Research now clearly separates quotes from suggested tests, which is a strength. But the Overview chooses its next experiment using the first verified source with a literal theme match. A verified project reference is not necessarily evidence of a user problem. The current selected workflow quote is a description of how EGM works, not a reported failure. The peer quick-start/demo checks are README text heuristics, not an audit of onboarding quality. They can inspire a test, but do not establish its urgency.

**Evidence:** `AcrossEgm` selects `.find(row => row.status === 'verified' && row.themes?.length)`; `research-insights.js` maps that first theme to a fixed proposal. `Research.jsx` builds recommendations from `quickStart`/`demo` matches and displays short verified excerpts. No impact, unresolved user friction, or owner-selected priority determines that order.

**Smallest useful next change:** retain the compact experiment and source, but give its selection a concrete reason. Distinguish “test suggested by a description” from “test addressing an observed user problem.” Prefer an owner-selected next experiment or a single transparent priority rule grounded in the existing evidence. Link a proposed test to the exact first-run task or issue that it would validate. Do not add a speculative scoring framework or claim that a source caused growth.

**Success test:** after opening Overview and its linked Research item, a PM can state the proposed change, the observation supporting it, the uncertainty, and how success would be observed. Reordering source collection alone must not silently change the top experiment's priority.

## 3. Repeated evidence across pages increases reading time without adding a new decision

**Impact: medium to high. Effort: small.**

Several pages repeat the same evidence: the referral-source chart appears on Overview, Acquisition, and Website; popular repo pages appear on Overview and Acquisition; clone history appears on Overview and Adoption; release downloads appear on Adoption and Development. These are valid measurements, but the repeated full-size visuals compete with each page's distinct job. The PM must remember which copy is the useful destination and scroll past familiar material.

**Evidence:** `DashboardContent.jsx` component IDs `referral-chart`, `acquisition-channels`, `website-referrals`; `popular-paths`/`acquisition-pages`; `clone-trend`/`adoption-clone-history`; `downloads`/`adoption-release-downloads`. All bind the same underlying queries within each pair or group.

**Smallest useful next change:** keep all seven pages, but give each measurement one detailed home. Use Overview for the existing compact KPIs, Highlights, and material changes; Acquisition for detailed channels and content; Website for egm.dev's contribution and coverage; Adoption for code acquisition versus successful use; Development for issue/PR throughput and the actionable queue. Replace only duplicate full-size visuals with concise links or summaries where the user approves. Preserve original source access and saved presentation behavior.

**Success test:** ask a PM to find the strongest acquisition channel, the most relevant first-run concern, and current issue triage. They should choose the right destination without visiting two pages containing the same full table or chart. Compare task completion and backtracking against the current version; do not use visual density alone as the success metric.

## What already works

- Source-backed cards preserve original evidence, and unsupported outcomes are not fabricated.
- Referral shares use explicit denominators; observed video statistics remain separate from GitHub referral traffic.
- Current stars are separated from reconstructed history, partial-day rendering is explicit, and unknown video counts are not zero-filled.
- Readable lead rows, compact source identities, native search/menu controls, and collapsed unverified sources reduce scanning noise.

## Suggested order

First agree on the successful-workflow measurement. Next give the existing top experiment an explicit priority rationale. Then remove approved duplicate detail while preserving the requested page structure. None of these should delay already-authorized login, access, refresh, or publishing fixes.
