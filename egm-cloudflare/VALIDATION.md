# EGM deployment verification

Verified 2026-10-28. Published at https://egm.n3wth.com/overview.

- Source build passed. All 100 backend, live snapshot, and dashboard helper tests passed.
- Dashboard and authentication typography use the licensed Suisse Intl and Geist Mono assets from the existing private site. Six font files are self-hosted on exact public font routes; private dashboard data stays authenticated. Navigation icons use the bundled Google SVG set.
- Browser verified title-to-Overview navigation, compact repo/PR labels, top-aligned tables, Semrush backlinks, and Firecrawl/Exa discovery.
- Favicon returns HTTP 200 with image/svg+xml. Sign-in page visually inspected at 698px.
- Actual logout revoked the session. Private snapshot API returned sign_in_required. Google sign-in restored owner access.
- Anonymous snapshot, presentation, and approval endpoints return 401. Owner-only editing and publishing remain enforced server-side.
- Semrush authenticated collection returned 150 backlinks and 48 referring domains. US organic reports returned no_data, not measured zero.
- Firecrawl authenticated collection returned 30 retained distinct URLs. Exa returned nine discovery results, separately labeled and deduplicated in the UI.
- GitHub cron runs every 30 minutes through 2026-11-04T06:33:01Z. SEO caches daily, Firecrawl two-hourly, Exa daily. Failed collections retain last-good evidence.

The integrated refresh uses a bounded lease and publishes only the final merged snapshot. The scheduled run at 07:30 UTC on October 28 completed successfully, verified from refresh_control. A previously interrupted manual request was not counted as success.

Tavily's stored credential was configured as a Worker secret without printing its value. Live collection succeeded: three basic requests, seven retained results. Daily caching and a seven-batch cap are tested. Provider results are deduplicated for display while original query records remain in Sources.

Research leads were browser-checked live at 698px: readable full-width rows, default estimated-English filter, no document horizontal overflow. Google YouTube API key setup still requires Google Cloud passkey confirmation. Existing video statistics continue using the bounded collector.

Parallel live collection succeeded with two bounded requests and eight retained results. Provider records remain separate in Sources and deduplicated in the UI. Generic website icons use a fixed Vemetric upstream with PNG validation, allowed-host checks, authenticated delivery, and seven-day caching. Exa, Tavily, and Parallel render bundled single-color SVG brand marks.

WorkOS EGM application-specific branding was saved with all six light/dark icon, logo, and favicon uploads. The editor was reloaded and asset paths plus the rendered icon were verified. EGM's default sign-out destination is https://egm.n3wth.com/. Shared environment authentication methods and Cineplex branding were not changed.

Approval event methods are deployed at /mcp. Dot still needs an authenticated EGM connection and successful webhook subscription. No supported connection-creation tool was available, so active Dot notifications are not claimed.

Latest batch: Workers fetch redirect handling uses manual inspection, fixing favicon and provider requests without following credential-bearing redirects. Authenticated live favicon delivery returned HTTP 200 PNG; known brands use bundled theme-colored SVGs. Missing-icon fallback caches five minutes; successful images cache seven days.

Cloudflare Workers AI Ask is authenticated, same-origin, capped at ten questions per user/hour, and grounded in saved query records with citations. Native inline answer cards contain server-derived values only. Optional live checking calls the fixed GitHub repository endpoint; other providers remain saved evidence. Anonymous Ask returned 401. A real browser question returned the correct 817 website referrals with source evidence.

An authorized initial video backfill checked all ten videos successfully. The integrated live refresh completed at 08:43 UTC with provider statuses available/cached. Ten view counts are present, including the seven previously unattempted videos. The 21-check lifetime cap remains, and future days return to three checks daily.
