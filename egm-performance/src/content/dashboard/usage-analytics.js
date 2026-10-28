import posthog from 'posthog-js'
import { filterUsageEvent } from './usage-filter.mjs'

const sections = new Set(['reach', 'growth', 'acquisition', 'adoption', 'website', 'development', 'research', 'mentions'])
let initialized = false
let lastSection

function initialize() {
  const token = import.meta.env.VITE_POSTHOG_PROJECT_TOKEN
  const host = import.meta.env.VITE_POSTHOG_HOST
  if (!token || !host || globalThis.location?.hostname !== 'egm.n3wth.com') return false
  if (!initialized) {
    posthog.init(token, {
      api_host: host,
      defaults: '2026-08-30',
      autocapture: false,
      capture_pageview: false,
      capture_pageleave: false,
      disable_session_recording: true,
      disable_surveys: true,
      disable_web_experiments: true,
      disable_external_dependency_loading: true,
      advanced_disable_feature_flags: true,
      before_send: filterUsageEvent,
    })
    initialized = true
  }
  return true
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
