# Dashboard upgrade audit

Audit of the EGM Growth Dashboard (egm.n3wth.com) on the October 28, 2026 snapshot. Every page (Overview, Acquisition, Adoption, Website, Development, Research, Mentions) was captured at 1440×900 and 390×844 from the production build, plus the hosted loading and error states.

Scope note: everything outside `src/content/`, `src/theme.css` and `src/data.json` is protected runtime (digest-checked on every build), and the Worker, auth and access flows are out of scope. Findings that need those layers are listed under "Needs protected or Worker changes".

Priority: **P1** misleads or blocks a reader, **P2** slows them down or hides useful context, **P3** polish.

## Findings

### Data clarity and headline KPIs

- **P1. Total stars says "Weekly change unavailable" during the biggest week on record.** 1,909 stars arrived in the last seven complete days against 0 in the seven before. `starWeeklyChange` and `weeklyChange` return nothing when the baseline week is 0, so the card hides the most important number on the page.
- **P1. Weekly deltas have no direction.** "29,195 last 7d · 57 prior 7d" is grey 12px text. Readers have to compare the two numbers themselves to tell whether a metric is going up.
- **P2. Adoption and Development KPIs are bare numbers.** Unique cloners, Clone operations (Adoption) and Merged PRs have daily data but no sparkline or weekly change, unlike the same metrics on Overview.

### Charts

- **P1. Y-axis labels are clipped on wide charts.** On Adoption "Daily clone activity", `4,500` renders as `,500` and `3,000` as `,000`. Recharts' automatic axis width is too narrow for four-digit values. The renderer already has a fixed-width mode (used by chart export) that sizes the axis from the longest label.
- **P2. Daily issue activity uses a smoothed line for small whole-number counts.** The curve overshoots between days (implying fractional issues) and hides zero days. Bars match the neighbouring "Daily merged PRs" chart.
- **P3. The top y tick is the data maximum** (`5,195` above `4,500`, `10` above `9`), which crowds the nearest tick. This is deliberate renderer behaviour; leave it.

### Navigation, onboarding and deep links

- **P1. No orientation for first-time readers.** Nothing explains what the dashboard measures, that GitHub only keeps 14 days of traffic, that referrers are top-ten only, or what each of the seven unlabeled icon tabs contains. The audience is about 40 colleagues, most of whom will visit occasionally.
- **P2. In-page links reload the whole app.** Links like "Acquisition ↗" and "Website ↗" are plain `<a href>`. The Worker serves HTML with `cache-control: private, no-store`, so each click re-downloads the 1.1 MB (gzip) single-file app and re-fetches the snapshot. The shell already has an in-app navigation function.
- **P2. No way forward at the end of a page.** Pages end abruptly, and on mobile only two of seven tab icons are visible without horizontal scrolling. There is no "next page" path through the dashboard.
- **OK. Deep links work.** `/overview`, `/acquisition` and the other pages are real paths, and the production build opens them directly. (The Vite dev server always lands on `/overview` because StrictMode double-registers tabs in the shell; this only affects development.)

### Mobile

- **P2. The four Overview KPIs stack one per row**, taking about 800px (most of the first screen) before any chart. The same happens with the three Development metrics.
- **P3. Topbar icons scroll horizontally with no cue** (protected chrome).
- **P3. Overview video thumbnails are three across at 390px** and hard to read.

### Performance

- **P2. The app is one 4.3 MB HTML file (1.1 MB gzip).** LCP is about 0.7s on a fast connection and about 6s at roughly 1.6 Mbps. Largest inputs before minification: app source 1.46 MB, recharts 0.99 MB, `ai` SDK 0.77 MB, react-dom 0.53 MB, `@radix-ui/react-icons` 0.48 MB, zod 0.36 MB, posthog 0.33 MB, parse5 0.27 MB, WorkOS widgets 0.27 MB, `data.json` 0.21 MB.
- **P2. Nothing is cacheable.** HTML and assets are `private, no-store`, so repeat visits pay the full download.

### Loading, empty and error states

- **OK. Hosted loading shows a good skeleton** that matches the final layout.
- **P2. The hosted error state is one line of plain text** ("Data app snapshot is unavailable.") with no retry, no explanation and no chrome.
- **P3. The stale-data notice repeats on every page** and pushes content down; it could be quieter once a reader has seen it.
- **OK. Empty charts and tables use a shared, consistent empty state.**

### Accessibility

- **OK.** Focus outlines are visible, icon tabs have `aria-label`s, chart descriptions are exposed, and motion respects `prefers-reduced-motion`.
- **P3. Tab names exist only as tooltips and aria labels**, so sighted readers have to hover to learn where an icon goes. The page footer and welcome card below give them a labelled path.

## Implemented in `feat/dashboard-upgrade`

All changes are inside `src/content/`, reuse existing colour variables, and add no dependencies.

1. **First-run welcome card** on Overview: explains what the dashboard measures, the 14-day window, the top-ten referrer limit, and links every page with a one-line description. It is dismissible, and the dismissal is remembered in the browser.
2. **Weekly change that never hides a surge**: a zero-baseline week still reports both counts, and every weekly line now leads with a signed delta in the existing movement colours (up, down or flat).
3. **KPI parity**: sparklines and weekly change for Adoption clone operations, a sparkline for unique cloners, and a sparkline plus weekly change for Merged PRs.
4. **Readable chart axes**: charts size their y-axis from the longest label, so four-digit values are no longer clipped. Daily issue activity is now a bar chart.
5. **In-app navigation for in-page links**: page links switch tabs without reloading the app, and still open normally with a modifier key or middle click.
6. **Previous/next page footer** on every page, labelled with page names.
7. **Two-up KPI cards on phones**, so the Overview metrics take half the height.

## Next steps

Done in the second round:

- **Cached, split bundle.** The single-file build is replaced by content-hashed chunks grouped by library. The Worker serves hashed `/assets/*` files as `private, max-age=31536000, immutable`; the HTML shell and `/api/*` stay `no-store`. Repeat visits download about 121 KB instead of 1.2 MB.
- **A real error screen** for a failed snapshot fetch, with Try again and Reload page buttons. It retries automatically when the browser comes back online.
- **Longer history.** Each scheduled refresh merges GitHub's 14-day traffic window into a retained `traffic_history` query in the existing snapshot row, and the daily traffic charts have a date range filter.

Still open:

- **Lazy-load the Ask panel, WorkOS widgets and editing tools.** Chunks are all static imports today: a deploy removes the previous chunks, so a lazy chunk could 404 in a tab opened before the deploy. Lazy loading needs a reload-on-missing-chunk fallback first. Replace the full `@radix-ui/react-icons` import with the icons in use.
- **A Feedback link on the error screen** once the Feedback flow can open without loaded data.
- **Labelled tabs on wide screens, or a scroll cue on mobile** in the topbar (protected chrome).
- **Fix the dev-only deep-link redirect** caused by StrictMode double registration in `registerDashboardTabs` (protected shell).
