# EGM decision insights

This review uses the saved `egm-performance/src/data.json` snapshot, not a new live collection. GitHub traffic covers October 13–26 UTC; source collection was October 28 at 06:35 UTC. Research and video observations have their own later timestamps. Recalculate the figures from the displayed queries on each refresh rather than hard-coding them.

## 1. Focus the next distribution improvement on search and video

**UI copy:** “Google and YouTube account for 63.9% of the top reported referral views, or 30.1% of all repo views.”

Google contributes 5,481 views and YouTube 3,313. Their combined 8,794 views exceed LinkedIn's combined web/app 2,851 and egm.dev's 1,125. These are observed distribution channels large enough to prioritize a concrete entry-point improvement: make the repo overview's first-run path immediately usable for visitors arriving from search or a video. Review the discovered video descriptions for whether they point to the intended first-run instructions; don't assume individual videos caused the referrals.

**Show now:** a compact ranked channel breakdown with two explicit denominators: share of all repo views and share of the reported top ten. Add a single leading callout, not another table of every existing metric.

**Calculation and binding:** `referrers.count`, grouped by normalized channel; `reach.rows[0].views`.

```text
Google + YouTube = 5,481 + 3,313 = 8,794
Sum of ten reported referrer view counts = 13,764
8,794 / 13,764 = 63.8913%
8,794 / 29,252 = 30.0629%
13,764 / 29,252 = 47.0532% coverage of all repo views
LinkedIn web + Android = 1,969 + 882 = 2,851
```

**Limit that changes the decision:** the top-ten referral list covers 47.1% of repo views. Its remainder is not necessarily direct traffic, and the observed top channels do not constitute an exhaustive attribution model. Do not sum unique visitors across referrers. No click-level journey, install conversion, or causal channel lift is measured.

## 2. Fix the onboarding-content comparison before prioritizing a rewrite

**UI copy:** “Getting-started pages received 766 views across two URL variants. Harness documentation received 856.”

The saved page table splits `docs/getting_started.md` between `/blob/main/` (406 views) and `/blob/HEAD/` (360). Comparing only the first row makes harness documentation appear 2.1 times larger. After combining page views for the canonical document, the difference is only 11.7%. The practical first change is consistent linking to one getting-started URL, followed by a clear handoff from that document to harness selection. The data does not justify declaring the getting-started guide neglected or broken.

**Show now:** canonical document rows with views, expandable original URL variants, and a prominent “View getting-started guide” link. For a merged row, show unique visitors as unknown unless deduplicated data exists. Keep the two original unique counts in source details rather than adding them.

**Calculation and binding:** `paths.rows`, canonicalize only the known repository prefix and `/blob/main/` versus `/blob/HEAD/` variants for the same file.

```text
Getting started = 406 + 360 = 766 page views
Harness documentation = 856 page views
Harness / getting started = 856 / 766 = 1.11749
Difference relative to getting started = (856 - 766) / 766 = 11.7493%
Repo home = 17,805 / 29,252 = 60.8676% of all repo views
```

**Limit that changes the decision:** document views are not a funnel. The 17,805 home views cannot be treated as eligible users who then should have opened the guide. Unique counts of 335 and 313 for the guide variants overlap by an unknown amount; their sum is not a valid canonical-document audience.

## 3. Treat the current surge as a short observation window, then triage first-run blockers

**UI copy:** “88.4% of reported repo views arrived in the last three reported days.”

October 24–26 contributes 25,846 views and 9,923 clone operations. The earlier seven-day view base is only 57, so a headline “+51,119%” exaggerates the usefulness of that baseline. The more decision-relevant signal is concentrated recent demand. Reserve attention for the open issue queue and first-run documentation during this surge, rather than interpreting star growth as evidence of successful adoption.

**Show now:** share of the rolling window in the last three reported days, its exact view count, and the reporting end date. Alongside it, show 19 issue creations and one issue closing timestamp within the traffic window. Link to the current queue of 40 open issues for triage. Do not label the difference as measured backlog growth.

**Calculation and binding:** `traffic.rows`, last three complete source buckets by date; `activity.rows`; current `maintenance.rows[0]` is a separately timed snapshot.

```text
Last-three-day views = 6,660 + 7,373 + 11,813 = 25,846
25,846 / 29,252 = 88.3564%
Last-three-day clone operations = 1,484 + 3,244 + 5,195 = 9,923
9,923 / 11,559 = 85.8465%
Earlier seven-day views = 57; later seven-day views = 29,195
Sum(activity.openedIssues) = 19
Sum(activity.closedIssues) = 1
Current maintenance.openIssues = 40
```

**Limit that changes the decision:** source day buckets are UTC, even when navigation shows Pacific reporting boundaries. Preserve the source bucket meaning. Issue creations and current closing timestamps are not a complete reopened/closed transition ledger. Queue size is current, not a period-end balance. Clone operations include repeat/automated acquisition and do not establish installations or first successful workflows.

## Do not promote these tempting comparisons

- **Video-to-repo conversion:** the three observed videos total 153,611 cumulative video views, but seven of ten known videos lack statistics. Those counts have different publication dates and observation timestamps from the GitHub referral window. Dividing 3,313 YouTube-referred repo views by cumulative video views would not produce a conversion rate.
- **Video dominance:** AI LABS has 150,399 of the 153,611 views observed for three videos, or 97.9% of that measured subset. Do not present this as 97.9% of all EGM video attention while seven videos remain unmeasured.
- **Downloads-to-clones conversion:** the release has 11 Claude ZIP and four OpenAI ZIP downloads, published October 27, after the traffic window ends October 26. Exclude seven checksum downloads from artifact downloads. Neither 15 / 11,559 nor 15 / 4,894 is an installation conversion rate.
- **Star-to-visitor conversion:** star history uses Pacific calendar dates and includes a partial October 27; repository visitor totals use the earlier GitHub traffic window. These are not a matched cohort.

The missing outcome that would change all three decisions is successful first workflow and repeat use. Until that is measured, keep the recommendations about distribution entry points, document discoverability, and issue triage rather than claiming improvements in activation or retention.
