import notifications from '@material-symbols/svg-400/rounded/notifications.svg?raw'
import arrowDownward from '@material-symbols/svg-400/rounded/arrow_downward.svg?raw'
import arrowUpward from '@material-symbols/svg-400/rounded/arrow_upward.svg?raw'
import northEast from '@material-symbols/svg-400/rounded/north_east.svg?raw'
import formatBold from '@material-symbols/svg-400/rounded/format_bold.svg?raw'
import apartment from '@material-symbols/svg-400/rounded/apartment.svg?raw'
import calendarToday from '@material-symbols/svg-400/rounded/calendar_today.svg?raw'
import campaign from '@material-symbols/svg-400/rounded/campaign.svg?raw'
import barChart from '@material-symbols/svg-400/rounded/bar_chart.svg?raw'
import chatBubble from '@material-symbols/svg-400/rounded/chat_bubble.svg?raw'
import check from '@material-symbols/svg-400/rounded/check.svg?raw'
import checkBoxFill from '@material-symbols/svg-400/rounded/check_box-fill.svg?raw'
import checkBoxOutlineBlank from '@material-symbols/svg-400/rounded/check_box_outline_blank.svg?raw'
import keyboardArrowDown from '@material-symbols/svg-400/rounded/keyboard_arrow_down.svg?raw'
import chevronLeft from '@material-symbols/svg-400/rounded/chevron_left.svg?raw'
import chevronRight from '@material-symbols/svg-400/rounded/chevron_right.svg?raw'
import close from '@material-symbols/svg-400/rounded/close.svg?raw'
import code from '@material-symbols/svg-400/rounded/code.svg?raw'
import swapHoriz from '@material-symbols/svg-400/rounded/swap_horiz.svg?raw'
import contentCopy from '@material-symbols/svg-400/rounded/content_copy.svg?raw'
import database from '@material-symbols/svg-400/rounded/database.svg?raw'
import history from '@material-symbols/svg-400/rounded/history.svg?raw'
import download from '@material-symbols/svg-400/rounded/download.svg?raw'
import edit from '@material-symbols/svg-400/rounded/edit.svg?raw'
import feedback from '@material-symbols/svg-400/rounded/feedback.svg?raw'
import visibility from '@material-symbols/svg-400/rounded/visibility.svg?raw'
import publicIcon from '@material-symbols/svg-400/rounded/public.svg?raw'
import info from '@material-symbols/svg-400/rounded/info.svg?raw'
import formatItalic from '@material-symbols/svg-400/rounded/format_italic.svg?raw'
import lightbulb from '@material-symbols/svg-400/rounded/lightbulb.svg?raw'
import link from '@material-symbols/svg-400/rounded/link.svg?raw'
import lock from '@material-symbols/svg-400/rounded/lock.svg?raw'
import logout from '@material-symbols/svg-400/rounded/logout.svg?raw'
import monitor from '@material-symbols/svg-400/rounded/monitor.svg?raw'
import darkMode from '@material-symbols/svg-400/rounded/dark_mode.svg?raw'
import moreHoriz from '@material-symbols/svg-400/rounded/more_horiz.svg?raw'
import palette from '@material-symbols/svg-400/rounded/palette.svg?raw'
import person from '@material-symbols/svg-400/rounded/person.svg?raw'
import add from '@material-symbols/svg-400/rounded/add.svg?raw'
import refresh from '@material-symbols/svg-400/rounded/refresh.svg?raw'
import autorenew from '@material-symbols/svg-400/rounded/autorenew.svg?raw'
import search from '@material-symbols/svg-400/rounded/search.svg?raw'
import showChart from '@material-symbols/svg-400/rounded/show_chart.svg?raw'
import settings from '@material-symbols/svg-400/rounded/settings.svg?raw'
import verifiedUser from '@material-symbols/svg-400/rounded/verified_user.svg?raw'
import web from '@material-symbols/svg-400/rounded/web.svg?raw'
import tune from '@material-symbols/svg-400/rounded/tune.svg?raw'
import progressActivity from '@material-symbols/svg-400/rounded/progress_activity.svg?raw'
import stop from '@material-symbols/svg-400/rounded/stop.svg?raw'
import lightMode from '@material-symbols/svg-400/rounded/light_mode.svg?raw'
import description from '@material-symbols/svg-400/rounded/description.svg?raw'
import deleteIcon from '@material-symbols/svg-400/rounded/delete.svg?raw'
import undo from '@material-symbols/svg-400/rounded/undo.svg?raw'
import group from '@material-symbols/svg-400/rounded/group.svg?raw'
import language from '@material-symbols/svg-400/rounded/language.svg?raw'
import accountCircle from '@material-symbols/svg-400/rounded/account_circle.svg?raw'

// Weight 400, grade 0, fill 0, Rounded. checkboxChecked uses the filled box because it is the selected state.
// The package has no spark symbol, so gemini and navSparkle stay the filled sparkle asset.
export const roundedIcons = {
  alertBell: notifications,
  arrowDown: arrowDownward,
  arrowUp: arrowUpward,
  arrowUpRight: northEast,
  bold: formatBold,
  building: apartment,
  calendar: calendarToday,
  campaign: campaign,
  chart: barChart,
  chatBubble: chatBubble,
  check: check,
  checkboxChecked: checkBoxFill,
  checkboxUnchecked: checkBoxOutlineBlank,
  chevronDown: keyboardArrowDown,
  chevronLeft: chevronLeft,
  chevronRight: chevronRight,
  close: close,
  code: code,
  convert: swapHoriz,
  copy: contentCopy,
  cross: close,
  database: database,
  documentRefresh: history,
  download: download,
  edit: edit,
  eye: visibility,
  feedback: feedback,
  globe: publicIcon,
  info: info,
  italic: formatItalic,
  lightbulb: lightbulb,
  link: link,
  lock: lock,
  logOut: logout,
  monitor: monitor,
  moon: darkMode,
  more: moreHoriz,
  palette: palette,
  person: person,
  plus: add,
  refresh: refresh,
  remix: autorenew,
  search: search,
  sendUp: arrowUpward,
  settings: settings,
  shieldCheck: verifiedUser,
  sites: web,
  sliders: tune,
  spinner: progressActivity,
  stop: stop,
  summaryBubble: chatBubble,
  sun: lightMode,
  textDocument: description,
  theme: palette,
  trash: deleteIcon,
  undo: undo,
  users: group,
  bar_chart: barChart,
  show_chart: showChart,
  north_east: northEast,
  group: group,
  language: language,
  account_circle: accountCircle,
}

export function roundedIconUrl(name) {
  const svg = roundedIcons[name]
  return svg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` : null
}
