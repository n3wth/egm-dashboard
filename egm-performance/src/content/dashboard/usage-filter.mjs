export function filterUsageEvent(event) {
  if (event.event !== 'dashboard_section_viewed') return null
  const { distinct_id, token, $session_id, $lib, $lib_version, section } = event.properties
  return { ...event, properties: { distinct_id, token, $session_id, $lib, $lib_version, section } }
}
