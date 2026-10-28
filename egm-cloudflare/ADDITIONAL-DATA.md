# Additional data opportunities

Research for egm.dev, 2026-10-28. These are opportunities, not verified account entitlements or enabled collectors.

1. **CrUX History:** The existing Chrome UX Report API key can query weekly historical field metrics for the egm.dev origin, subject to sufficient public Chrome data. This could show LCP, INP, and CLS trends without a new subscription or authorization. The 28-day collection periods overlap, so changes are moving averages rather than independent weekly samples. The API returns 25 periods by default and shares the free daily API quota. [CrUX History API](https://developer.chrome.com/docs/crux/history-api)
2. **Search Console:** Search clicks, impressions, CTR, and position by query, page, or device could reveal organic acquisition. Access requires OAuth and permission to the egm.dev property; the existing API key is insufficient. Results can omit rows, so they should not be presented as a complete query census. [Search Analytics](https://developers.google.com/webmaster-tools/v1/searchanalytics), [authorization](https://developers.google.com/webmaster-tools/v1/how-tos/authorizing)
3. **YouTube Analytics:** If an EGM-owned channel exists, authorized channel reports can add traffic sources, viewing activity, and retention beyond the public video statistics already collected. They require channel-owner OAuth and do not expose private analytics for arbitrary third-party videos. [Channel reports](https://developers.google.com/youtube/analytics/channel_reports), [authorization scopes](https://developers.google.com/youtube/analytics/reference/reports/query)

The current GitHub collector already covers repository traffic, clones, referrers, popular paths, releases, and activity. GitHub's traffic endpoints provide only a 14-day window, so retaining dated observations remains useful. [GitHub traffic API](https://docs.github.com/en/rest/metrics/traffic)

LinkedIn is excluded at the owner's request. Do not enable additional collectors until access, quotas, and the requested scope are confirmed.
