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
| 7 | P2 | `WORKOS_RBAC_ISSUER` contains `client_01KT21...` but `WORKOS_CLIENT_ID` is `client_01M60K...`. Tokens must match both `iss` and `client_id`. The docs show `iss` as `https://api.workos.com/` (or the custom auth domain), not the `/user_management/<client>` form used here. Cannot be proven right or wrong without a real token. | `wrangler.jsonc:21,26` | Docs differ from configured value | Not fixed, owner check |
| 8 | P2 | Each authenticated request makes two WorkOS calls (session list, user read). Reads are limited to 1,000 per 10 s per environment, so the dashboard tops out near 500 requests per 10 s before 429s turn into "session unavailable" pages. Caching session state and email for 30 to 60 s would fix it but delays revocation, so it needs an owner decision. | `worker.mjs:56-75` | Verified rate limits | Not fixed |
| 9 | P2 | No retry or backoff on idempotent GETs (JWKS, user, sessions) and no `Retry-After` handling on 429. Docs recommend backoff with jitter. Refresh already maps 408, 429 and 5xx to retryable and keeps the session, matching the docs table, but does not retry inline (safe within the 30 s replay grace). | `workos-identity.mjs:7`, `workos-widgets.mjs:45`, `workos-refresh.mjs:18` | Verified | Not fixed |
| 10 | P2 | No WorkOS webhook or event consumption, so there is no push-based deprovisioning. Mitigated by the per-request session and email check, which fails closed. No signature verification code exists because no endpoint exists. | n/a | n/a | Not fixed |
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

1. Finding 7: decode (no verification needed) the payload of a real access token and compare `iss` and `client_id` with `WORKOS_RBAC_ISSUER` and `WORKOS_CLIENT_ID` in `wrangler.jsonc`. If they differ, correct the var; if they match, no action. Do not paste the token anywhere.
2. WorkOS dashboard, Redirects: keep `https://egm.n3wth.com/auth/callback` as the only redirect URI. Optionally add a default Sign-out URI. Server-side revoke already ends the WorkOS session, so a browser redirect to the logout URL is only needed if you start using hosted AuthKit cookies.
3. Rotating `SESSION_SECRET`: `wrangler secret put SESSION_SECRET_PREVIOUS` with the old value, `wrangler secret put SESSION_SECRET` with a new 48+ char value, deploy. After at least one hour (session lifetime) delete the previous secret. Approval and feedback event subscribers must resubscribe after rotation (finding 5).
4. Finding 11: use separate WorkOS API keys per environment, store only in Cloudflare secrets, rotate on a schedule.
5. Finding 10: if push deprovisioning is wanted, create a WorkOS webhook endpoint and a signing secret in the dashboard, then add a verified `/webhooks/workos` handler (signature check with a 5 minute tolerance).
6. Findings 8, 9, 12: decide on a 30 to 60 s cache for session state and email, inline GET retry with backoff, and sending `ip_address` and `user_agent`.
