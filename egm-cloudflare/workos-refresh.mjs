// AuthKit rotates refresh tokens on success. The caller must serialize refreshes
// per session and persist the returned pair atomically before using it.
// https://workos.com/docs/authkit/session-resilience
export async function refreshWorkosSession({ clientId, clientSecret, organizationId, refreshToken, request = fetch }) {
  if (![clientId, clientSecret, refreshToken].every(value => typeof value === 'string' && value.length > 0) || (organizationId !== undefined && (typeof organizationId !== 'string' || !organizationId))) return { status: 'configuration_error' }
  try {
    const response = await request('https://api.workos.com/user_management/authenticate', {
      method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(10000),
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, organization_id: organizationId, grant_type: 'refresh_token', refresh_token: refreshToken })
    })
    if (!response.ok) {
      if (response.status === 400) {
        let body
        try { body = await response.json() } catch { return { status: 'failed' } }
        return { status: body?.error === 'invalid_grant' ? 'revoked' : 'failed' }
      }
      return { status: response.status === 408 || response.status === 429 || response.status >= 500 ? 'retryable' : 'failed' }
    }
    const body = await response.json()
    if (typeof body.access_token !== 'string' || !body.access_token || typeof body.refresh_token !== 'string' || !body.refresh_token || typeof body.user?.id !== 'string' || !body.user.id || (organizationId !== undefined && body.organization_id !== organizationId)) return { status: 'failed' }
    return { status: 'refreshed', accessToken: body.access_token, refreshToken: body.refresh_token, userId: body.user.id }
  } catch { return { status: 'retryable' } }
}
