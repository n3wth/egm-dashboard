# Project evidence prototype

This isolated module reuses the protected EGM Data app's public `MetricCard`,
`EvidenceChart`, and `Section` components for project-scoped GitHub evidence.
It has no bundled EGM snapshot, global fetch, or legacy API calls.

It is **not wired into Boing or ready for deployment**. A trusted caller must
authenticate the user, verify current WorkOS organization membership and
project permissions server-side, fetch that project's scoped response, and
bind the response to the matching organization and project. The local scope
check prevents accidental mixing; it is not authorization. The current API
returns snapshot data and generation time without this envelope, so a caller
must construct the envelope only after the scoped request succeeds.

This prototype is read-only. The protected hosted shell still assumes global
snapshot and presentation endpoints; charts, source inspection, editing,
presentation persistence, exports, and AI need a verified per-project adapter
before reuse in production. Website, research, and other EGM-specific modules
remain outside this prototype.
