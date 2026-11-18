# Intermediate zoom-out review

The independent reviewer read the persona, zoom-out standard, current draft,
all six source context files and the first three stage reports. No blockers.

* Major: conditional EvidenceChart/Chart branches duplicate rendering and an
  old sentence still required EvidenceChart. Resolved: calculated cards always
  use the public Chart with server rows, citation and calculation evidence.
* Major: acceptance example retained ambiguous absolute-difference wording.
  Resolved: signed difference, no percentages regardless of baseline.
* Nit: optional disclosure was ambiguous. Resolved: only model answers omit
  calculation; deterministic analysis always includes it.
* Nit: explicitly document cross-directory Worker import and bundle check.
  Accepted in implementation plan.
* Nit: implementation details in high-level sections. Kept interface and
  correctness requirements needed to explain the design; mechanical changes
  remain in Detailed Implementation Plan.

Earlier thin-wrapper, metric semantics, exact routing and collector reuse
findings were confirmed resolved. The transport preserves optional fields.
