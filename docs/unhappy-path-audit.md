# Unhappy-path audit: EGM Growth Dashboard

Read-only audit of critical user journeys. Date 2026-10-29, branch worktree-agent-a8797f7e09ca185e0 at 0baf504.
Paths are relative to the repo root. W = egm-cloudflare/worker.mjs unless another file is named.

## Method and limits

- Read: worker.mjs, auth-pages.mjs, invitations.mjs, access-management.mjs, approval-events.mjs, grok-notify.mjs, feedback-events.mjs, ask.mjs, ask-stream.mjs, gemini.mjs, refresh.mjs, refresh-runner.mjs, workos-*.mjs, owner-identity.mjs, mcp-permission.mjs, request-body.mjs; frontend live-snapshot.js, hosted-query-bootstrap.js, DataAppRuntime.jsx, DataAppChrome.jsx, ask-transport.mjs, ask-stream.mjs, Feedback.jsx, ManageUsers.jsx.
- Ran: `cd egm-cloudflare && node --test *.test.mjs` -> 208 tests, 208 pass, 0 fail (invitations test did not flake this run).
- Ran: `cd egm-performance && node --test tests/*.test.mjs src/content/dashboard/*.test.mjs` -> 56 pass, 4 fail. All 4 fail with ERR_MODULE_NOT_FOUND "Cannot find package 'react'" (node_modules not installed in this worktree). Environmental, not a code defect.
- Ran one experiment in the in-app Chromium: same-origin form POST under `Referrer-Policy: no-referrer` sends `Origin: null`; under `same-origin` it sends the real origin. Local throwaway server in the scratchpad, since stopped. Basis for finding F1.
- Not verified: Safari/Firefox behavior for F1 (Fetch spec says the same, not exercised); built index.html and the exact ASSETS 404 body (assets/ in the repo holds only fonts and favicon; the SPA bundle is built at deploy); real WorkOS, Gemini, PostHog, Resend responses (no network calls made); egm-performance/src/data-app-worker.js is the generic template Worker and is not what egm.n3wth.com runs (wrangler.jsonc `main` is worker.mjs), not audited.
- No code edited. No account enumeration or exploitable security flaw found (section 15). No data-loss path found.

## Findings that matter most (ranked)

- F1 P1 (blocks invite acceptance and sign-out on pending/denied): auth pages send `Referrer-Policy: no-referrer`, so their form POSTs carry `Origin: null` and the Worker rejects them with raw JSON 403 `invalid_origin`. Affects "Continue with Google" on /auth/invite and "Sign out" on pending/denied pages. See sections 3 and 4.
- F2 P1: session hard-expires 60 minutes after login with no renewal, and the SPA has no 401 handler or sign-in link. Open tabs go stale silently; Ask, Feedback, Manage Users say "try again" forever. Section 2.
- F3 P1: sign-in callback failures return plain text or bare 503 with no way back (Google consent cancelled, flow cookie expired after 10 minutes, WorkOS timeout, D1 error). Section 1.
- F4 P1: signed-out deep links (`/_data/charts/<id>` permalinks the app itself generates, any non-tab path) return raw JSON 401; login always lands on /overview. Sections 2 and 14.
- F5 P1: with WORKOS_WIDGETS_ENABLED (set in wrangler.jsonc) every authenticated request, including each static asset and each 5 s snapshot poll, makes at least 4 uncached WorkOS calls and fails closed with 503 when any fails. Owner admin checks fail the same way but report 403 `owner_required`. Sections 2 and 6.
- F6 P1: no way to revoke an approved user or undo a denial; a denied person invited by the owner sees a misleading "invitation unavailable" page. Sections 5 and 6.
- F7 P1: no staleness signal anywhere. `refreshStatus` is written but never read; GitHub collector failure and REFRESH_UNTIL expiry (2026-11-04T06:33:01Z, 6 days out) change nothing visible. Sections 9 and 10.
- F8 P1: feedback submit depends on a live PostHog survey fetch; any PostHog problem blocks storing feedback that D1 could have stored; all failure codes show one generic message. Section 11.
- F9 P1: MCP returns 401 for WorkOS outages and for valid-but-non-owner tokens, so clients loop into re-auth. Section 12.

P0 (data loss or security): none found.

## 1. First sign-in

Happy path: GET / -> sign-in page -> GET /auth/login (W:211-230) -> WorkOS/Google -> GET /auth/callback (W:231-274) -> user row (owner approved, others pending, W:249-253) -> session -> 302 /overview -> dashboard or pending page.

Branches:
- User cancels at Google, or WorkOS redirects with `?error=...` and no `code`.
  - Today: 400 `text/plain` "Invalid sign-in state", only a cookie-clear header (W:234). No page, no link.
  - UI: browser shows bare text. Not acceptable. P1.
  - Fix: render `renderAccessPage('error')` (auth-pages.mjs:11) instead of the plain Response at W:234; keep the clear-cookie header. Same fix covers the next three rows.
- Flow cookie `__Host-egm_flow` expired (10 min lifetime, W:227), missing (cookies blocked), or the callback URL is reused via Back.
  - Today: same plain 400 (W:234). Slow Google 2FA or a user who leaves the tab for 10 minutes hits this. P1.
- WorkOS authenticate call times out or throws (10 s signal, W:235).
  - Today: exception reaches the outer catch: 503 `text/plain` "Temporarily unavailable" (W:373). No retry link. P1. Fix: wrap W:235-237 in try/catch and render the `error` or `session_unavailable` page (auth-pages.mjs:11,14).
