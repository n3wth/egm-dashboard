// One stroke set for the top bar. Every glyph is a 24px outline at stroke width 1.5.
export const navbarIconSize = 16

const pageIcons = {
  reach: 'navOverview',
  acquisition: 'navAcquisition',
  adoption: 'navAdoption',
  website: 'navWebsite',
  development: 'navDevelopment',
  research: 'navResearch',
  mentions: 'navMentions'
}

export const navbarAskIcon = 'navSparkle'
export const navbarRefreshIcon = 'navRefresh'

export function navbarIcon(id) {
  return pageIcons[id] ?? 'textDocument'
}

export const navbarStrokeIcons = [...Object.values(pageIcons), navbarAskIcon, navbarRefreshIcon]
