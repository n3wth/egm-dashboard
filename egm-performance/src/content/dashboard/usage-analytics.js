import posthog from 'posthog-js'
import { filterUsageEvent } from './usage-filter.mjs'
import { starterIds } from './ask-starters.mjs'

const sections = new Set(['reach', 'acquisition', 'adoption', 'website', 'development', 'research', 'mentions'])
let initialized = false
let identified = false
let logoutBound = false
let lastSection

function bindLogout() {
  if (logoutBound || typeof document === 'undefined') return
  logoutBound = true
  document.addEventListener('submit', event => {
    const form = event.target
    const action = form?.getAttribute?.('action') ?? ''
    if (action === '/auth/logout' || action.endsWith('/auth/logout')) posthog.reset()
  }, true)
}

async function identifySignedInUser() {
  if (identified) return
  identified = true
  try {
    const response = await fetch('/api/presentation', { credentials: 'same-origin' })
    if (!response.ok) return
    const data = await response.json()
    const viewer = data?.viewer
    if (!/^user_[A-Za-z0-9]+$/.test(viewer?.id ?? '')) return
    const properties = {}
    if (typeof viewer.email === 'string' && viewer.email) properties.email = viewer.email
    if (typeof viewer.name === 'string' && viewer.name) properties.name = viewer.name
    posthog.identify(viewer.id, properties)
  } catch { identified = false }
}

function initialize() {
  const token = import.meta.env.VITE_POSTHOG_PROJECT_TOKEN
  const host = import.meta.env.VITE_POSTHOG_HOST
  if (!token || !host || globalThis.location?.hostname !== 'egm.n3wth.com') return false
  if (!initialized) {
    posthog.init(token, {
      api_host: host,
      defaults: '2026-08-30',
      autocapture: false,
      capture_pageview: 'history_change',
      capture_pageleave: true,
      disable_session_recording: true,
      disable_surveys: true,
      disable_web_experiments: true,
      disable_external_dependency_loading: true,
      advanced_disable_feature_flags: true,
      before_send: filterUsageEvent,
    })
    initialized = true
    bindLogout()
    identifySignedInUser()
  }
  return true
}

export function resetUsageIdentity() {
  if (!initialize()) return
  posthog.reset()
}

export function trackDashboardSection(section) {
  if (!sections.has(section) || !initialize()) return
  if (lastSection === section) return
  lastSection = section
  posthog.capture('dashboard_section_viewed', { section })
}

export function trackAskOutcome(outcome) {
  if (!['submitted', 'completed', 'failed', 'stopped'].includes(outcome) || !initialize()) return
  posthog.capture('dashboard_ask', { outcome })
}

export function trackAskStarter(starter) {
  if (![...starterIds, 'tab-question'].includes(starter) || !initialize()) return
  posthog.capture('dashboard_ask_starter', { starter })
}