- WorkOS returns non-2xx (bad or reused code).
  - Today: HTML "Sign-in did not complete", status 401, button to /auth/login (W:236, auth-pages.mjs:11). Acceptable.
- Email not verified.
  - Today: HTML 403 "Verify your email" (W:238, auth-pages.mjs:12). Acceptable. Button loops back to login, fine.
- Same email already stored under a different WorkOS id, or email change conflict.
  - Today: HTML 403 "needs a review" (W:241-242). Tells the user to ask Oliver but gives no contact route. P2.
- D1 failure on the user SELECT/INSERT (W:240, W:250) or sessions INSERT (W:255), including a duplicate-callback race on the users primary key.
  - Today: uncaught -> 503 `text/plain` (W:373). P1 (same fix as WorkOS timeout: catch and render `session_unavailable`).
- WorkOS session storage fails with widgets enabled (W:260-263) or WorkOS session config missing (W:266-268).
  - Today: session row deleted, HTML "Sign-in did not complete". The exception from `storeWorkosSession` is swallowed with `catch {}` (W:260): no log, operator cannot tell a missing migration from a transient error. P2: add `console.error` with a reason code.
- Invitation redeem throws (W:246).
  - Today: HTML "Sign-in did not complete" whose button goes to plain /auth/login. The invite cookie was already cleared at W:228 and the token lives only in the flow cookie, so retry creates a pending request instead of using the invitation. P2. Fix: on this path render an error page whose action returns to the original /auth/invite link, or keep the invite cookie until callback success.
- Third-party-cookie or cookie-blocking browsers.
  - Callback sets the session cookie then redirects to /overview (W:270-273); if the cookie is dropped the user sees the sign-in page again with no explanation. Not verified in a browser; P2.
- Tests: none for callback error branches (worker.test.mjs has no /auth/callback case).

## 2. Returning sign-in with expired session

Happy path: cookie valid -> `identity()` (W:51-75) -> dashboard.

Facts:
- D1 session `expires_at = now + 3600` (W:255) and cookie Max-Age defaults to 3600 (W:44, W:272). Hard 60-minute cap, never extended. WorkOS token refresh (workos-session.mjs:66-85) only keeps the WorkOS side alive inside that hour.
- Expired `sessions` rows are never purged. The cron cleanup only deletes `workos_sessions` rows (W:376). Table grows by one row per login. P2: add `DELETE FROM sessions WHERE expires_at<?` to `scheduled()`.

Branches:
- Navigation after expiry (GET /, /overview, other tab paths in `pagePaths`, W:180).
  - Today: 200 HTML sign-in page with noindex (W:281-283). Acceptable.
- Navigation to any other path while signed out (deep link, e.g. `/_data/charts/<id>`, `/_data/components/<id>`, which the app generates: egm-performance/src/chart-permalink.js:1-2,194).
  - Today: 401 JSON `{"error":"sign_in_required"}` rendered raw in the browser (W:282). After signing in the callback always redirects to /overview (W:270), so the target is lost. P1.
  - Fix: in W:282, for GET requests that accept HTML and are not /api/ or have an asset extension, render the sign-in page (or 302 /auth/login) and carry a signed `return_to` through the flow cookie (W:227) to W:270. File: worker.mjs.
- Tab left open past 60 minutes.
  - Live snapshot poll gets 401 and silently stops: `stopped = true; return` (egm-performance/src/live-snapshot.js:18,26). No banner, header still shows an old "Updated" age.
  - Ask: message "Your session expired. Sign in again to ask a question." (ask-transport.mjs:3) with no link or button.
  - Feedback: submit fails with "Could not send feedback. Please try again." (Feedback.jsx:43-44); retry can never succeed. Loading the survey fails with "Feedback is unavailable right now" (Feedback.jsx:26-28,53).
  - Manage Users: "Could not load users." (ManageUsers.jsx:43); action failures "Could not update access." (ManageUsers.jsx:71).
  - Owner tab: the access-live WebSocket reconnects every 2 s with no backoff or stop on 401 (DataAppChrome.jsx:605,609).
  - No global 401 handling exists: only ask-transport.mjs:3, live-snapshot.js:18,26 and WorkosSessions.jsx:10 mention 401. P1.
  - Fix: one shared fetch wrapper (frontend agent) that on 401 shows a persistent "Session expired. Sign in" banner linking to /auth/login and stops polling/retry loops; and consider a sliding session (extend `expires_at` and cookie on use) in worker.mjs `identity()` so an active user is not cut off at 60 minutes. Decide policy; a hard cap may be intentional.
- WorkOS verification unavailable (any WorkOS call fails) while the cookie is fine.
  - Today: HTML 503 "Temporarily unavailable" with a "Try again" link for documents (W:276-278, auth-pages.mjs:14,23), JSON 503 `session_verification_unavailable` for APIs and assets. Acceptable message, but see F5.
  - F5 detail: `identity()` with WORKOS_WIDGETS_ENABLED calls `validatedWorkosSession` (W:58): JWKS fetch twice (workos-widgets.mjs:21 via workos-session.mjs:64 and :86, no cache), `workosSessionState` sessions list (workos-widgets.mjs:41-45, up to 3 pages), then `readVerifiedWorkosEmail` (W:68, workos-identity.mjs:7). At least 4 outbound calls per request, 4-5 s timeouts each, on every asset and API request, and the poll runs every 5 s per visible tab (live-snapshot.js:2). A WorkOS slowdown or rate limit makes the whole dashboard 503 for valid users. P1. Fix: cache the verified result for 30-60 s in D1 or isolate memory keyed by session id, cache JWKS (the MCP path already does, W:82,105-109), and skip `identity()` WorkOS checks for static asset requests.
