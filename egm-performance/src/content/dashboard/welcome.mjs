export const welcomeKey = 'egm:welcome-dismissed:v1'

// Storage can be missing or throw (private browsing, blocked cookies); the card then shows once per visit.
export function welcomeDismissed(storage) {
  try { return storage?.getItem(welcomeKey) === '1' } catch { return false }
}

export function dismissWelcome(storage) {
  try { storage?.setItem(welcomeKey, '1') } catch {}
}
