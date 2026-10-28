import {percentage} from './percentage.mjs'
const valid=value=>Number.isFinite(value)&&value>=0
const n=value=>value.toLocaleString('en-US')
const sum=(rows,field)=>rows.length&&rows.every(row=>valid(row[field]))?rows.reduce((total,row)=>total+row[field],0):null
export function pageSummary(page,queries={}) {
  const rows=id=>queries[id]?.rows??[]
  const reach=rows('reach')[0],web=rows('website')[0],queue=rows('maintenance')[0]
  const sentences=[],ids=new Set()
  const add=(text,...used)=>{sentences.push(text);used.forEach(id=>ids.add(id))}
  if(page==='acquisition') {
    const groups=new Map()
    const names={Google:'Google','youtube.com':'YouTube','linkedin.com':'LinkedIn','com.linkedin.android':'LinkedIn','github.com':'GitHub','egm.dev':'egm.dev'}
    for(const row of rows('referrers'))if(valid(row.count)){const label=names[row.referrer]??row.referrer;groups.set(label,(groups.get(label)??0)+row.count)}
    const top=[...groups].sort((a,b)=>b[1]-a[1])[0]
    if(top)add(`${top[0]} leads recorded referrals with ${n(top[1])} repo views.`,'referrers')
    const total=sum(rows('referrers'),'count')
    if(total!==null&&reach?.views>0)add(`GitHub’s top reported referrers account for ${percentage(total/reach.views)} of all repo views.`,'referrers','reach')
  }
  if(page==='adoption'&&valid(reach?.clones)) {
    add(`GitHub recorded ${n(reach.clones)} clone operations${valid(reach.cloners)?` from ${n(reach.cloners)} unique cloners`:''} in the reporting window.`,'reach')
    sentences.push('Clones indicate code access; installs and successful first workflows are not measured.')
  }
  if(page==='website') {
    if(valid(web?.referralVisitors)&&valid(web?.referralViews))add(`egm.dev referred ${n(web.referralVisitors)} visitors and ${n(web.referralViews)} repo views to GitHub in the reporting window.`,'website')
    const contribution=rows('website_contribution')[0]
    if(valid(contribution?.rank)&&contribution.rank>0)add(`egm.dev ranks #${n(contribution.rank)} among GitHub’s reported referring sources.`,'website_contribution')
  }
  if(page==='development') {
    const parts=[]
    if(valid(queue?.openIssues))parts.push(`${n(queue.openIssues)} open issues`)
    if(valid(queue?.openPRs))parts.push(`${n(queue.openPRs)} open PRs`)
    if(parts.length)add(`The recorded queue has ${parts.join(' and ')}.`,'maintenance')
    const merged=sum(rows('activity'),'mergedPRs')
    if(merged!==null)add(`${n(merged)} PRs were merged during the reported activity window.`,'activity')
  }
  if(page==='research') {
    if(rows('research_evidence').length){const verified=rows('research_evidence').filter(row=>row.status==='verified').length;add(`${n(verified)} retrieved ${verified===1?'page contains':'pages contain'} an EGM reference.`,'research_evidence')}
    if(rows('exa_research').length)add(`${n(rows('exa_research').length)} indexed research leads are available for review, separate from verified page evidence.`,'exa_research')
    else if(rows('peers').length)add(`${n(rows('peers').filter(row=>row.repo!=='google/elephant-goldfish-model').length)} comparable repos are tracked for first-run patterns.`,'peers')
  }
  if(page==='mentions') {
    const videos=rows('youtube_videos')
    const measured=videos.filter(row=>valid(row.views)).sort((a,b)=>b.views-a.views)
    if(measured.length)add(`The most-viewed measured video has ${n(measured[0].views)} observed views; view counts are available for ${n(measured.length)} of ${n(videos.length)} tracked videos.`,'youtube_videos')
    const social=rows('mentions').filter(row=>row.kind==='Social').length
    if(queries.mentions&&social)add(`${n(social)} social posts are recorded in the primary discovery collection.`,'mentions')
    else if(!measured.length&&queries.mentions)add(`${n(new Set(rows('mentions').map(row=>row.url).filter(Boolean)).size)} source links are recorded in the primary discovery collection.`,'mentions')
  }
  return sentences.length?{sentences:sentences.slice(0,2),queryIds:[...ids]}:null
}
