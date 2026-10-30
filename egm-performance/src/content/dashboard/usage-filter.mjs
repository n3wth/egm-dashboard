const fields = { dashboard_section_viewed: 'section', dashboard_ask: 'outcome', dashboard_ask_starter: 'starter' }

export function filterUsageEvent(event) {
  const field = fields[event.event]
  if (!field) return null
  const { distinct_id, token, $session_id, $lib, $lib_version } = event.properties
  return { ...event, properties: { distinct_id, token, $session_id, $lib, $lib_version, [field]: event.properties[field] } }
}