- WorkOS session revoked.
  - Today: D1 session rows deleted, request treated as signed out (W:59-65): 401 on API, sign-in page on navigation. Silent in open tabs (same as the 60-minute case).

## 3. Invited user accepting a link

Happy path: owner creates link or email invitation (invitations.mjs:22-82) -> recipient opens `/auth/invite?invitation_token=...` -> 303 to `/auth/invite` with 10-minute sealed cookie (W:200-208) -> invite page -> POST `/auth/invite/continue` (W:211-229) -> Google -> callback redeems (W:245-248, invitations.mjs:86-97) -> approved -> /overview.

Branches:
- F1: clicking "Continue with Google" on the invite page.
  - Today: the page is served with `referrer-policy: no-referrer` (auth-pages.mjs:45). In Chromium a same-origin form POST then carries `Origin: null` (experiment above). W:213 requires `Origin === APP_URL`, so it returns 403 JSON `{"error":"invalid_origin"}` shown raw. The invite flow cannot proceed. P1, highest priority.
  - Not covered by tests: worker.test.mjs never exercises /auth/invite/continue; tests set `origin` by hand.
  - Fix: in auth-pages.mjs:45 change `referrer-policy` from `no-referrer` to `same-origin` (footer links already use `rel="noreferrer"`, auth-pages.mjs:45). Do not "fix" by accepting `Origin: null`; sandboxed frames and data: pages also send it. Keep `no-referrer` on the 303 at W:208 (the redirect carries the token URL). Add a test that asserts the header value.
- Invitation valid.
  - Behaves as above. Email scanners and link unfurlers that GET the link do not consume it: the GET only validates and sets a cookie (W:205-208). Good.
- Expired, revoked, already used, or unknown token at /auth/invite.
  - Today: HTML 403 "This invitation is unavailable" listing all causes (W:203,206, auth-pages.mjs:15). Button "Sign in with Google" goes to /auth/login. Acceptable. The copy does not distinguish "used" (signing in normally works if they were approved) from "expired" (needs a new invite); P2.
- Invite cookie expired (more than 10 minutes between opening the link and pressing Continue).
  - Today: same "unavailable" page even though the invitation is still valid (W:214-216). Copy does not say "open the link from your email again". P2.
- Expired/revoked/used between page view and Continue, or between Continue and callback.
  - Today: same invite_invalid page (W:218-220, W:247). Acceptable.
- Wrong Google account for an email-bound invitation.
  - Redeem UPDATE requires `email IS NULL OR email=?` (invitations.mjs:91); fails; callback returns invite_invalid 403 (W:247). Invitation stays valid. The wrong-account person is not recorded as a pending request (early return before W:249). Page text says "sent to a different email address". Acceptable. P2: no hint to use the invited address beyond the generic list.
- Person previously denied.
  - Redeem blocked by `status='denied'` in the NOT EXISTS clause (invitations.mjs:91); user sees the same "invitation unavailable" page with no reason, owner has no way to un-deny (section 5). P1 for the owner's mental model. Fix: separate invite_denied copy, or allow an owner-issued invitation to reinstate (policy decision).
- Already-approved user clicks an invite for their own email.
  - Redeem succeeds (NOT EXISTS passes for matching id/email) and burns the invitation (invitations.mjs:91). Harmless.
- DB error while checking the invitation at /auth/invite.
  - HTML 503 `session_unavailable` (W:207, W:219). Acceptable.
- Email invitation delivery failures (owner side).
  - 4xx from Resend -> `email_delivery_rejected` 502 and invitation revoked (invitations.mjs:58-62); timeout or 5xx -> 202 `email_delivery_unknown` (invitations.mjs:63-72) and UI notice "Email delivery is unconfirmed" (ManageUsers.jsx:85-86). Acceptable. 409 collapses "already exists" and "save failed" into one message (invitations.mjs:54, ManageUsers.jsx:82). P2.

## 4. New user requesting access and waiting for approval

Happy path: callback inserts `pending` row (W:249-250), fires approval webhook flush and Grok flush and the owner live-badge signal (W:251-252) -> pending page (W:285).

Branches:
- Pending page "Sign out" button.
  - Same F1 defect: pending/denied pages are rendered with `referrer-policy: no-referrer` (auth-pages.mjs:45), the form POSTs to /auth/logout (auth-pages.mjs:27), W:190 requires Origin = APP_URL, so Chromium sends `Origin: null` and the user gets raw JSON 403. A pending or denied user cannot sign out or switch Google accounts without clearing cookies. P1. Same one-line fix.
- Waiting.
  - Pending page is static: no refresh, no polling, no email (auth-pages.mjs:9). After approval the user must reload. Nothing tells the requester the decision (section 5). P2. Fix: a Resend email on decision reusing the invitations.mjs plumbing, or a manual "Check again" link on the pending page (the `retry` view style, auth-pages.mjs:14,23).
