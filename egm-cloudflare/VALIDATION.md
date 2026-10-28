# EGM deployment verification

Verified 2026-10-28. Published at https://egm.n3wth.com/overview.

- Source build passed. All 74 backend and live snapshot tests passed.
- Browser verified title-to-Overview navigation, compact repo/PR labels, top-aligned tables, Semrush backlinks, and Firecrawl/Exa discovery.
- Favicon returns HTTP 200 with image/svg+xml. Sign-in page visually inspected at 698px.
- Actual logout revoked the session. Private snapshot API returned sign_in_required. Google sign-in restored owner access.
- Anonymous snapshot, presentation, and approval endpoints return 401. Owner-only editing and publishing remain enforced server-side.
- Semrush authenticated collection returned 150 backlinks and 48 referring domains. US organic reports returned no_data, not measured zero.
- Firecrawl authenticated collection returned 30 retained distinct URLs. Exa returned nine discovery results, separately labeled and deduplicated in the UI.
- GitHub cron runs every 30 minutes through 2026-11-04T06:33:01Z. SEO caches daily, Firecrawl two-hourly, Exa daily. Failed collections retain last-good evidence.

The integrated refresh uses a bounded lease and publishes only the final merged snapshot. The scheduled run at 07:30 UTC on October 28 completed successfully, verified from refresh_control. A previously interrupted manual request was not counted as success.

Tavily's stored credential was configured as a Worker secret without printing its value. Live collection succeeded: three basic requests, seven retained results. Daily caching and a seven-batch cap are tested. Provider results are deduplicated for display while original query records remain in Sources.

Local Research leads were browser-checked at 698px: readable full-width rows, default estimated-English filter, no document horizontal overflow. Final visual browser checks after the latest publication remain pending while the browser is handed to Oliver for Google Cloud passkey confirmation. Google YouTube API key setup is not yet complete.

Approval event methods are deployed at /mcp. Dot still needs an authenticated EGM connection and successful webhook subscription. No supported connection-creation tool was available, so active Dot notifications are not claimed.
