# EGM Growth Dashboard

Private source for [egm.n3wth.com](https://egm.n3wth.com/overview).

The React dashboard uses a Cloudflare Worker and D1. WorkOS verifies sign-in; server-side approval controls access. Owner presentation edits are stored separately from source snapshots. The public hostname does not make the data public.

## Build and test

Use Node.js 22.22 or newer and npm.

```sh
npm run install:app
npm run build
npm test
```

The existing application lockfile pins dependencies. Its source build verifies the protected runtime manifest before compiling. `npm run build` also copies the generated HTML into the Worker's assets directory. Generated output and dependencies are not committed.

For application development:

```sh
npm --prefix egm-performance run dev
```

Local development has no production session or source-provider credentials.

## Deploy

Production updates deploy automatically through `.github/workflows/deploy.yml` when changes reach `main`. Work on a feature branch, validate locally, then merge through the repository's normal review process. The workflow installs locked dependencies, runs backend and application tests, verifies the protected runtime, builds assets, and deploys the existing `egm-growth` Worker. Failed checks prevent deployment. Manual workflow dispatch is also limited to `main`.

After merging, verify the Actions run for that commit succeeds, inspect the deployment step's Cloudflare version ID, and check the live dashboard, authentication, and private API access:

```sh
gh run list --branch main --limit 5
gh run watch RUN_ID --exit-status
```

The encrypted repository Actions secret `CLOUDFLARE_API_TOKEN` authorizes deployment. Provider and session secrets remain in Cloudflare, separately from the repository. Existing D1 bindings, hostname, and cron settings are recorded in `egm-cloudflare/wrangler.jsonc`; do not recreate or overwrite production resources during an ordinary update. New database migrations require separate review and execution before releasing code that depends on them.

Use direct Wrangler deployment only for exceptional manual recovery. First build and test the intended revision, authenticate Wrangler to the intended Cloudflare account, and preserve the existing configuration:

```sh
cd egm-cloudflare
npx wrangler@4.151.3 deploy
```

Record the recovery deployment's version ID and reconcile the source through a feature branch so subsequent `main` deployments retain the fix. Set runtime secrets with Wrangler's secret commands, never in Git. Required runtime secrets are `SESSION_SECRET` and `GITHUB_TOKEN`; optional data collectors use `SEMRUSH_API_KEY`, `FIRECRAWL_API_KEY`, `EXA_API_KEY`, `TAVILY_API_KEY`, `PARALLEL_API_KEY`, or `YOUTUBE_API_KEY`. WorkOS public client identifiers are configuration, not secrets. Read the Worker before changing the authentication setup. Preserve owner approval and authenticated asset routing.

Cron runs every 30 minutes. Provider-specific caches control independent collection, and `REFRESH_UNTIL` stops collection after the configured seven-day window. Changing that setting extends collection and may incur source-provider charges. Viewing a page reads stored snapshots and does not trigger paid ingestion.

## Source layout

- `egm-performance`: application source, Data runtime contract, lockfile, and source snapshot.
- `egm-cloudflare`: authenticated Worker, collectors, D1 schemas, and tests.
- `egm-cloudflare/test-fixtures`: recorded GitHub responses for offline tests.
- `assets/branding`: light/dark SVG icon, favicon, and wordmark assets.

The snapshot contains private analytics and research intended for this private repository. No access tokens or secret values are included. Search discoveries and modeled SEO data are labeled separately from measured repository activity; source timestamps and missing-data caveats are preserved.
