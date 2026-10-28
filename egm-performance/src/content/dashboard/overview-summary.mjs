const count=value=>Number.isFinite(value)&&value>=0
const number=value=>value.toLocaleString('en-US')
export function overviewSummary(queries={}) {
  const reach=queries.reach?.rows?.[0]
  const traffic=[...(queries.traffic?.rows??[])].filter(row=>/^\d{4}-\d{2}-\d{2}$/.test(row.date??'')).sort((a,b)=>a.date.localeCompare(b.date))
  const refs=queries.referrers?.rows??[]
  const ids=new Set()
  const sentences=[]
  const stars=count(reach?.stars)?`EGM has ${number(reach.stars)} recorded stars`:null
  if(stars)ids.add('reach')
  const total=traffic.length&&traffic.every(row=>count(row.views))?traffic.reduce((sum,row)=>sum+row.views,0):null
  if(total>0&&traffic.length>=3) {
    const recent=traffic.slice(-3).reduce((sum,row)=>sum+row.views,0)
    sentences.push(`${stars?stars+'; ':''}${(recent/total*100).toFixed(1)}% of the window’s ${number(total)} repo views arrived in the last three reported days.`)
    ids.add('traffic')
  } else if(stars||count(reach?.views)) {
    sentences.push(`${stars??'The snapshot records'}${count(reach?.views)?`${stars?' and ':' '}${number(reach.views)} repo views in the reporting window`:''}.`)
    ids.add('reach')
  }
  if(refs.length&&refs.every(row=>count(row.count))) {
    const totalReferrals=refs.reduce((sum,row)=>sum+row.count,0)
    const searchVideo=refs.filter(row=>['google','google.com','youtube','youtube.com'].includes(String(row.referrer).toLowerCase())).reduce((sum,row)=>sum+row.count,0)
    if(totalReferrals>0&&searchVideo>0) {
      sentences.push(`Google and YouTube contributed ${(searchVideo/totalReferrals*100).toFixed(1)}% of top reported referral views${reach?.views>0?` (${(searchVideo/reach.views*100).toFixed(1)}% of all repo views)`:''}.`)
      ids.add('referrers');if(reach?.views>0)ids.add('reach')
    }
  }
  if(sentences.length<2) {
    const video=(queries.youtube_videos?.rows??[]).filter(row=>count(row.views)).sort((a,b)=>b.views-a.views)[0]
    if(video){sentences.push(`The most-viewed tracked video has ${number(video.views)} observed views.`);ids.add('youtube_videos')}
  }
  if(!sentences.length)return null
  return {sentences:[...sentences.slice(0,2),'Next, test the first-run path and measure successful workflow completion.'],queryIds:[...ids]}
}
