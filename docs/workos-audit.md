# WorkOS integration audit

Scope: `egm-cloudflare/` (auth routes in `worker.mjs`, `workos-*.mjs`, `invitations.mjs`, `owner-identity.mjs`). Compared against the WorkOS docs read on 2026-10-29: AuthKit sessions, session tokens and JWKS, session list and revoke, logout, session resilience, rate limits. Nothing here called WorkOS with real credentials.

Status: fixed means changed in this PR with tests in `workos-hardening.test.mjs`. Not fixed means documented, with owner steps below.

## Findings

| # | Sev | Finding | Location | Docs check | Status |
|---|-----|---------|----------|------------|--------|
| 1 | P1 | Sign-out only deleted local D1 rows. The WorkOS session and its refresh token stayed valid. Now the verified `sid` is revoked via `POST /user_management/sessions/revoke` (best effort, 5s timeout); local state is cleared whether or not WorkOS answers. | `worker.mjs:195`, `workos-session.mjs:148` | Verified: revoke endpoint takes `session_id` from the `sid` claim | Fixed |
| 2 | P1 | JWKS was fetched on every token verification (up to three times per request) with no cache. Added a per-isolate cache: 10 min fresh, one refetch per 30 s on an unknown kid, stale keys usable for 1 h during an outage, still fails closed beyond that. Duplicate, non-RSA or non-sig keys still never match. | `workos-jwks.mjs`, `workos-widgets.mjs:22`, `workos-rbac.mjs:22` | Docs say to validate every access token against the JWKS and are silent on caching; this is standard JOSE practice (unverified as WorkOS guidance) | Fixed |
| 3 | P1 | MCP token verification cached the AuthKit JWKS for 5 min with no refetch on an unknown kid, so a key rotation rejected valid tokens for up to 5 min. Now refetches once per 30 s on a kid miss. | `worker.mjs:107` | Same as above | Fixed |
| 4 | P1 | Session state scan used `order=asc` with a 3 page cap, so a user with more than 300 sessions (any status) could never be confirmed active and was locked out with "session unavailable". Now `desc`, so the current session is found on page one. | `workos-widgets.mjs:41` | Verified: list endpoint defaults to `desc`; `asc` is supported | Fixed |
| 5 | P2 | No rotation path for `SESSION_SECRET`. Added optional `SESSION_SECRET_PREVIOUS` (min 48 chars, ignored if equal). New values are written with the current secret; cookies and encrypted WorkOS tokens are read with either. Not covered: `approval-events.mjs` and `feedback-events.mjs` encrypt webhook subscription secrets with `SESSION_SECRET` only, so rotating invalidates those subscriptions. | `workos-session.mjs:24`, `worker.mjs:34` | n/a (our own secret) | Fixed for sessions, open for event subscriptions |
| 6 | P2 | The single-use login flow cookie was only cleared on success or bad state, not on token exchange, verification, invite or error pages. Now cleared on every callback error page. | `worker.mjs:239` | n/a | Fixed |
| 7 | P2 | `WORKOS_RBAC_ISSUER` is `https://api.workos.com/user_management/client_01KT21...` while `WORKOS_CLIENT_ID` is `client_01M60K...`. The AuthKit session docs read on 2026-11-02 say the access token `iss` is `https://api.workos.com/` (or the custom auth domain when one is configured). This app sets `WORKOS_AUTHKIT_DOMAIN` to `https://striking-ripple-85.authkit.app`. The configured issuer is the older user-management form and names a different client than `WORKOS_CLIENT_ID`. Verification compares `iss` and `client_id` independently, and widgets are on, so a wrong issuer would already fail closed for people who can open the dashboard. The value was not changed. | `wrangler.jsonc` `WORKOS_RBAC_ISSUER`, `WORKOS_CLIENT_ID` | Docs differ from configured value | Not fixed, owner check |
| 8 | P2 | Each authenticated request makes two WorkOS calls (session list, user read). Reads are limited to 1,000 per 10 s per environment, so the dashboard tops out near 500 requests per 10 s before 429s turn into "session unavailable" pages. Caching session state and email for 30 to 60 s would fix it but delays revocation, so it needs an owner decision. | `worker.mjs:56-75` | Verified rate limits | Not fixed |
| 9 | P2 | No retry or backoff on idempotent GETs (JWKS, user, sessions) and no `Retry-After` handling on 429. Docs recommend backoff with jitter. Refresh already maps 408, 429 and 5xx to retryable and keeps the session, matching the docs table, but does not retry inline (safe within the 30 s replay grace). | `workos-identity.mjs:7`, `workos-widgets.mjs:45`, `workos-refresh.mjs:18` | Verified | Not fixed |
| 10 | P2 | No WorkOS webhook or event consumption, so there is no push-based deprovisioning. `POST /webhooks/workos` now verifies `WorkOS-Signature` (HMAC SHA-256, 5 minute tolerance) and handles `user.deleted`, `organization_membership.deleted`, `organization_membership.updated` and `session.revoked`. Matching users are denied and their local sessions are deleted. A role update on an active membership is recorded in Audit Logs and does not grant access. Replays of the same event id are ignored. | `workos-webhooks.mjs`, `worker.mjs` | Verified signature and event names | Fixed |
| 11 | P2 | One full-power API key is used as refresh `client_secret`, for user and session reads, membership creation and widget tokens. WorkOS API keys are not scoped (not confirmed in docs read). | `workos-refresh.mjs:10`, `workos-membership.mjs:31` | Unverified | Not fixed |
| 12 | P2 | `authenticate` with code does not send the optional `ip_address` and `user_agent`, which the docs list and which feed WorkOS risk signals. Left out pending a privacy decision. | `worker.mjs:243` | Verified optional params | Not fixed |
| 13 | P2 | Callback token exchange failure (timeout or network) falls to the top-level handler: generic 503, flow cookie kept until its 10 min expiry. Not exploitable; the code is single-use at WorkOS. | `worker.mjs:243` | n/a | Not fixed |
| 14 | P2 | Invitations are custom (D1, not the WorkOS invitation API). No finding; recorded so the choice is explicit. | `invitations.mjs` | n/a | Not applicable |

