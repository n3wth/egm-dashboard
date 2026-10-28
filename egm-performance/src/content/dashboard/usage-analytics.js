import posthog from 'posthog-js'
import { filterUsageEvent } from './usage-filter.mjs'

const sections = new Set(['reach', 'acquisition', 'adoption', 'website', 'development', 'research', 'mentions'])
let initialized = false
let lastSection

export function trackDashboardSection(section) {
  const token = import.meta.env.VITE_POSTHOG_PROJECT_TOKEN
  const host = import.meta.env.VITE_POSTHOG_HOST
  if (!token || !host || !sections.has(section) || globalThis.location?.hostname !== 'egm.n3wth.com') return
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
  if (lastSection === section) return
  lastSection = section
  posthog.capture('dashboard_section_viewed', { section })
}