- Session expiry while waiting: returning later goes through sign-in again and lands on the pending page, no new request created because `existing` is found (W:240,249). Correct.
- Status response for APIs: pending/denied users get the HTML 403 page for every path including /api/* (W:285). Only relevant for tabs left open across a status change (section 6).
- Pending request creation when notification channels fail: see section 5; the request is still stored and visible in Manage Users.

## 5. Approval or denial by the owner, including notifications

Happy path: owner opens Manage Users -> POST /api/access (W:312-318, access-management.mjs:47-69) or MCP `decide_access_request` (W:156-166) -> status updated, audit row, `accessChanged` pushes live-badge refresh (W:316, W:164).

Branches:
- Request already decided (double click, MCP and UI race).
  - 409 `not_pending` -> "This request was already decided. Refresh the list." (access-management.mjs:68, ManageUsers.jsx:71). MCP: -32602 "Request missing or already decided" (W:162). Acceptable.
- Owner tries to act on an approved or denied user: no UI (ManageUsers.jsx:125 shows actions only for pending) and no API path; both updates require `status='pending'` (access-management.mjs:65, W:161). There is no revoke, no re-approve, no undo of an accidental deny. P1. Fix: allow `approved->denied` and `denied->approved` transitions with an audit row, in access-management.mjs and the Manage Users list.
- Requester notification: one email on a pending-to-decided transition, scheduled with `ctx.waitUntil` after the decision is saved (`decision-email.mjs`, access-management.mjs, mcp-server.mjs). Approval requires `DECISION_EMAIL_ENABLED=true` and `RESEND_API_KEY`. Denial also requires `DECISION_DENY_EMAIL_ENABLED=true`. Both flags default off, and nothing scans older decisions. The send is claimed in `decision_notifications` before Resend is called, with Idempotency-Key `egm-decision/<userId>/<decision>`, so a retry, double-click, second path, or later re-approve does not send again. Delivery failure is logged and does not change the decision. Revoke and reinstate do not email. The `accessChanged` socket still reaches owner sockets only (access-live.mjs).
- Owner notification of a new request (three channels, all best effort):
  - MCP webhook subscription: only active while `expires_at>now`, default TTL 24 h, max 7 days (approval-events.mjs:87-88,113); MCP client must re-subscribe or notifications stop, silently.
  - Per-request cap: `attempts<12` (approval-events.mjs:121). Subscription id is a deterministic hash (approval-events.mjs:81-82) so re-subscribing reuses the same receipts; a request that exhausted 12 attempts during a webhook outage is never retried for that subscription. Failure is swallowed (approval-events.mjs:133, grok-notify.mjs:35, feedback-events.mjs:164) with no log at exhaustion. P2: log a sanitized "notification gave up" line when `attempts` reaches 12.
  - Grok sink: only if URL and key configured (grok-notify.mjs:11-14); unconfigured is silent.
  - In-app badge (`/api/access-pending` + `/api/access-live`, W:297-308) is the reliable channel; it only works while an owner tab is open and the session is alive.
- Owner session sees the Manage Users list truncated at 200 users (access-management.mjs:50) and 100 invitations (invitations.mjs:26) with no indication. P2.
- Owner misclassified as non-owner: `accessManager` returns false for any WorkOS lookup failure, lease contention (`retryable`) or JWKS fetch failure (W:80, workos-session.mjs:106-121, workos-rbac.mjs:23,31). The API answers 403 `owner_required` (access-management.mjs:48) and the UI says "Only the dashboard owner can manage access." (ManageUsers.jsx:43); the Manage Users button can vanish (`canManageAccess` from /api/presentation, W:325-330). P1. Fix: return 503 `access_check_unavailable` when the permission result is `retryable` or a thrown error, 403 only for `denied`.
- `ManageUsers.jsx:63` swallows list-refresh errors from live updates (`.catch(()=>{})`). P2.
- MCP decide path does not check that the target user is `verified=1`; harmless because the users table CHECK enforces verified=1 (schema.sql:3).

## 6. User removed while signed in

There is no in-product removal. Observable cases:
- Status set to denied directly in D1 (only way, see section 5): next request gets the HTML 403 "Access is unavailable" page for every path including APIs (W:285). Open tab keeps the already loaded data; live poll treats 403 as "stop" silently (live-snapshot.js:18,26); Ask says "Your account does not have access to Ask." (ask-transport.mjs:3). No banner, no redirect. P2.
- User row deleted: `sessions.user_id` references users(id) (schema.sql:6). Deleting a user with sessions would violate the FK if D1 enforces it; not verified (no D1 run). Not a supported path.
- WorkOS session revoked or user deleted in WorkOS: handled in `identity()` (W:59-66): D1 session rows deleted, request becomes signed out (401 / sign-in page). Open tab: silent as in section 2.
- Role removed in WorkOS: admin features fail with 403 `owner_required` / 'denied' (workos-session.mjs:106-130); next sign-in re-scopes. Open tab keeps stale `canManageAccess` until reload. P2.

## 7. Ask question under each failure

Happy path: POST /api/ask (W:311, ask.mjs:82-155) streams NDJSON; client AskTransport consumes it (ask-transport.mjs:23-91).

Pre-checks, all JSON with no-store (ask.mjs:3): not approved 403 (:83), non-POST 405 (:84), bad Origin 403 `invalid_origin` (:85), wrong content-type 400 `json_required` (:86), body >24000 bytes 413 (:87,94), bad JSON 400 (:99), empty/long question 400 (:101), bad history 400 (:103).
Client mapping (ask-transport.mjs:3): 401 session expired, 403 "does not have access", 429 hourly limit, 400/413 "Use a question between 1 and 1,200 characters", 504 too long, everything else "Ask is temporarily unavailable".

- Timeout (20 s, ask.mjs:147).
  - Non-stream: 504 `ask_timeout` (ask.mjs:154). Stream (what the UI uses): HTTP 200 with a `{type:error,error:ask_timeout}` event (ask-stream.mjs:54), client shows "The answer took too long. Try again." (ask-stream.mjs client:13). Acceptable. The Gemini fetch has no abort signal (gemini.mjs:49), so a timed-out call keeps running until the isolate ends; P2.
- 429 own quota (200 per rolling hour per user, ask.mjs:118-119).
  - 429 `rate_limited`, no `Retry-After` header. Client text "Try again later" gives no time. P2: add `Retry-After` and reset time. The quota row is inserted before the model runs (ask.mjs:118), so provider failures and timeouts burn quota. P2.
- Gemini down, 5xx, 429, 401 (invalid key), or malformed stream.
  - All collapse to `provider_failed` -> 503 `ask_unavailable` (gemini.mjs:53, ask.mjs:154) or a stream error event (ask-stream.mjs:54). Nothing is logged in ask.mjs:154, ask-stream.mjs:54 or gemini.mjs. The operator cannot tell quota exhaustion from an invalid key from an outage. P1 (observability). Fix: `console.error('Ask provider failed', status)` with the HTTP status only (no body, no key) in gemini.mjs:53.
  - gemini.mjs:52 retries once on any 400 including an invalid-key 400; harmless duplicate.
- Missing GEMINI_API_KEY.
  - `geminiRunner` returns null (gemini.mjs:46), ask.mjs:108 returns 503 `ask_unavailable` before any quota is spent. User sees the generic "temporarily unavailable" forever; no log. P2: log once per isolate.
- Snapshot unavailable (no snapshots row, or no usable context).
  - 503 `snapshot_unavailable` (ask.mjs:113,116). Inconsistent with the dashboard: /api/snapshot falls back to the bundled seed (W:355) while Ask refuses. Client shows the generic 503 text. P2.
- D1 error during snapshot read or quota insert: outer catch -> 503 `ask_unavailable` (ask.mjs:154). Acceptable.
- Live GitHub lookup fails: degrades, answer uses saved data and says "Unavailable, saved data shown" (ask.mjs:125-132). Acceptable.
- Expired session: 401 JSON `sign_in_required` from W:282 -> "Your session expired..." with no link (section 2).
- Pending/denied account: HTML 403 page body (W:285) read by a client that only checks status. Acceptable.
- 403 `invalid_origin` also shows "Your account does not have access to Ask." (ask-transport.mjs:3). P2, misleading.

## 8. Dashboard load, snapshot or collector stale or failing

Happy path: SPA loads, `loadHostedSnapshot` fetches /api/snapshot and /api/presentation (DataAppRuntime.jsx:44-47, hosted-query-bootstrap.js:26-28); live poll every 5 s (live-snapshot.js:2).

- /api/snapshot or /api/presentation fails on first load (D1 error, WorkOS verification 503).
  - Whole page replaced by one line of text: "Data app snapshot is unavailable." or "Data app presentation is unavailable." (hosted-query-bootstrap.js:27, DataAppRuntime.jsx:46,75-77). No retry button, no sign-in link. P1 (frontend agent). A 401 shows the same text.
- Snapshot row missing: /api/snapshot silently serves the bundled seed (W:352-355). The only hint is the "Updated" age label in the header. P2.
- Live poll failures: caught and backed off up to 10 minutes with no UI (live-snapshot.js:37-38). Data on screen can be arbitrarily old with no marker. P1.
- Header age label exists (DataAppChrome.jsx:70-96) but has no stale styling or threshold.
- `refreshStatus` (per-collector outcomes and checkedAt) is written to the snapshot (refresh-runner.mjs:150) and no frontend code reads it (rg over egm-performance/src finds no consumer). P1. Fix: surface "Data last refreshed X; N sources failed" from `snapshot.refreshStatus`, escalate when `checkedAt` or `generatedAt` is older than ~2 h (cron is every 30 min, wrangler.jsonc).
- Partial collector failure: runner keeps the previous rows for that provider (refresh-runner.mjs:61-63) and records `failed` in `refreshStatus` only. Per-card notes exist for web performance and research (DashboardContent.jsx:174-181, Research.jsx:54,76,105, Mentions.jsx:68) but not for GitHub traffic, stars, referrers, which come from `refreshSnapshot`.
- GitHub collector failure is swallowed (refresh-runner.mjs:49-52): no log of why (missing token throws 'GitHub credential unavailable' at refresh.mjs:11). Result status becomes `partial` (refresh-runner.mjs:153) and the cron still exits success; W:384 logs the state object only.
- Star history stale: caveat added to the query (refresh.mjs:86-90) and shown only where DashboardContent.jsx:108 reads it.

## 9. Feedback submit failing

Happy path: Feedback.jsx loads survey (GET /api/feedback -> PostHog, feedback-events.mjs:23-35), POST stores a row and flushes (W:286-291).

- Survey load fails (PostHog down, token missing, survey definition drifted from the strict checks at feedback-events.mjs:32): 503 `unavailable` -> dialog "Feedback is unavailable right now" (Feedback.jsx:26-28,53). Acceptable.
- Submit: the POST handler re-fetches the PostHog survey as a gate (feedback-events.mjs:81-83). A PostHog outage or timeout (5 s) returns 503 and the feedback is not stored, though D1 could store it and the flush queue already retries PostHog delivery (feedback-events.mjs:129-138). P1. Fix: drop the live survey fetch at submit, or make it advisory and store regardless.
- All server codes show the same text "Could not send feedback. Please try again." (Feedback.jsx:43-44): 429 `rate_limited` (10 per hour, feedback-events.mjs:86-88) will fail on every retry; 409 `survey_changed` (:83) needs a reload of the survey; 401/403 need sign-in; 413 and 400 are client bugs. P2/P1 together: map 401 to sign-in, 429 to "limit reached", 409 to refetch.
- Message text is preserved in the textarea on failure (Feedback.jsx:44 does not clear state). Good.
- Retry is idempotent by client id (`INSERT OR IGNORE`, feedback-events.mjs:86-89). Good.
- Origin or content-type mismatch returns 403 `invalid_request` for both (feedback-events.mjs:73), unlike other endpoints that use 415 for content-type. P2.
- Error responses omit `cache-control` (feedback-events.mjs:71-90, 95-111 use bare `Response.json`; only success sets no-store). P2.
- Downstream delivery to the owner (MCP webhook, Grok, PostHog) retries up to 12 attempts then stops silently (feedback-events.mjs:152, grok-notify.mjs:32, feedback-events.mjs:121,131 hourly backoff). Items are always in D1. P2: log on exhaustion.

## 10. Refresh job failing or expiring (REFRESH_UNTIL)

Happy path: cron every 30 min (wrangler.jsonc) -> `scheduled()` (W:374-386) -> `runRefresh` (refresh-runner.mjs:19-159) -> merged snapshot committed under a lease.

- REFRESH_UNTIL passes (2026-11-04T06:33:01Z, wrangler.jsonc).
  - `runRefresh` returns `{status:'expired'}` immediately (refresh-runner.mjs:22-23) before any collector runs; W:384 logs it; cron reports success. Snapshot stops updating. No collector writes an `expired` status row because none run, so the only UI message is the web-performance note that depends on a `collectionEndsAt` stored earlier (DashboardContent.jsx:174-176). Everything else just goes stale with no banner. P1.
  - POST /api/refresh when expired returns 200 `{status:'expired'}` (W:321) and nothing in the UI calls it (no `/api/refresh` reference in egm-performance/src). The owner has no in-product way to see or extend the window; it is a deploy-time var.
  - Fix: before expiry (and at expiry) write `refreshStatus.expired=true` and a banner "Automatic refresh ended <date>"; have the cron log a warning N days before `REFRESH_UNTIL`.
- Runner throws (D1 down at the snapshot SELECT, refresh-runner.mjs:41): `finally` clears the lease (refresh-runner.mjs:157), `scheduled()` throws "EGM refresh failed" (W:385), cron shows as failed. This is the only loud failure path. Original error is discarded (W:385). P2.
- Lease contention or cooldown: `{status:'skipped', reason:'running_or_cooldown'}` (refresh-runner.mjs:26). Fine.
- Lease lost mid-run: skipped, nothing committed (refresh-runner.mjs:151-152). Fine, but a lost lease leaves no log line beyond the returned object.
- Wall-clock: 10-minute internal deadline, collectors after it recorded `skipped_deadline` (refresh-runner.mjs:28,64). No UI mapping.
- Manual refresh by owner: origin mismatch and not-owner both return 403 `owner_required` (W:320); GET returns 404 `not_found` rather than 405 (W:358). Unhandled `runRefresh` exception returns the plain-text 503 (W:373) rather than JSON. P2.

## 11. MCP endpoint auth failures

Happy path: Bearer RS256 token from WorkOS Connect -> `mcpOwner` (W:85-118) -> JSON-RPC (W:119-170).

- Every failure in `mcpOwner` returns `false` and the route answers 401 JSON `{"error":"unauthorized"}` with `WWW-Authenticate: Bearer resource_metadata=...` (W:121). Reasons are logged without token content (W:84). Good for enumeration; the 401 has no `error="invalid_token"` parameter. P2.
- WorkOS JWKS fetch failure, WorkOS membership lookup failure, any exception: also 401 (W:107, W:114, W:117). A WorkOS outage makes clients think the token is bad and restart OAuth. P1. Fix: return 503 (with Retry-After) for `jwks_fetch` and `exception` reasons.
- Valid token for a non-owner user: 401 (W:116, reason `not_owner`), not 403. Client loops into re-auth. P2.
- JWKS cached 5 minutes with no refetch on unknown `kid` (W:105-111): key rotation breaks every token for up to 5 minutes (reason `jwks_kid`). P2. Fix: refetch once on kid miss.
- Wrong method after auth: 405 `text/plain` "Use POST" without `Allow` or no-store (W:122). P2.
- Oversized body: 413 `{error:'too_large'}` (W:123-124); bad JSON: 400 `{error:'invalid_json'}` (W:126). Both are non-JSON-RPC shapes. MCP clients expect `-32700`/`-32600`. P2.
- JSON-RPC batches (arrays) get -32600 over HTTP 200 (W:129). Acceptable.
- Unknown method -32601; invalid tool args -32602 (W:146,166,169). DB errors in `tools/call` are uncaught and surface as plain 503 (W:159, W:373). P2.
- No `Origin` validation on /mcp. Bearer auth makes it low risk; spec recommends it. P2.
- Discovery: only `/.well-known/oauth-protected-resource` is served (W:178). The RFC 9728 path-suffixed form `/.well-known/oauth-protected-resource/mcp` falls through and returns 401 JSON `sign_in_required` (W:282) instead of metadata or 404. WWW-Authenticate points to the root form so compliant clients still work. Not tested against a real client. P2.
- Tests: mcp-permission.test.mjs and worker.test.mjs cover the 401 for anonymous /mcp (worker.test.mjs:50-53). No test for 503-vs-401 on IdP failure.

## 12. Unknown routes and wrong methods

- Wrong host: 404 `text/plain` "Not found", no no-store (W:173).
- Missing SESSION_SECRET or under 48 chars: 503 `text/plain` "Configuration incomplete", no no-store (W:177). Expected to be an operator-only state.
- Signed out, any GET except `/` and the eight tab paths (`overview, reach, website, development, acquisition, adoption, research, mentions`, W:180): 401 JSON `sign_in_required` (W:282). Includes `/robots.txt`, `/favicon.ico`, deep links (F4). Any signed-out non-GET: 401 JSON, including HEAD / (W:282).
- Signed in, GET on an unknown path without an extension (`/nonsense`): 200 index.html (W:359-361). The SPA ignores the unknown path and shows the default tab (readDashboardUrlState, dashboard-url-state.js:181-189). Soft 404, URL stays wrong. P2.
- Signed in, unknown path with an extension (`/nope.js`): whatever ASSETS returns (404 expected; wrangler.jsonc sets no `not_found_handling`), headers rewritten no-store. Body not verified.
- Signed in, unknown `/api/*` GET: 404 JSON `not_found` (W:358).
- Signed in, wrong method on a known API:
  - /api/refresh GET: 404 `not_found` (W:319,358), misleading; should be 405. P2.
  - /api/snapshot or /api/snapshot-version with POST/PUT/DELETE, or any page path with those methods: 405 `text/plain` "Method not allowed" with no `Allow` header and no no-store (W:357). P2.
  - /api/presentation: PUT/GET only, others 405 JSON (W:333). /api/access, /api/invitations, /api/ask, /api/feedback, /api/workos-widget-token: 405 JSON from their handlers. Consistent enough.
  - /auth/logout GET: 405 `text/plain` "Use POST" (W:189). A user who bookmarks or follows a logout link sees bare text. P2.
  - /auth/login POST and /auth/callback POST: fall through to 401 JSON. P2.
- Pending or denied users: every path returns the HTML 403 page (W:285), including favicon and asset paths.
- Tests: no test for unknown routes or wrong methods beyond logout (worker.test.mjs:100).

## 13. Malformed or oversized requests

All body readers cap by Content-Length and by streamed bytes (request-body.mjs:2-23; ask.mjs:87-98).
- /api/presentation PUT: 130000 bytes -> 413 `too_large` (W:336-337); not JSON content-type 415 (W:335); invalid or `verification` set -> 400 `invalid_presentation` (W:344); stale revision -> 409 with the current record (W:346). Corrupt stored `body` makes `JSON.parse(record.body)` throw (W:330) -> plain 503. P2.
- /api/access and /api/invitations: 2048 bytes, 413/415/400/409 as JSON (access-management.mjs:56-61, invitations.mjs:31-46). Good.
- /api/feedback: 8000 bytes; /api/feedback/activity: 1000 bytes (feedback-events.mjs:76,99).
- /api/ask: see section 7.
- /mcp: 16384 bytes, non-JSON-RPC error bodies (section 11).
- Cookie or token longer than 8192: treated as absent (W:36, W:89). Malformed base64 or JSON in the session cookie: caught, signed out (W:42).
- Query strings: `?tab=` only matters on `/` for five names (W:184). Others ignored.
- Percent-encoded or very long paths: no handling found beyond `new URL`; not exercised.

## 14. CSRF and origin mismatch

State-changing endpoints and their origin check:
- /auth/logout W:190; /auth/invite/continue W:213; /api/access, /api/invitations, /api/invitations/revoke POST W:313; /api/refresh W:320; PUT /api/presentation W:324; /api/ask ask.mjs:85; /api/feedback and /api/feedback/activity feedback-events.mjs:73,96; /api/workos-widget-token workos-widgets.mjs:78; /api/access-live W:298.
- Missing Origin counts as mismatch everywhere (strict equality), so non-browser clients without Origin are rejected.
- Responses on mismatch differ: `invalid_origin` 403 JSON (most), `owner_required` 403 (W:320, conflates with not-owner), `invalid_request` 403 (feedback), `invalid_request` 400 (access-live, W:298), Ask returns `invalid_origin`. Frontend maps most 403s to permission text, so a real origin problem looks like a permission problem. P2.
- Cookies: `Secure; HttpOnly; SameSite=Lax; __Host-` prefix (W:44). `/auth/login` is a state-creating GET but is bound by PKCE and state (W:222-227). No CSRF hole found.
- F1 is the only functional problem here: legitimate form POSTs from auth pages arrive with `Origin: null`. The SPA's own logout form is not affected because the SPA document has `referrer-policy: same-origin` (W:366, DataAppChrome.jsx:615-620).

## 15. Security-relevant leaks

- Account enumeration: none found.
  - Status pages (pending/denied/review) only appear after the person authenticates with that verified Google identity (W:241-242, W:285).
  - Invitation tokens are 256-bit; valid vs invalid responses differ only for the token holder (W:200-209).
  - MCP and invitation APIs are owner-only; MCP denial reasons go to logs only (W:84).
  - `/api/access` returns emails, owner-only (access-management.mjs:48-52).
- Internal errors exposed: none. Outer catch returns fixed text and logs only `error.message` plus path (W:373). Gemini/Resend/WorkOS error bodies are never returned (gemini.mjs:53, invitations.mjs:58-72). Refresh results returned by /api/refresh contain status words and timestamps only (refresh-runner.mjs:149-154), owner-only.
- no-store gaps (all low risk, non-sensitive bodies): W:173, W:177, W:122 and W:189 (405 text), W:357, feedback-events.mjs error responses (:71-90, :95-111), MCP 405 (W:122). Everything else sets `private, no-store` (json helper W:46, auth pages auth-pages.mjs:45, ask/access/invitation `reply` helpers).
- noindex: every Worker-rendered HTML page has `<meta name="robots" content="noindex, nofollow">` (auth-pages.mjs:29). No `X-Robots-Tag` header is set on any response (rg found none), so JSON/text responses and the public og.png/favicon/fonts carry no header. The authenticated SPA shell has no robots tag (egm-performance/index.html:1-8; HTMLRewriter adds description and Open Graph only, W:369) but is unreachable signed out. `/robots.txt` returns 401 JSON, which crawlers treat as "no rules"; the noindex meta on the only public HTML page still applies. P2: add `X-Robots-Tag: noindex, nofollow` to the final response wrapper in `fetch()` (W:372-373).
- `Origin: null` must not be allowed as a workaround for F1.
- Referrer handling: the invite token URL's 303 sets no-referrer and the next URL is token-free (W:208). Good. Changing the page policy per F1 does not reintroduce a token leak.

## 16. Places where an error is swallowed silently

Worker:
- W:80 `accessManager` catch -> false (owner shown as non-owner).
- W:164, W:252, W:316 `accessChanged(...).catch(()=>{})` (live badge may not update).
- W:192 logout deletes WorkOS session rows in `try{}catch{}`; W:193 the sessions delete is not guarded, so a D1 error returns the plain 503 and leaves the session valid with no clear message.
- W:260 `storeWorkosSession` catch.
- W:265 `syncWorkosMember(...).catch(()=>{})` (retry state is stored in workos_membership_sync, workos-membership.mjs:51-52).
- W:376-383 cron cleanup and flush failures log a fixed string only.
- refresh-runner.mjs:49-52 and every `catch { state.x = 'failed' }` at :69,75,81,87,93,99,105,111,117,123,141: no reason logged.
- approval-events.mjs:133, grok-notify.mjs:35, feedback-events.mjs:126,136,164: delivery errors dropped; no log when attempts are exhausted.
- ask.mjs:154, ask-stream.mjs:54, gemini.mjs:52-53: provider errors unlogged.
- feedback-events.mjs:34 survey fetch errors unlogged.
- access-management.mjs:43 WorkOS photo lookups (intentional, falls back to initials).
Frontend:
- live-snapshot.js:18,26,37 (auth stop and fetch failures).
- ManageUsers.jsx:63 (list refresh), DataAppChrome.jsx:596 (pending badge `.catch(()=>{})`), Feedback.jsx:17 (activity, intentional).
- DataAppChrome.jsx:605-609 WebSocket reconnect loop never surfaces or stops.

## 17. Gaps the two in-flight agents are likely to miss

- F1 (referrer-policy / `Origin: null`) lives in auth-pages.mjs:45, a Worker-page file, but is invisible when testing with hand-set Origin headers. The worker agent should assert the header and test a real form POST.
- Plain-text and bare-JSON dead ends outside the auth-page set: W:234 (callback), W:282 (signed-out deep links), W:357, W:358, W:173, W:177, W:122, W:189, W:373. The worker agent's "404 / invalid invite / pending" pages should reuse `renderAccessPage` for W:234, W:282 (HTML GETs), W:373 (HTML GETs), W:189 (GET /auth/logout).
- Return-to after sign-in (F4) needs both the Worker (flow cookie, W:227,270) and an HTML sign-in response for deep links.
- Frontend: a single 401/503 handler is needed; per-component empty states will not fix F2 because the cause is cross-cutting (live-snapshot.js, ask-transport.mjs, Feedback.jsx, ManageUsers.jsx, DataAppRuntime.jsx all handle auth failure differently or not at all).
- Stale/expired banner needs `refreshStatus` plumbing from the snapshot (refresh-runner.mjs:150) that no component reads.
- Observability of failures (sections 7, 9, 10, 16) is Worker-side logging; UI work does not cover it.
- Owner-side: revoke and undo (section 5), owner/non-owner misclassification (F5), notification exhaustion.

## 18. Suggested order of work

1. auth-pages.mjs:45 referrer policy to same-origin plus test (F1).
2. W:234 and WorkOS/D1 failures in callback render `renderAccessPage` (F3).
3. Signed-out deep link: HTML sign-in plus return-to (F4).
4. Frontend 401/503 wrapper with sign-in banner; stop poll and socket retry loops (F2).
5. Cache WorkOS verification and JWKS; map admin-check failures to 503 (F5).
6. Staleness banner from `refreshStatus` and REFRESH_UNTIL warning (F7).
7. Provider and collector failure logging (reason code only).
8. Revoke/undo for approved and denied users; decision email (F6).
9. Feedback: store without PostHog gate; per-code messages (F8).
10. MCP 503 for IdP failures; kid-miss refetch (F9).
