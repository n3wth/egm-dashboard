// Verified WorkOS emails on these exact domains skip owner review.
// Subdomains and lookalikes do not match.
export const AUTO_APPROVE_DOMAINS = ['google.com']

export function autoApprovedEmail(email) {
  if (typeof email !== 'string') return false
  const at = email.lastIndexOf('@')
  if (at < 1 || email.indexOf('@') !== at) return false
  return AUTO_APPROVE_DOMAINS.includes(email.slice(at + 1).trim().toLowerCase())
}
