import {percentage} from './percentage.mjs'
import {isSearchVideo} from './referrer-channels.mjs'
import {starWeeklyChange,observedStarChange} from './weekly-change.mjs'
import {observedStarGrowth} from './star-growth.mjs'
const count=value=>Number.isFinite(value)&&value>=0
const number=value=>value.toLocaleString('en-US')
const shortDate=value=>new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',timeZone:'UTC'}).format(new Date(value+'T12:00:00Z'))
const monthDay=value=>new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',timeZone:'UTC'}).format(new Date(value+'T12:00:00Z'))
const dayOnly=value=>new Intl.DateTimeFormat('en-US',{day:'numeric',timeZone:'UTC'}).format(new Date(value+'T12:00:00Z'))
export function reportingRangeLabel(dates=[]) {
  const days=[...dates].filter(date=>/^\d{4}-\d{2}-\d{2}$/.test(date??'')).sort()
  if(days.length<2)return null
  const [start,end]=[days[0],days.at(-1)]
  const endLabel=start.slice(0,7)===end.slice(0,7)?dayOnly(end):monthDay(end)
  return `${monthDay(start)} – ${endLabel}`
}
export function reportingRange(queries={}) {
  const label=pacificReportingRangeLabel((queries.traffic?.rows??[]).map(row=>row.date))
  return label?{label,note:'Pacific Time'}:null
}
export function pacificReportingRangeLabel(dates=[]) {
  const days=dates.filter(date=>/^\d{4}-\d{2}-\d{2}$/.test(date??'')&&Number.isFinite(Date.parse(date))).sort()
  if(days.length<2)return null
  const format=value=>new Intl.DateTimeFormat('en-US',{timeZone:'America/Los_Angeles',month:'short',day:'numeric',hour:'numeric',timeZoneName:'short'}).format(new Date(value))
  return `${format(days[0]+'T00:00:00Z')} – ${format(Date.parse(days.at(-1)+'T00:00:00Z')+86400000)}`
}
export function overviewSummary(queries={}) {
  const reach=queries.reach?.rows?.[0]
  const traffic=[...(queries.traffic?.rows??[])].sort((a,b)=>String(a.date).localeCompare(String(b.date)))
  const refs=queries.referrers?.rows??[]
  const ids=new Set()
  const sentences=[]
  const facts=[]
  let headline=null
  const stars=count(reach?.stars)?`EGM has ${number(reach.stars)} recorded stars`:null
  if(stars) {
    ids.add('reach')
    facts.push(reach.stars>=300000?'Team target 200k–300k reached':reach.stars>=200000?`200k target reached · ${number(300000-reach.stars)} stars to 300k`:`Team target: ${number(200000-reach.stars)} stars to 200k · ${number(300000-reach.stars)} to 300k`)
  }
  const history=queries.star_history
  const staleHistory=(history?.source?.caveats??[]).some(note=>note.startsWith('Star history is stale:'))
  const weekly=!staleHistory&&starWeeklyChange(history?.rows??[],history?.source?.executedAt)
  const observations=queries.star_observations
  const observedWeekly=staleHistory&&observedStarChange(observations?.rows??[],observations?.source?.executedAt)
  const observedRows=staleHistory?observedStarGrowth(observations?.rows??[],observations?.source?.executedAt).daily:[]
  if(weekly) {
    headline=`${number(weekly.current)} new stars ${shortDate(weekly.mid)}–${shortDate(weekly.end)}, versus ${number(weekly.previous)} the prior week.`
    sentences.push(`${headline} These are complete Pacific-date weeks reconstructed from current stargazers; removed stars are unavailable.`)
    ids.add('star_history')
  } else if(observedWeekly) {
    headline=`${number(observedWeekly.current)} net stars across the latest seven daily-snapshot intervals, versus ${number(observedWeekly.previous)} in the preceding seven.`
    sentences.push(`${headline} These are changes between actual observation times, not exact midnight-to-midnight gains.`)
    ids.add('star_observations')
  } else if(stars&&observedRows.length>=2) {
    const first=observedRows[0],last=observedRows.at(-1)
    headline=`${stars}; ${number(last.stars-first.stars)} net change between samples dated ${shortDate(first.date)}–${shortDate(last.date)}.`
    sentences.push(`${headline} Daily-snapshot history is still building; missing dates are not filled.`)
    ids.add('star_observations')
  } else if(stars) {
    headline=staleHistory?`${stars}; weekly star momentum is unavailable.`:`${stars}.`
    sentences.push(headline)
    if(staleHistory)ids.add('star_history')
  }
  const completeTraffic=traffic.length&&traffic.every((row,index)=>/^\d{4}-\d{2}-\d{2}$/.test(row.date??'')&&Number.isFinite(Date.parse(row.date))&&count(row.views)&&(index===0||Date.parse(row.date)-Date.parse(traffic[index-1].date)===86400000))
  const total=completeTraffic?traffic.reduce((sum,row)=>sum+row.views,0):null
  if(total>0&&traffic.length>=3) {
    const recentDays=traffic.slice(-3)
    const recent=recentDays.reduce((sum,row)=>sum+row.views,0)
    const trafficText=`${percentage(recent/total)} of ${number(total)} repo views arrived in the last 3 reported UTC days.`
    sentences.push(`${trafficText} The reported traffic window is ${shortDate(traffic[0].date)}–${shortDate(traffic.at(-1).date)}.`)
    headline??=trafficText
    facts.push(`${number(total)} repo views · ${percentage(recent/total)} in last 3 reported UTC days`)
    ids.add('traffic')
  } else if(count(reach?.views)) {
    const trafficText=`GitHub recorded ${number(reach.views)} repo views in its two-week traffic window.`
    sentences.push(trafficText)
    headline??=trafficText
    facts.push(`${number(reach.views)} repo views in reporting window`)
    ids.add('reach')
  }
  if(refs.length&&refs.every(row=>count(row.count))) {
    const totalReferrals=refs.reduce((sum,row)=>sum+row.count,0)
    const searchVideo=refs.filter(row=>isSearchVideo(row.referrer)).reduce((sum,row)=>sum+row.count,0)
    if(totalReferrals>0&&searchVideo>0) {
      const attributed=`Google + YouTube = ${percentage(searchVideo/totalReferrals)} of attributed views`
      sentences.push(`Google and YouTube sent ${percentage(searchVideo/totalReferrals)} of the views GitHub attributes to its top ten referrers${reach?.views>0?` (${percentage(searchVideo/reach.views)} of all repo views)`:''}.`)
      facts.push(attributed)
      ids.add('referrers');if(reach?.views>0)ids.add('reach')
    }
  }
  if(!sentences.length) {
    const video=(queries.youtube_videos?.rows??[]).filter(row=>count(row.views)).sort((a,b)=>b.views-a.views)[0]
    if(video){sentences.push(`The most-viewed YouTube video about EGM has ${number(video.views)} views.`);ids.add('youtube_videos')}
  }
  if(!sentences.length)return null
  return {sentences,queryIds:[...ids],headline:headline??sentences[0],facts:facts.slice(0,3),range:reportingRange(queries)}
}
