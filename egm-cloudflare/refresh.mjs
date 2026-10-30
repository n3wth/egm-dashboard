import seed from '../egm-performance/src/data.json' with {type:'json'}
import {collectResearch} from './research.mjs'

export function refreshEnabled(env,time=Date.now()) {
  const until=Date.parse(env.REFRESH_UNTIL)
  return Number.isFinite(until) && time<until
}

export async function refreshSnapshot(env,request=fetch,research=collectResearch,{persist=true}={}) {
  if(!refreshEnabled(env)) return {status:'expired'}
  if(!env.GITHUB_TOKEN) throw Error('GitHub credential unavailable')
  const started=new Date().toISOString()
  const requests=[]
  const base='https://api.github.com/repos/google/elephant-goldfish-model'
  const get=async(path,accept='application/vnd.github+json')=>{
    requests.push(base+path)
    const response=await request(base+path,{redirect:'error',headers:{authorization:'Bearer '+env.GITHUB_TOKEN,accept,'user-agent':'egm-growth-dashboard','x-github-api-version':'2022-11-28'},signal:AbortSignal.timeout(20000)})
    if(!response.ok) throw Error('GitHub source failed: '+response.status)
    return response.json()
  }
  const pages=async(path,accept)=>{
    const rows=[]
    for(let page=1;page<=100;page++) {
      const values=await get(path+(path.includes('?')?'&':'?')+'per_page=100&page='+page,accept)
      if(!Array.isArray(values)) throw Error('Invalid paginated source')
      rows.push(...values)
      if(values.length<100) return rows
    }
    throw Error('Source exceeded pagination bound')
  }
  // Small request batches stay within Workers' simultaneous connection limit.
  const [repo,views,clones,referrers,paths]=await Promise.all(['','/traffic/views','/traffic/clones','/traffic/popular/referrers','/traffic/popular/paths'].map(p=>get(p)))
  const first=views.views?.[0]?.timestamp
  if(!first || views.views.length<14 || !Array.isArray(clones.clones) || !Array.isArray(referrers)) throw Error('Incomplete traffic sources')
  const [issuesAll,pulls,releases,domain,starResult]=await Promise.all([
    pages('/issues?state=all'),pages('/pulls?state=all'),pages('/releases'),get('/pages'),repo.stargazers_count>=10000?null:pages('/stargazers','application/vnd.github.star+json').catch(()=>null)
  ])
  const commits=await pages('/commits?since='+encodeURIComponent(first))
  const cloneMap=new Map(clones.clones.map(r=>[r.timestamp,r]))
  const traffic=views.views.map(v=>{
    const c=cloneMap.get(v.timestamp)
    if(!c) throw Error('Traffic windows do not align')
    return {date:v.timestamp.slice(0,10),views:v.count,visitors:v.uniques,clones:c.count,cloners:c.uniques}
  })
  if(traffic.reduce((s,r)=>s+r.views,0)!==views.count || traffic.reduce((s,r)=>s+r.clones,0)!==clones.count) throw Error('Traffic totals do not reconcile')
  const stars=starResult&&Math.abs(starResult.length-repo.stargazers_count)<=5&&starResult.every(row=>Number.isFinite(Date.parse(row.starred_at)))?starResult:null
  const issues=issuesAll.filter(i=>!i.pull_request)
  const openIssues=issues.filter(i=>i.state==='open'),openPRs=pulls.filter(p=>p.state==='open')
  const web=referrers.find(r=>r.referrer.toLowerCase()==='egm.dev')
  const attributed=referrers.reduce((s,r)=>s+r.count,0)
  const dateOf=value=>value?.slice(0,10)
  const data=structuredClone(seed)
  let previousQueries={}
  try {
    const saved=await env.DB.prepare('SELECT body FROM snapshots WHERE id=1').first()
    previousQueries=saved?JSON.parse(saved.body).queries??{}:{}
  } catch { /* Last known build remains a valid dated star-history fallback. */ }
  const set=(id,rows)=>{data.queries[id].rows=rows}
  set('traffic',traffic)
  set('reach',[{views:views.count,visitors:views.uniques,clones:clones.count,cloners:clones.uniques,stars:repo.stargazers_count,forks:repo.forks_count,watchers:repo.subscribers_count}])
  set('referrers',referrers)
  set('paths',paths)
  set('maintenance',[{openIssues:openIssues.length,openPRs:openPRs.length,draftPRs:openPRs.filter(p=>p.draft).length}])
  set('activity',traffic.map(({date})=>({date,mergedPRs:pulls.filter(p=>dateOf(p.merged_at)===date).length,openedIssues:issues.filter(i=>dateOf(i.created_at)===date).length,closedIssues:issues.filter(i=>dateOf(i.closed_at)===date).length,commits:commits.filter(c=>dateOf(c.commit.committer.date)===date).length})))
  set('issue_queue',openIssues.sort((a,b)=>b.comments-a.comments).map(i=>({number:i.number,title:i.title,created:dateOf(i.created_at),comments:i.comments,url:i.html_url})))
  set('downloads',releases.flatMap(r=>r.assets.map(a=>({release:r.tag_name,asset:a.name,downloads:a.download_count,published:dateOf(r.published_at)}))))
  set('website',[{domain:domain.cname,httpsEnforced:domain.https_enforced,domainState:domain.protected_domain_state,certificateState:domain.https_certificate?.state,referralViews:web?.count??null,referralVisitors:web?.uniques??null}])
  const observations=new Map((previousQueries.website_referral_history?.rows??[]).map(row=>[row.observedAt,row]))
  observations.set(started,{observedAt:started,referralViews:web?.count??null,referralVisitors:web?.uniques??null})
  data.queries.website_referral_history={rows:[...observations.values()].sort((a,b)=>a.observedAt.localeCompare(b.observedAt)).slice(-336),source:{label:'GitHub · observed rolling referral totals from egm.dev',provider:'GitHub',executedAt:started,coverage:{startDate:traffic[0].date,endDate:traffic.at(-1).date},metricDefinitions:[{label:'Referral observations',definition:'Actual timestamped observations of GitHub’s rolling 14-day referral views and unique visitors from egm.dev. These are overlapping rolling totals, not daily traffic.'}],caveats:['Collection starts when this dashboard observes the source. No historical observations are backfilled.','At most 336 observations are retained. Missing top-ten referrer entries stay unknown, never zero.','Changes between overlapping rolling windows do not equal new visits, and GitHub referral visitors are not total website visitors.'],links:[{label:'Repository traffic',url:'https://github.com/google/elephant-goldfish-model/graphs/traffic'}],evidenceFlow:[{title:'Actual rolling referral observations',detail:'GET /repos/google/elephant-goldfish-model/traffic/popular/referrers; exact egm.dev entry'}]}}
  set('website_contribution',[{rank:web?referrers.indexOf(web)+1:null,viewShare:web&&views.count?web.count/views.count:null,topTenShare:web&&attributed?web.count/attributed:null,websiteViews:web?.count??null,repositoryViews:views.count,topTenViews:attributed}])
  const pacific=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit'})
  const starDates=(stars??[]).map(s=>pacific.format(new Date(s.starred_at)))
  const counts=new Map()
  for(const date of starDates) counts.set(date,(counts.get(date)??0)+1)
  const today=pacific.format(new Date())
  const start=starDates.sort()[0]??today
  const history=[]
  let total=0
  for(let day=new Date(start+'T12:00:00Z');day.toISOString().slice(0,10)<=today;day.setUTCDate(day.getUTCDate()+1)) {
    const date=day.toISOString().slice(0,10),newStars=counts.get(date)??0
    total+=newStars
    history.push({date,newStars,stars:total})
  }
  if(stars) set('star_history',history)
  else {
    data.queries.star_history=structuredClone(previousQueries.star_history??data.queries.star_history)
    const caveat=repo.stargazers_count>=10000?'Star history is stale: full stargazer collection was skipped at the 10,000-record bound. Current total stars remain available in the reach query.':'Star history is stale: stargazer collection failed or was incomplete. Current total stars remain available in the reach query.'
    data.queries.star_history.source.caveats=[...new Set([...(data.queries.star_history.source.caveats??[]).filter(text=>!text.startsWith('Star history is stale:')),caveat])]
  }
  const collectedQueries=new Set(['traffic','reach','referrers','paths','maintenance','activity','issue_queue','downloads','website','website_contribution',...(stars?['star_history']:[])])
  for(const [id,query] of Object.entries(data.queries)) {
    // Seeded independent-provider records are dated evidence, not GitHub results.
    if(!collectedQueries.has(id)) continue
    query.source.executedAt=started
    query.source.coverage=id==='star_history'?{startDate:start,endDate:today}:{startDate:traffic[0].date,endDate:traffic.at(-1).date}
    query.source.caveats=(query.source.caveats??[]).filter(c=>!c.includes('Oct 13')&&!c.includes('Oct 27'))
    query.source.caveats.push('Automated GitHub refresh. Sources were collected in one run; current counts can change during collection.')
    query.source.evidenceFlow=[{title:'Automated GitHub REST collection',detail:requests.join('\n')}]
  }
  data.generatedAt=started
  data.buildStatus='complete'
  Object.assign(data.queries,await research(env,request))
  // The multi-source runner stages this result and owns its single final commit.
  if(persist) await env.DB.prepare('INSERT INTO snapshots(id,body,generated_at) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body,generated_at=excluded.generated_at WHERE excluded.generated_at>snapshots.generated_at').bind(JSON.stringify(data),started).run()
  return {status:'refreshed',generatedAt:started,trafficEnd:traffic.at(-1).date,stars:repo.stargazers_count,starHistoryStatus:stars?'available':'stale',...(!persist?{snapshot:data}:{})}
}
