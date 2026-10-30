// Tab and refresh marks are 24px outlines at stroke width 2, drawn at 20px.
// The Ask mark is the filled Gemini sparkle at the same 20px box.
export const navbarIconSize = 20

const pageIcons = {
  reach: 'bar_chart',
  acquisition: 'north_east',
  adoption: 'group',
  website: 'language',
  development: 'code',
  research: 'search',
  mentions: 'campaign'
}

export const navbarAskIcon = 'navSparkle'
export const navbarRefreshIcon = 'refresh'
export const navbarAccountIcon = 'account_circle'

export function navbarIcon(id) {
  return pageIcons[id] ?? 'textDocument'
}

export const navbarRoundedIcons = [...Object.values(pageIcons), navbarRefreshIcon, navbarAccountIcon]
