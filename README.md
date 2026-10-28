# EGM Growth Dashboard

Private source for [egm.n3wth.com](https://egm.n3wth.com/reach). The repository name `egm-dashbaord` preserves the requested spelling.

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

Authenticate Wrangler to the intended Cloudflare account, configure the D1 binding and hostname in `egm-cloudflare/wrangler.jsonc`, and initialize the SQL schema files there before a first deployment. Existing production bindings are recorded in that configuration; do not recreate or overwrite them as part of an ordinary update.

```sh
cd egm-cloudflare
npx wrangler@4.151.3 deploy
```

Set secrets with Wrangler's secret commands, never in Git. Required runtime secrets are `SESSION_SECRET` and `GITHUB_TOKEN`; optional data collectors use `SEMRUSH_API_KEY`, `FIRECRAWL_API_KEY`, `EXA_API_KEY`, `TAVILY_API_KEY`, `PARALLEL_API_KEY`, or `YOUTUBE_API_KEY`. WorkOS public client identifiers are configuration, not secrets. Read the Worker before changing the authentication setup. Preserve owner approval and authenticated asset routing.

Cron runs every 30 minutes. Provider-specific caches control independent collection, and `REFRESH_UNTIL` stops collection after the configured seven-day window. Changing that setting extends collection and may incur source-provider charges. Viewing a page reads stored snapshots and does not trigger paid ingestion.

## Source layout

- `egm-performance`: application source, Data runtime contract, lockfile, and source snapshot.
- `egm-cloudflare`: authenticated Worker, collectors, D1 schemas, and tests.
- `egm-cloudflare/test-fixtures`: recorded GitHub responses for offline tests.
- `assets/branding`: light/dark SVG icon, favicon, and wordmark assets.

The snapshot contains private analytics and research intended for this private repository. No access tokens or secret values are included. Search discoveries and modeled SEO data are labeled separately from measured repository activity; source timestamps and missing-data caveats are preserved.
