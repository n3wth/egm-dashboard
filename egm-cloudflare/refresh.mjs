import seed from '../egm-performance/src/data.json' with {type:'json'}
import {activityRows,alignTraffic,downloadRows,issueQueue,ossHealthRows,referralHistory,staleStarCaveat,stampCollectedQueries,starHistory,trafficHistory,usableStargazers} from './github-snapshot.mjs'
import {collectResearch} from './research.mjs'
import {retainGithubHistory} from './github-history.mjs'
import {starObservations} from './star-observations.mjs'
import {maintenanceHistory} from './maintenance-history.mjs'
import {githubCollectionEnabled} from './collection-schedule.mjs'

export function refreshEnabled(env,time=Date.now()) {
  return githubCollectionEnabled(env,time)
}

export async function refreshSnapshot(env,request=fetch,research=collectResearch,{persist=true,previousSnapshot}={}) {
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
  const traffic=alignTraffic(views,clones)
  const stars=usableStargazers(starResult,repo.stargazers_count)
  const issues=issuesAll.filter(issue=>!issue.pull_request)
  const openIssues=issues.filter(issue=>issue.state==='open')
  const openPRs=pulls.filter(pull=>pull.state==='open')
  const web=referrers.find(row=>row.referrer.toLowerCase()==='egm.dev')
  const attributed=referrers.reduce((sum,row)=>sum+row.count,0)
  const data=structuredClone(seed)
  if(previousSnapshot===undefined) {
    const saved=await env.DB.prepare('SELECT body FROM snapshots WHERE id=1').first()
    previousSnapshot=saved?JSON.parse(saved.body):{}
  }
  const previousQueries=previousSnapshot?.queries??{}
  const set=(id,rows)=>{data.queries[id].rows=rows}
  set('traffic',traffic)
  data.queries.traffic_history=trafficHistory([...(previousQueries.traffic_history?.rows??seed.queries.traffic_history?.rows??[]),...(previousQueries.traffic?.rows??[])],traffic,started)
  set('reach',[{views:views.count,visitors:views.uniques,clones:clones.count,cloners:clones.uniques,stars:repo.stargazers_count,forks:repo.forks_count,watchers:repo.subscribers_count}])
  set('referrers',referrers)
  set('paths',paths)
  set('maintenance',[{openIssues:openIssues.length,openPRs:openPRs.length,draftPRs:openPRs.filter(pull=>pull.draft).length}])
  set('activity',activityRows(traffic,pulls,issues,commits))
  set('issue_queue',issueQueue(openIssues))
  set('downloads',downloadRows(releases))
  if(data.queries.oss_health) set('oss_health',ossHealthRows(pulls,issues,releases,started))
  set('website',[{domain:domain.cname,httpsEnforced:domain.https_enforced,domainState:domain.protected_domain_state,certificateState:domain.https_certificate?.state,referralViews:web?.count??null,referralVisitors:web?.uniques??null}])
  data.queries.website_referral_history=referralHistory(previousQueries.website_referral_history?.rows,started,web,traffic)
  set('website_contribution',[{rank:web?referrers.indexOf(web)+1:null,viewShare:web&&views.count?web.count/views.count:null,topTenShare:web&&attributed?web.count/attributed:null,websiteViews:web?.count??null,repositoryViews:views.count,topTenViews:attributed}])
  const starsByDay=starHistory(stars)
  if(stars) set('star_history',starsByDay.history)
  else {
    data.queries.star_history=structuredClone(previousQueries.star_history??data.queries.star_history)
    if(data.queries.star_history?.rows?.[0]?.date===seed.queries.star_history?.rows?.[0]?.date && data.queries.star_history.rows.length<seed.queries.star_history.rows.length) {
      const byDate=new Map(seed.queries.star_history.rows.map(row=>[row.date,row]))
      for(const row of data.queries.star_history.rows) if(row?.date && !byDate.has(row.date)) byDate.set(row.date,row)
      data.queries.star_history.rows=[...byDate.values()].sort((a,b)=>String(a.date).localeCompare(String(b.date)))
      data.queries.star_history.source={
        ...data.queries.star_history.source,
        executedAt:seed.queries.star_history.source.executedAt,
        coverage:seed.queries.star_history.source.coverage
      }
    }
    const caveat=staleStarCaveat(repo.stargazers_count)
    data.queries.star_history.source.caveats=[...new Set([...(data.queries.star_history.source.caveats??[]).filter(text=>!text.startsWith('Star history is stale:')),caveat])]
  }
  const collectedQueries=new Set(['traffic','reach','referrers','paths','maintenance','activity','issue_queue','downloads','website','website_contribution',...(stars?['star_history']:[]),...(data.queries.oss_health?['oss_health']:[])])
  stampCollectedQueries(data,collectedQueries,started,requests,traffic,starsByDay)
  data.queries.star_observations=starObservations(previousSnapshot,repo.stargazers_count,started)
  data.queries.maintenance_history=maintenanceHistory(previousSnapshot,data.queries.maintenance.rows[0],started)
  data.generatedAt=started
  data.buildStatus='complete'
  Object.assign(data.queries,await research(env,request))
  const pickCuratedQuery=key=>{
    const prev=previousQueries[key],seeded=seed?.queries?.[key]
    if(!prev)return seeded
    if(!seeded||(!prev.metadata&&!prev.metrics))return prev
    const prevAt=Date.parse(prev?.source?.executedAt),seedAt=Date.parse(seeded?.source?.executedAt)
    return Number.isFinite(seedAt)&&Number.isFinite(prevAt)&&seedAt>prevAt?seeded:prev
  }
  data.queries.weekly_brief=structuredClone(pickCuratedQuery('weekly_brief'))
  data.queries.workflow_research=structuredClone(pickCuratedQuery('workflow_research'))
  // The multi-source runner stages this result and owns its single final commit.
  if(persist) {
    data.githubHistory=retainGithubHistory(previousSnapshot.githubHistory?previousSnapshot:{...previousSnapshot,githubHistory:retainGithubHistory({},seed)},data)
    await env.DB.prepare('INSERT INTO snapshots(id,body,generated_at) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body,generated_at=excluded.generated_at WHERE excluded.generated_at>snapshots.generated_at').bind(JSON.stringify(data),started).run()
  }
  return {status:'refreshed',generatedAt:started,trafficEnd:traffic.at(-1).date,stars:repo.stargazers_count,starHistoryStatus:stars?'available':'stale',...(!persist?{snapshot:data}:{})}
}
