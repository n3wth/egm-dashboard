import { workosSigningKey } from './workos-jwks.mjs'

// WorkOS AuthKit session tokens: https://workos.com/docs/reference/authkit/session-tokens
const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })

function decode(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw Error('invalid_base64url')
  return Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0))
}

// Return verified claims only for the named user, application and organization
// with the default admin role or configured permission. Expected values come from
// trusted configuration and the server-side session, never from the token itself.
export async function verifyWorkosPermission(token, { clientId, issuer, subject, organizationId, permission, request = fetch, time = Date.now() }) {
  try {
    if (typeof token !== 'string' || token.length > 8192 || !/^client_[A-Za-z0-9]+$/.test(clientId) || ![issuer, subject, organizationId, permission].every(v => typeof v === 'string' && v.length > 0)) return null
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const [h, p, signature] = parts
    const header = JSON.parse(decoder.decode(decode(h)))
    const claims = JSON.parse(decoder.decode(decode(p)))
    if (header.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid || header.crit != null || header.b64 === false) return null
    if (claims.iss !== issuer || claims.client_id !== clientId || claims.sub !== subject || claims.org_id !== organizationId || !Number.isFinite(claims.exp) || claims.exp <= Math.floor(time / 1000) || (claims.nbf != null && (!Number.isFinite(claims.nbf) || claims.nbf > Math.floor(time / 1000))) || !(claims.role === 'admin' || (Array.isArray(claims.permissions) && claims.permissions.includes(permission)))) return null
    const jwk = await workosSigningKey(clientId, header.kid, request, time)
    if (!jwk) return null
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'])
    return await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, decode(signature), encoder.encode(`${h}.${p}`)) ? claims : null
  } catch { return null }
}
