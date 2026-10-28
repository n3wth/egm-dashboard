# EGM measurement integrations

Reviewed October 28, 2026. Recommendations only. No accounts, credentials, tracking, or collection schedules were changed.

The current dashboard already collects GitHub traffic/activity, Semrush backlinks, Firecrawl mentions, and Exa discovery/research. Its own source code explicitly says that website visitor totals, completed installation, first successful workflow, and repeat use are unmeasured. More mention searches would overlap existing coverage. The next integrations should close those measurement gaps.

## Ranked options

| Priority | Integration | Exact question answered | Suggested collection |
| --- | --- | --- | --- |
| 1 | Cloudflare Web Analytics for **egm.dev** | How many measured site visits/pageviews arrive, through which referrers and pages? | Every 30 minutes |
| 2 | Google Search Console for **egm.dev** | Which Google queries show EGM, earn clicks, or have high impressions and weak CTR? | Daily, with recent data marked provisional |
| 3 | Explicit activation events, optionally in PostHog | Do people complete a first EGM workflow and return, rather than merely clone/download? | Daily cohorts; events arrive as they occur |
| 4 | Official Hacker News API for identified EGM submissions | What score/comment activity belongs to the original discussion, rather than an HN aggregator backlink? | Every 30 minutes for a small allowlist of story IDs |
| 5 | YouTube Data API enrichment of discovered video IDs | Which videos actually gain public views, likes, and comments over time? | Every 6 hours; reuse existing discovery |

## 1. Measure the public website first

Cloudflare Web Analytics is free and can be installed with a beacon without moving DNS. It supplies client-side pageview/visit and performance data. Use a property for **egm.dev**, not the private dashboard at egm.n3wth.com. Dashboard visitors are not product audience. This closes the missing website denominator that GitHub referral counts and Semrush estimates cannot supply. [Official overview](https://developers.cloudflare.com/web-analytics/about/)

Needs permission to modify egm.dev, its Cloudflare account/property, and an appropriately scoped analytics read token. Existing Worker deployment access does not prove access to that website or dataset. Verify GraphQL dataset permissions before implementation. Browser blockers can prevent beacons; queries can be sampled. Store the reported sampling information. Cloudflare currently supports neither UTM reporting nor custom events here, so this alone cannot measure outbound-click conversion or activation. Do not divide GitHub's independently counted referral visitors by site visits and call it a user-level funnel. [Setup](https://developers.cloudflare.com/web-analytics/get-started/), [limitations and sampling](https://developers.cloudflare.com/web-analytics/faq/)

## 2. Add first-party search evidence

Search Console is free. Its query/page dimensions and clicks, impressions, CTR, and average position answer content and search-discovery questions even when Semrush has no organic coverage. It measures Google Search performance, not all website traffic or competitor rankings. [Service description](https://support.google.com/webmasters/answer/9128668?hl=en), [Search Analytics API](https://developers.google.com/webmaster-tools/v1/searchanalytics/query)

Needs access to a verified egm.dev property, a Google Cloud API project, and OAuth with read-only Search Console scope. Google sign-in to this dashboard does not provide this permission. Keep tokens server-side and query aggregates. Refresh daily rather than every 30 minutes; retain source dates and completeness. The API returns leading rows, not necessarily every query, and missing rows do not prove zero search demand. [Authorization](https://developers.google.com/webmaster-tools/v1/how-tos/authorizing), [API quotas](https://developers.google.com/webmaster-tools/limits)

## 3. Measure activation only with an explicit event contract

Define the success event before choosing a vendor: for example, a completed first review, then another completed workflow on a later day. Website install-button clicks are intent, not installation or successful use. GitHub downloads are acquisition, not retention. PostHog supports named custom events, funnels, and retention; its current free allowance is 1 million analytics events monthly. A connected PostHog tool is available, but no EGM project, permissions, or data were verified. [Custom events](https://posthog.com/docs/getting-started/send-events), [pricing](https://posthog.com/pricing)

This requires approved changes to the actual EGM plugin and a voluntary participant mechanism, not simply adding tracking to the dashboard. Start with an opt-in pilot. Send event name, coarse plugin version, timestamp, and a random installation identifier only. Exclude repository paths, prompts, code, document content, and email; disable autocapture and session replay. This is a proposed privacy boundary, not a claim that collection is already authorized or configured. An opt-in sample measures participating installations only. [Capture configuration](https://posthog.com/docs/libraries/js/config)

## Lower-effort complements

**Hacker News:** the official public API exposes story score and comment count without an authentication flow. Resolve original story IDs from existing sources first; the API is not a general full-text search service. Track only known submissions and retain URLs. Public commenters are not customers, and discussion counts do not establish traffic or adoption. No paid plan is required for those documented public reads. [Official API](https://github.com/HackerNews/API)

**YouTube:** the UI already has a video gallery and an optional `youtube_videos` query, but the current snapshot has no populated query. Enrich discovered IDs with `videos.list` rather than repeatedly running broad searches. Public statistics need a Google API project/key; private audience or watch-time analytics would require channel-owner authorization. A videos.list call costs one quota unit; use the project's available quota and do not assume channel access. External video views cannot be attributed to EGM installs. [Video resource](https://developers.google.com/youtube/data/reference/rest/v3/videos/list), [setup and quota](https://developers.google.com/youtube/data/getting-started)

## Recommendation

Start with Cloudflare Web Analytics and Search Console if egm.dev access is available. Treat explicit activation measurement as the next product decision. Add bounded HN and YouTube reads as inexpensive enrichment, without expanding the current paid discovery workload.
