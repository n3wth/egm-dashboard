import barChart from '@material-symbols/svg-400/rounded/bar_chart.svg?raw'
import northEast from '@material-symbols/svg-400/rounded/north_east.svg?raw'
import group from '@material-symbols/svg-400/rounded/group.svg?raw'
import language from '@material-symbols/svg-400/rounded/language.svg?raw'
import code from '@material-symbols/svg-400/rounded/code.svg?raw'
import search from '@material-symbols/svg-400/rounded/search.svg?raw'
import campaign from '@material-symbols/svg-400/rounded/campaign.svg?raw'
import refresh from '@material-symbols/svg-400/rounded/refresh.svg?raw'
import accountCircle from '@material-symbols/svg-400/rounded/account_circle.svg?raw'

// Weight 400, grade 0, fill 0, Rounded. The package has no spark symbol, so Ask stays the filled sparkle.
export const roundedIcons = {
  bar_chart: barChart,
  north_east: northEast,
  group,
  language,
  code,
  search,
  campaign,
  refresh,
  account_circle: accountCircle,
}

export function roundedIconUrl(name) {
  const svg = roundedIcons[name]
  return svg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` : null
}
