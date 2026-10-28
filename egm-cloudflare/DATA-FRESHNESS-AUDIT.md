# Data freshness audit

Audited October 28, 2026. Evidence: current collector source, regression tests, and the production D1 export in `work/live-audit-d1.json`. The export is a captured observation, not a continuously current account of production. No paid refreshes were triggered for this audit.

## Verified production observations

The exported snapshot body has `generatedAt=2026-10-28T09:00:07.358Z`. Its sources have different observation times, correctly demonstrating that a snapshot update is not a fresh collection of every provider:

| Data | Rows | Source observed at (UTC) |
| --- | ---: | --- |
| GitHub traffic/reach/activity | 14/1/14 | Oct 28 09:00:07 |
| Comparable repos and newly created repo discovery | 5/5 | Oct 28 09:00:20 |
| Firecrawl mention discovery | 30 | Oct 28 07:08:08 |
| Exa discovery / research | 9/13 | Oct 28 07:08:12 / 07:19:05 |
| Tavily / Parallel discovery | 7/8 | Oct 28 07:55:33 / 08:16:33 |
| Scraped discussion evidence | 5 | Oct 28 07:25:38 |
| YouTube metadata/statistics inventory | 10 | Oct 28 08:42:27 |
| Semrush organic overview/keywords/competitors | 0/0/0 | Oct 28 07:04:14 |
| Semrush backlink aggregate | 1 | Oct 28 07:04:14 |

Empty Semrush organic reports are actual returned empty datasets, not proof of zero website visitors or absent demand. Provider index dates can precede request dates. Video and content records also carry individual observation timestamps; inventory-level time does not make every row freshly checked.

## What actually updates

The Worker cron is `*/30 * * * *`. The configured collection window ends November 4 at 06:33:01 UTC. After that, the cron remains configured but collection exits without new provider requests. Refreshes share a D1 lease, a two-minute cooldown, a ten-minute collection deadline and a fenced snapshot commit.

| Collector | Actual policy |
| --- | --- |
| GitHub repo/traffic/activity/pages | Every successful 30-minute run; API rolling daily buckets remain UTC-based |
| Peer research | Five known repositories and their default-branch README fetched each successful GitHub run; quick-start/demo flags are literal README heuristics |
| Emerging repos | GitHub search for agent-related descriptions, created in the preceding 30 days, ranked by current total stars; this is not measured GitHub Trending |
| Firecrawl discovery | Two-hour success/failure cache; cumulative discovered URLs capped at 200 |
| Exa discovery | 24-hour success/failure cache |
| Exa research | Daily, seven successful batches maximum and a known-spend guard; short indexed highlights, not verified conclusions |
| Tavily / Parallel | Daily success/failure cache; seven successful batches maximum |
| Discussion body collection | Five attempts per UTC day, 35 lifetime; 24-hour per-URL attempt cache; only already discovered eligible external pages |
| YouTube | Ten metadata checks daily; explicit initial-day statistics backfill of ten, then three daily, 21 total statistic attempts |
| Semrush | Successful reports daily; failure retry at least one hour; index freshness is provider-controlled |
| HN engagement (new integration) | At most five known-story requests daily, 24-hour success/failure cache; official points/comments, not views |

## Concrete freshness bug fixed

`refresh.mjs` previously stamped **all seeded query sources** with the current GitHub collection time and GitHub request evidence, even for unrelated retained provider datasets. The multi-source runner restored saved independent-provider records for known prefixes, reducing production exposure, but direct refresh persistence and newly introduced query keys could still misrepresent stale data as fresh.

The stamp loop now has an explicit set of queries actually collected by GitHub. Independent-provider source timestamps, coverage, and evidence remain unchanged until their own collector replaces them. A regression test compares full source objects for Firecrawl, Exa, body research, YouTube and SEO records against the original seed. Four refresh tests pass.

## Active website/repo edits: material limitation

Repository README changes are re-read on the next successful GitHub cycle. Only the default-branch README is inspected. Changes in linked documentation, plugin behavior, screenshots, branches and deeper workflows are not automatically evaluated by those two boolean checks.

**There is no direct egm.dev page-content collector in the audited pipeline.** The Website page currently uses GitHub referral counts and Pages/domain configuration, plus provider search/index signals. Editing the website does not immediately refresh its search index, produce measured website traffic, or regenerate an audit of the actual website HTML. External discussion scraping deliberately excludes egm.dev.

Research recommendations in the UI are deterministic proposals derived from current returned fields and literal evidence. They are not a continuously running research agent. Ask generates a new answer on submission from saved data, optionally a bounded live GitHub repo check; it does not invoke all discovery providers or silently force paid refreshes.

## Remaining interpretation limits

- A new snapshot commit, status-check time, source collection time, provider index time and row observation time are distinct. Use source/row timestamps for freshness claims.
- Clone operations, stars, downloads and mention inventories do not measure installation success, activation or retention. Those require actual product events.
- Current stars and newly created repo rankings do not establish trending growth. Comparable-repo changes use the stored monitoring baseline, not an invented weekly history.
- Cached failures retain last-good observations and their dates. Missing/hidden statistics remain unknown rather than zero.
- Search discovery is selective. Deduplicated URLs and theme keywords do not establish exhaustive social coverage, sentiment, independence, causality or measured audience reach.
