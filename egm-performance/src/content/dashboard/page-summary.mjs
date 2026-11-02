import {percentage} from './percentage.mjs'
import {reportingRange} from './overview-summary.mjs'
import {channelViews} from './referrer-channels.mjs'
const valid=value=>Number.isFinite(value)&&value>=0
const n=value=>value.toLocaleString('en-US')
const sum=(rows,field)=>rows.length&&rows.every(row=>valid(row[field]))?rows.reduce((total,row)=>total+row[field],0):null
export function pageSummary(page,queries={}) {
  const rows=id=>queries[id]?.rows??[]
  const reach=rows('reach')[0],web=rows('website')[0],queue=rows('maintenance')[0]
  const sentences=[],ids=new Set()
  const add=(text,...used)=>{sentences.push(text);used.forEach(id=>ids.add(id))}
  if(page==='acquisition') {
    const top=channelViews(rows('referrers'))[0]
    if(top)add(`${top.source} leads recorded referrals with ${n(top.count)} repo views.`,'referrers')
    const total=sum(rows('referrers'),'count')
    if(total!==null&&reach?.views>0)add(`GitHub’s top ten reported referrers account for ${percentage(total/reach.views)} of all repo views; the rest is unattributed.`,'referrers','reach')
  }
  if(page==='adoption'&&valid(reach?.clones)) {
    add(`GitHub recorded ${n(reach.clones)} clone operations${valid(reach.cloners)?` from ${n(reach.cloners)} unique cloners`:''} in its two-week traffic window.`,'reach')
    sentences.push('Clones indicate code access; installs and successful first workflows are not measured.')
  }
  if(page==='website') {
    if(valid(web?.referralVisitors)&&valid(web?.referralViews))add(`egm.dev sent ${n(web.referralVisitors)} visitors and ${n(web.referralViews)} repo views to GitHub in its two-week traffic window.`,'website')
    else if(web)add('egm.dev was not among GitHub’s top ten referrers in this window, so its referral counts are unknown.','website')
    const contribution=rows('website_contribution')[0]
    if(valid(contribution?.rank)&&contribution.rank>0)add(`egm.dev ranks #${n(contribution.rank)} among GitHub’s top ten referrers.`,'website_contribution')
  }
  if(page==='development') {
    const parts=[]
    if(valid(queue?.openIssues))parts.push(`${n(queue.openIssues)} open issues`)
    if(valid(queue?.openPRs))parts.push(`${n(queue.openPRs)} open PRs`)
    if(parts.length)add(`The recorded queue has ${parts.join(' and ')}.`,'maintenance')
    const merged=sum(rows('activity'),'mergedPRs')
    if(merged!==null)add(`${n(merged)} PRs were merged during the two-week activity window.`,'activity')
  }
  if(page==='research') {
    if(rows('research_evidence').length){const verified=rows('research_evidence').filter(row=>row.status==='verified').length;add(`${n(verified)} retrieved ${verified===1?'page contains':'pages contain'} an EGM reference.`,'research_evidence')}
    if(rows('exa_research').length)add(`${n(rows('exa_research').length)} indexed research leads are available for review, separate from verified page evidence.`,'exa_research')
    else if(rows('peers').length)add(`${n(rows('peers').filter(row=>row.repo!=='google/elephant-goldfish-model').length)} comparable repos are tracked for first-run patterns.`,'peers')
  }
  if(page==='mentions') {
    const videos=rows('youtube_videos')
    const measured=videos.filter(row=>valid(row.views)).sort((a,b)=>b.views-a.views)
    if(measured.length)add(`The most-viewed YouTube video has ${n(measured[0].views)} views; a view count is available for ${n(measured.length)} of ${n(videos.length)} discovered videos.`,'youtube_videos')
    const social=rows('mentions').filter(row=>row.kind==='Social').length
    if(queries.mentions&&social)add(`${n(social)} social posts are recorded in the primary discovery collection.`,'mentions')
    else if(!measured.length&&queries.mentions)add(`${n(new Set(rows('mentions').map(row=>row.url).filter(Boolean)).size)} source links are recorded in the primary discovery collection.`,'mentions')
  }
  if(!sentences.length)return null
  const kept=sentences.slice(0,2)
  return {sentences:kept,queryIds:[...ids],headline:kept[0],facts:kept.slice(1),range:['research','mentions'].includes(page)?null:reportingRange(queries)}
}
