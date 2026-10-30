# Boing app preview

This static shell is staging scaffolding. It requires an authenticated same-origin Worker implementing `GET /api/boing/organizations`, `GET /api/boing/projects`, `GET /api/boing/projects/:id/snapshot`, and `GET /api/boing/projects/:id/presentation`. Project requests carry the selected local organization ID as a selector; the Worker must verify membership independently. It deliberately does not replace the protected existing dashboard and does not supply login, onboarding, editing, AI, administration, or real-time collection. Do not deploy or expose it until the Worker, tenant authorization, migration, and launch gates have been verified.

It renders only supported, finite numeric measurements from authorized source records or a legacy snapshot when no GitHub record is available. Missing measurements are shown as unavailable rather than inferred. Source age and collection failures are shown without asserting a collection cadence. GitHub repository views are labeled as a reporting-window measurement, not lifetime traffic.

Run `node --test boing-app/api.test.mjs` for API request and metric filtering tests. Browser accessibility, responsive behavior, route packaging, and the end-to-end session flow still need verification.
