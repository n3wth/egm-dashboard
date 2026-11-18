# Feature critic review

Independent design, structural and style reviewers each read their installed
persona, target and six linked source files. Design and structural reviewers
also read the feature specification standard. All stayed read-only and used
fresh conversation contexts without supplied history or memory.

## Findings and disposition

* Design major: EvidenceChart validates queries against the browser registry;
  hiding source actions does not permit a missing query. Resolved: use the
  existing EvidenceChart with a reviewed query, public Chart and citation
  footer otherwise. Both use returned calculation rows.
* Structural nit and style major: absolute difference conflicts with the
  signed -35 example. Resolved throughout the feature journey.
* Structural/style nit: duplicate precomputed-to-model alternatives. Resolved
  by keeping one evaluation.
* Structural nit: state scale limits. Resolved: scan retained snapshot rows
  in memory and inherit existing snapshot/storage limits.

No other blockers or major findings were reported in feature scope.
