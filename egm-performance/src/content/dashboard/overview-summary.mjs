import {percentage} from './percentage.mjs'
import {isSearchVideo} from './referrer-channels.mjs'
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
  const label=reportingRangeLabel((queries.traffic?.rows??[]).map(row=>row.date))
  return label?{label,note:'UTC'}:null
}
export function overviewSummary(queries={}) {
  const reach=queries.reach?.rows?.[0]
  const traffic=[...(queries.traffic?.rows??[])].filter(row=>/^\d{4}-\d{2}-\d{2}$/.test(row.date??'')).sort((a,b)=>a.date.localeCompare(b.date))
  const refs=queries.referrers?.rows??[]
  const ids=new Set()
  const sentences=[]
  const facts=[]
  let headline=null
  const stars=count(reach?.stars)?`EGM has ${number(reach.stars)} recorded stars`:null
  if(stars)ids.add('reach')
  const total=traffic.length&&traffic.every(row=>count(row.views))?traffic.reduce((sum,row)=>sum+row.views,0):null
  if(total>0&&traffic.length>=3) {
    const recentDays=traffic.slice(-3)
    const recent=recentDays.reduce((sum,row)=>sum+row.views,0)
    // An even spread over the window would put 3/N of the views in the last three days; stating that baseline lets the reader judge the share.
    const even=percentage(3/traffic.length)
    sentences.push(`${stars?stars+'; ':''}${percentage(recent/total)} of the ${number(total)} repo views between ${shortDate(traffic[0].date)} and ${shortDate(traffic.at(-1).date)} (UTC) arrived in the last three days, ${shortDate(recentDays[0].date)}–${shortDate(recentDays.at(-1).date)}; an even spread would be ${even}.`)
    headline=`${percentage(recent/total)} of ${number(total)} repo views arrived in the last 3 days.`
    facts.push(`vs ${even} if evenly spread`)
    if(count(reach?.stars))facts.push(`${number(reach.stars)} recorded stars`)
    ids.add('traffic')
  } else if(stars||count(reach?.views)) {
    sentences.push(`${stars??'The snapshot records'}${count(reach?.views)?`${stars?' and ':' '}${number(reach.views)} repo views in GitHub’s two-week traffic window`:''}.`)
    ids.add('reach')
  }
  if(refs.length&&refs.every(row=>count(row.count))) {
    const totalReferrals=refs.reduce((sum,row)=>sum+row.count,0)
    const searchVideo=refs.filter(row=>isSearchVideo(row.referrer)).reduce((sum,row)=>sum+row.count,0)
    if(totalReferrals>0&&searchVideo>0) {
      const attributed=`Google + YouTube = ${percentage(searchVideo/totalReferrals)} of attributed views`
      sentences.push(`Google and YouTube sent ${percentage(searchVideo/totalReferrals)} of the views GitHub attributes to its top ten referrers${reach?.views>0?` (${percentage(searchVideo/reach.views)} of all repo views)`:''}.`)
      if(facts.length<3)facts.push(attributed)
      ids.add('referrers');if(reach?.views>0)ids.add('reach')
    }
  }
  if(sentences.length<2) {
    const video=(queries.youtube_videos?.rows??[]).filter(row=>count(row.views)).sort((a,b)=>b.views-a.views)[0]
    if(video){sentences.push(`The most-viewed YouTube video about EGM has ${number(video.views)} views.`);ids.add('youtube_videos')}
  }
  if(!sentences.length)return null
  return {sentences:sentences.slice(0,2),queryIds:[...ids],headline:headline??sentences[0],facts:facts.slice(0,3),range:reportingRange(queries)}
}