## Checked and sound

- Authorization code flow with PKCE S256. `state` and verifier live in a signed, 10 min, `__Host-` HttpOnly cookie; state is compared before any exchange; the code is single-use at WorkOS.
- `redirect_uri` is built from `APP_URL`, never from input. There is no return-path parameter, so no open redirect; post-login target is fixed to `/overview`. The invite token is moved from the URL into a cookie by a 303 with `Referrer-Policy: no-referrer`.
- Cookies: `__Host-` prefix, `Path=/`, `Secure`, `HttpOnly`, `SameSite=Lax` (required for the OAuth return), `Max-Age` 3600 (session), 600 (flow, invite). Session cookie is HMAC-signed (integrity, not secrecy) and carries only the local session id and avatar URL. WorkOS tokens are AES-GCM encrypted in D1 with HKDF-derived key and `session:user` AAD.
- Token verification: RS256 pinned, `crit`/`b64` rejected, `kid` exact single match, `iss`, `client_id`, `sub`, `sid`, `exp`, `nbf` checked, org and permission checked for admin routes, 8 KiB cap. The expired-token-for-binding path never grants access.
- Refresh: single-flight lease plus version compare-and-swap, rotated token persisted atomically, user and session id re-bound after refresh, `invalid_grant` is the only terminal outcome that deletes the session, matching the session-resilience table.
- Sign-out is POST only with an `Origin` check; cookies cleared; redirect is the constant `/`.
- Admin APIs (`/api/access`, `/api/invitations`, `/api/refresh`, `/api/presentation` PUT, `/api/access-live`) call `accessManager`, which re-verifies the org-scoped permission server-side every time.
- Invitations: 256-bit tokens, SHA-256 at rest, atomic single-use claim, expiry, optional email binding, requires a verified WorkOS email, one uniform "invalid" response for unknown, expired, revoked or used tokens (no enumeration).
- Membership sync only creates missing `member` memberships, never changes existing ones, and re-checks local approval immediately before the write.
- Every WorkOS call has a timeout and `redirect: 'manual'`; upstream bodies and tokens are never returned or logged (only reason codes and claim shape are logged for MCP rejections).
- Behavior when WorkOS is down: fails closed with a "session unavailable" page or 503, without deleting local sessions. Cached JWKS now keeps already-issued tokens verifiable through short outages, but session state and email reads still need WorkOS.

