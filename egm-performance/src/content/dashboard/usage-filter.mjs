export function filterUsageEvent(event) {
  if (!['dashboard_section_viewed', 'dashboard_ask'].includes(event.event)) return null
  const { distinct_id, token, $session_id, $lib, $lib_version, section, outcome } = event.properties
  return { ...event, properties: { distinct_id, token, $session_id, $lib, $lib_version, ...(event.event === 'dashboard_section_viewed' ? { section } : { outcome }) } }
}
