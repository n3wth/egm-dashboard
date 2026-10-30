// The Worker calls this only after authenticating the host-only Boing session.
// Account identity is independent of a workspace selector.
export function handleBoingAccount(request, user) {
  if (new URL(request.url).pathname !== '/api/boing/account') return null
  const headers = { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' }
  if (request.method !== 'GET') return Response.json({ error: 'method_not_allowed' }, { status: 405, headers })
  if (!user || user.status !== 'active' || user.verified !== 1 ||
      !/^user_[A-Za-z0-9]+$/.test(user.id ?? '') ||
      typeof user.email !== 'string' || user.email.length > 320 || !user.email.includes('@')) {
    return Response.json({ error: 'sign_in_required' }, { status: 401, headers })
  }
  return Response.json({ email: user.email }, { headers })
}
