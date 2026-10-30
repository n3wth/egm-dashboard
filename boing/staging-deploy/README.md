# Boing staging deployment

This configuration targets the separate Boing staging Worker, D1 database,
WorkOS environment, and `staging.boing.run`. It does not modify EGM production.
The public beta and migration gates in `../docs/boing-rollout.md` still apply.

Run `node prepare-assets.mjs` before a build. The generated `dist/` contains
only the app runtime assets, excluding tests and documentation. Run
`env -u CLOUDFLARE_API_TOKEN ./node_modules/.bin/cf deploy --dry-run` to
validate the configuration. Provision `WORKOS_API_KEY` and
`BOING_AUTH_SECRET` securely; never commit or print them.

Staging must be verified with two organizations, live WorkOS authentication,
tenant isolation and provider failures before considering any production cutover.