## Owner-only steps

1. Finding 7: decode (no verification needed) the payload of a real access token and compare `iss` and `client_id` with `WORKOS_RBAC_ISSUER` and `WORKOS_CLIENT_ID` in `wrangler.jsonc`. Do not paste the token anywhere. Set `WORKOS_RBAC_ISSUER` to the token's `iss` exactly, including a trailing slash if the token has one. Current AuthKit docs say that string is `https://api.workos.com/` unless a custom auth domain is in use, in which case it is that domain (`https://striking-ripple-85.authkit.app` is configured here). `client_id` must equal `WORKOS_CLIENT_ID` (`client_01M60K01HRESAKEPD135F3KAMM`). If the token's `iss` is still `https://api.workos.com/user_management/client_01KT21TBYTKHENW4172A587X7Q` and its `client_id` is `client_01M60K...`, leave the variable as it is.
2. WorkOS dashboard, Redirects: keep `https://egm.n3wth.com/auth/callback` as the only redirect URI. Optionally add a default Sign-out URI. Server-side revoke already ends the WorkOS session, so a browser redirect to the logout URL is only needed if you start using hosted AuthKit cookies.
3. Rotating `SESSION_SECRET`: `wrangler secret put SESSION_SECRET_PREVIOUS` with the old value, `wrangler secret put SESSION_SECRET` with a new 48+ char value, deploy. After at least one hour (session lifetime) delete the previous secret. Approval and feedback event subscribers must resubscribe after rotation (finding 5).
4. Finding 11: use separate WorkOS API keys per environment, store only in Cloudflare secrets, rotate on a schedule.
5. Finding 10: in the WorkOS dashboard, create a webhook endpoint aimed at `https://egm.n3wth.com/webhooks/workos` for `user.deleted`, `organization_membership.deleted`, `organization_membership.updated` and `session.revoked`. Put the signing secret in the Worker with `wrangler secret put WORKOS_WEBHOOK_SECRET`. Deployments run the schema guard described below; run it before manual Worker deployments too. Sessions stored before the column exists are still dropped on the next live session check, not by `session.revoked`. Register the Audit Log schemas below before expecting events to be accepted. Audit delivery is fail-open.

   | Action | Actor type | Target type | Metadata keys |
   | --- | --- | --- | --- |
   | `egm.access.requested` | user | user | `email` |
   | `egm.access.approved` | user | user | `from_status`, `to_status` |
   | `egm.access.denied` | user | user | `from_status`, `to_status` |
   | `egm.access.revoked` | user | user | `from_status`, `to_status` |
   | `egm.access.reinstated` | user | user | `from_status`, `to_status` |
   | `egm.invitation.created` | user | invitation | `kind`, `email`, `delivery` |
   | `egm.invitation.revoked` | user | invitation | none |
   | `egm.access.role_changed` | user | user | `role`, `status`, `source` |
   | `egm.user.signed_out` | user | user | none |
6. Findings 8, 9, 12: decide on a 30 to 60 s cache for session state and email, inline GET retry with backoff, and sending `ip_address` and `user_agent`.

## Deployment schema guard

`CREATE TABLE IF NOT EXISTS` does not add columns to an existing table. Before deploying the Worker, `.github/workflows/deploy.yml` runs `node scripts/migrate-workos.mjs` (from the repository root; the workflow uses the equivalent relative path). The guard uses pinned Wrangler `4.151.3` against the existing `egm-growth-access` D1 database, inspects `PRAGMA table_info(workos_sessions)`, and adds `provider_session_id TEXT` only when absent. It also ensures the webhook receipt table exists and verifies both required schemas before allowing deployment. Existing session and receipt rows remain unchanged.

The guard is safe to rerun. A missing base session table, failed command, invalid response, or failed verification stops deployment instead of treating every SQL error as an already-applied migration. Fresh databases still require the base application and WorkOS session schemas; this guard does not bootstrap the full application or change authorization policy.
