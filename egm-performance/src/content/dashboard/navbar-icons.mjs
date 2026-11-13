// Every tab and the refresh mark is Material Symbols Rounded, weight 400, grade 0, fill 0, at 20px.
// Overview is show_chart and Adoption is person so those tabs stay strokes, like the arrows and search.
// The Ask mark stays the filled sparkle, drawn at 18px so it matches the stroke icons optically.
export const navbarIconSize = 20
export const navbarSparkleSize = 18

const pageIcons = {
  reach: 'show_chart',
  acquisition: 'north_east',
  adoption: 'person',
  website: 'language',
  development: 'code',
  research: 'search',
  mentions: 'campaign',
  'egm-chat': 'bar_chart'
}

export const navbarAskIcon = 'navSparkle'
export const navbarRefreshIcon = 'refresh'
export const navbarAccountIcon = 'account_circle'

export function navbarIcon(id) {
  return pageIcons[id] ?? 'textDocument'
}

export const navbarRoundedIcons = [...Object.values(pageIcons), navbarRefreshIcon, navbarAccountIcon]
