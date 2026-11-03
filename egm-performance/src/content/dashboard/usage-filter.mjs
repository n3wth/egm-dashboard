const fields = { dashboard_section_viewed: 'section', dashboard_ask: 'outcome', dashboard_ask_starter: 'starter' }
const kept = ['distinct_id', 'token', '$session_id', '$lib', '$lib_version']
const navigation = new Set(['$pageview', '$pageleave'])

function pathUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) return undefined
  try {
    const url = new URL(value, 'https://egm.n3wth.com')
    if (url.username || url.password || (url.protocol !== 'https:' && url.protocol !== 'http:')) return undefined
    return `${url.origin}${url.pathname}`
  } catch { return undefined }
}

function pathName(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.includes('?') || value.includes('#') || value.includes('\\') || value.length > 512) return undefined
  return value
}

function baseProperties(properties) {
  const next = {}
  for (const key of kept) if (properties[key] != null) next[key] = properties[key]
  const current = pathUrl(properties.$current_url)
  const path = pathName(properties.$pathname) ?? (current ? new URL(current).pathname : undefined)
  if (current) next.$current_url = current
  if (path) next.$pathname = path
  return next
}

export function filterUsageEvent(event) {
  if (!event || typeof event.event !== 'string') return null
  const properties = event.properties ?? {}
  const base = baseProperties(properties)
  if (navigation.has(event.event)) return { ...event, properties: base }
  if (event.event === '$identify') {
    const email = typeof properties.$set?.email === 'string' ? properties.$set.email.slice(0, 254) : ''
    const name = typeof properties.$set?.name === 'string' ? properties.$set.name.slice(0, 200) : ''
    if (email || name) base.$set = { ...(email ? { email } : {}), ...(name ? { name } : {}) }
    return { ...event, properties: base }
  }
  const field = fields[event.event]
  if (!field) return null
  return { ...event, properties: { ...base, [field]: properties[field] } }
}
