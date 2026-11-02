# EGM Growth Dashboard

Private source for [egm.n3wth.com](https://egm.n3wth.com/overview).

The React dashboard uses a Cloudflare Worker and D1. WorkOS verifies sign-in; server-side approval controls access. A session ends after 7 days without a visit, and always 30 days after sign-in. Owner presentation edits are stored separately from source snapshots. The public hostname does not make the data public.

The refresh runner retains `githubHistory` in the same atomic D1 snapshot write: daily traffic/activity are merged by UTC date without expiry; rolling reach, referrer, path, download and website observations retain the latest capture per UTC collection day with original source metadata. Initial history includes the checked-in reviewed data and the last stored window. Missing older traffic cannot be recovered from GitHub after its 14-day limit. Unique visitors and overlapping rolling totals must not be added across periods. The dashboard's current-window queries remain unchanged. Collection still stops at `REFRESH_UNTIL`; retained history remains stored afterward.

## Build and test

Use Node.js 22.22 or newer and npm.

```sh
npm run install:app
npm run build
npm test
```

For a local preview with current GitHub observations, run `node scripts/refresh-preview.mjs`, then start the Vite dev server. It uses the authenticated `gh` CLI for repository reads, writes an ignored `.data-app-preview/snapshot.json`, and never updates production or calls paid collectors. Only development serving uses this override; builds retain the reviewed checked-in fallback. Source coverage and independent-provider timestamps remain explicit; missing dates are not filled.

The existing application lockfile pins dependencies. Its source build verifies the protected runtime manifest before compiling. `npm run build` also copies the generated HTML into the Worker's assets directory. Generated output and dependencies are not committed.

For application development:

```sh
npm --prefix egm-performance run dev
```

Local development has no production session or source-provider credentials.

## Codex Cloud and local configuration

Builds and offline tests need no provider credentials. Configure a private Codex Cloud environment for this repository with Node.js 22.22 or newer. Install using `npm run install:app`; validate with `npm test` and `npm run build`. For a preview, run `npm --prefix egm-performance run dev -- --host 0.0.0.0`.

A cloud task runs on a separate computer. An ignored `.env` on Oliver's Mac is not a portable cloud configuration. The committed `.env.example` contains names and safe defaults only. For local Worker development, copy it to `egm-cloudflare/.dev.vars`; Wrangler reads that file. The root `.env.example` is not automatically loaded by Vite or the Worker. Keep actual `.env` and `.dev.vars` files out of Git. Collection is disabled in the template to avoid accidental provider calls.

For Codex Cloud, use **Settings > Codex Cloud > Environments** and keep **Who can use: Only me**. Add directly read settings as environment variables. For provider credentials sent over HTTPS, prefer network secrets scoped to the provider's exact API host. Programs receive placeholders; the network proxy substitutes credentials for allowed destinations. Personal vault can supply account-specific values. Do not copy production session or WorkOS secrets into a reusable development filesystem. Use a separate WorkOS development application for localhost sign-in. Publish environment changes, then start a new task to use them.

See the [official Codex Cloud environment documentation](https://learn.chatgpt.com/docs/environments/cloud-environments) for variable, network-secret and prepared-filesystem behavior. Production deployment continues through GitHub Actions and Cloudflare runtime secrets, independently of development configuration.

## Optional integrations

- Dashboard feedback uses the PostHog API survey and the `feedback.submitted` MCP event. Apply `egm-cloudflare/feedback-schema.sql` to the target D1 database before deploying this feature. Set `POSTHOG_PROJECT_TOKEN` and `POSTHOG_HOST` as Worker secrets; the token is the public project token, not a personal API key. Approved users can submit feedback. The dashboard stores the author's user ID and message, then queues the survey response and signed webhook delivery. Only the pinned owner can subscribe, and callback hosts must be in `APPROVAL_WEBHOOK_HOSTS`. Feedback is untrusted input, not an instruction to an automated worker.
- Owner notifications can also go to Grok Bot webhook routines, one for access requests and one for feedback. Apply `egm-cloudflare/grok-notify-schema.sql` first. Set `GROK_ACCESS_WEBHOOK_URL`, `GROK_ACCESS_WEBHOOK_KEY`, `GROK_FEEDBACK_WEBHOOK_URL` and `GROK_FEEDBACK_WEBHOOK_KEY` as Worker secrets; hosts must be in `GROK_WEBHOOK_HOSTS`. A sink stays off until its URL and key are set. Deliveries carry `Authorization: Bearer <key>`, an `eventId` for deduplication and retry with backoff. Feedback is sent only for items submitted after the sink was first enabled. Notifications never approve or deny access.
- Dashboard usage tracking uses PostHog when `VITE_POSTHOG_PROJECT_TOKEN` and `VITE_POSTHOG_HOST` are set at build time. Set both as GitHub Actions repository variables for production. After sign-in the browser calls `posthog.identify` with the WorkOS user id, email and name, the same id the Worker sends on `dashboard_signed_in`. Sign-out calls `posthog.reset()`. Page views and page leaves are captured for history changes. The usage filter keeps `$pathname` and `$current_url` with the query string and hash removed. Section views and Ask outcomes are still sent without question or answer text. Autocapture and session replay stay off. Local and preview hosts do not send events. The project token is public and must not be a personal API key.
- Ask uses Gemini (`gemini-flash-lite-latest`) through the `GEMINI_API_KEY` Worker secret; set it with `wrangler secret put GEMINI_API_KEY`. Each question and the saved dashboard records it cites are sent to Google. Without the secret, Ask returns 503. Each Ask request also sends a `$ai_generation` event to PostHog LLM analytics (model, tokens, latency, time to first token, the question turns and the answer; never the snapshot context) when `POSTHOG_PROJECT_TOKEN` and `POSTHOG_HOST` are set. `$ai_generation` is posted to `/i/v0/ai/batch/` on the ingestion host. `https://us.posthog.com` and `https://eu.posthog.com` are rewritten to `us.i.posthog.com` and `eu.i.posthog.com`. The Worker keeps the request alive with `waitUntil` until that post finishes, including streamed answers.
- Each sign-in sends a `dashboard_signed_in` event to PostHog with the WorkOS user ID and no other properties when `POSTHOG_PROJECT_TOKEN` and `POSTHOG_HOST` are set.
- `GOOGLE_WEB_PERFORMANCE_API_KEY` enables PageSpeed Insights and Chrome UX Report collection for egm.dev. Collection follows the existing refresh window and cache; missing or stale provider data is identified in the dashboard.
- Apply `egm-cloudflare/invitations-schema.sql` to the target D1 database before using invitations. Link invitations expire and can be revoked; email invitations require `INVITATION_EMAIL_ENABLED=true` and a `RESEND_API_KEY` for a verified n3wth.com sender. A provider accepting an email does not guarantee delivery.
- Apply `egm-cloudflare/decision-email-schema.sql` before enabling decision mail. A pending request that becomes approved can email the requester once, after the decision is saved, from `EGM Dashboard <updates@n3wth.com>`. Set `DECISION_EMAIL_ENABLED=true` with the same `RESEND_API_KEY`. A denial email also needs `DECISION_DENY_EMAIL_ENABLED=true`. Both default to off. People already decided are not emailed, and there is no backfill. Revoke and reinstate do not send. A delivery failure is logged and does not change the decision. The outline mark in that mail is `assets/branding/egm-mark-black.png` and `egm-mark-white.png`, copied to `/email/` and served without a session, the same way the favicon is.
- WorkOS administration requires the session schema in `egm-cloudflare/workos-session-schema.sql`, a dashboard organization and admin permission, a pinned `WORKOS_OWNER_USER_ID`, `WORKOS_API_KEY`, and the settings shown in `.env.example`. Verify the issuer from the target environment before enabling `WORKOS_RBAC_ENABLED`. With RBAC enabled, administration and presentation edits require the dashboard admin permission.
- Set `WORKOS_WIDGETS_ENABLED=true` only after configuring the WorkOS application's allowed web origin and the session schema, owner ID, API key, client ID, and issuer. Profile and security changes apply to the WorkOS account across connected applications. WorkOS session and profile availability are checked on authenticated requests; provider outages temporarily prevent access rather than accepting a revoked session.

Use a separate WorkOS application and database for local testing. The WorkOS organization membership widget does not replace this dashboard's invitation and pending-approval flow.

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

The sign-in animation's editable Rive source is `assets/branding/egm-handoff.rml`; the app serves the checked-in `.riv` export. The source Figma skill icons and EGM mark are in `assets/branding/rive-source/`. To rebuild it, create a Rive CLI project, replace its `scene.rml` with that source, run `rive <project-directory> --once`, and copy the resulting `.riv` to `assets/branding/egm-handoff.riv`.

The snapshot contains private analytics and research intended for this private repository. No access tokens or secret values are included. Search discoveries and modeled SEO data are labeled separately from measured repository activity; source timestamps and missing-data caveats are preserved.
