// Tab and refresh marks are 24px outlines at stroke width 2, drawn at 20px.
// The Ask mark is the filled Gemini sparkle at the same 20px box.
export const navbarIconSize = 20

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

export const navbarStrokeIcons = [...Object.values(pageIcons), navbarRefreshIcon]
