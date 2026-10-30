# Boing app preview

This static shell is staging scaffolding. It requires an authenticated same-origin Worker implementing the `/api/boing/*` routes the shell calls:

- Account and workspaces: `GET account`, `GET organizations`, `GET`/`POST platform/workspaces`, `GET audit`, `GET workspace/export`.
- Members and invitations: `GET members`, `POST members/:userId/revoke`, `GET invitations`, `POST invitations/:id/revoke`, `POST invitations/accept`.
- Projects: `GET`/`POST projects`, `GET projects/archived`, `POST projects/:id/archive`, `POST projects/:id/restore`, `PUT projects/:id/name`, `PUT projects/:id/website`, `GET`/`PUT projects/:id/access`, `GET projects/:id/export`.
- Measurements: `GET projects/:id/snapshot`, `GET projects/:id/sources`, `GET projects/:id/history`, `GET projects/:id/collection-status`, `POST projects/:id/collect`, `GET`/`PUT projects/:id/presentation`.
- GitHub: `POST github/install`, `GET github/repositories`, `POST github/select`.
- AI: `GET`/`PUT ai-settings`, `POST insights`.

Organization-scoped requests carry the selected local organization ID as a selector; the Worker must verify membership and role independently. The shell does not supply login and does not replace the protected existing dashboard. Do not deploy or expose it until the Worker, tenant authorization, migration, and launch gates have been verified.

It renders only supported, finite numeric measurements from authorized source records or a legacy snapshot when no GitHub record is available. Missing measurements are shown as unavailable rather than inferred. Source age and collection failures are shown without asserting a collection cadence. GitHub repository views are labeled as a reporting-window measurement, not lifetime traffic.

Tests run with `npm --prefix boing test`. They are not part of the EGM production test suite. Browser accessibility, responsive behavior, route packaging, and the end-to-end session flow still need verification.
