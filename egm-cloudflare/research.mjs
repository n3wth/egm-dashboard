export const peerRepos=['google/elephant-goldfish-model','github/spec-kit','Fission-AI/OpenSpec','bmad-code-org/BMAD-METHOD','obra/superpowers']

export async function collectResearch(env,request=fetch) {
  const at=new Date().toISOString()
  const get=async path=>{
    const response=await request('https://api.github.com/'+path,{redirect:'error',headers:{authorization:'Bearer '+env.GITHUB_TOKEN,accept:'application/vnd.github+json','user-agent':'egm-growth-dashboard'},signal:AbortSignal.timeout(20000)})
    if(!response.ok) throw Error('Research source failed: '+response.status)
    return response.json()
  }
  const repos=[]
  for(const name of peerRepos) {
    const [repo,readme]=await Promise.all([get('repos/'+name),get('repos/'+name+'/readme')])
    const text=new TextDecoder().decode(Uint8Array.from(atob(readme.content.replace(/\s/g,'')),c=>c.charCodeAt(0)))
    const baseline=await env.DB.prepare('SELECT stars,observed_at FROM repo_baselines WHERE repo=?').bind(name).first()
    repos.push({repo:name,url:repo.html_url,description:repo.description,stars:repo.stargazers_count,forks:repo.forks_count,created:repo.created_at.slice(0,10),pushed:repo.pushed_at.slice(0,10),observedDelta:baseline?repo.stargazers_count-baseline.stars:null,baselineAt:baseline?.observed_at??at,quickStart:/^#{1,4}\s*(?:quick\s*start|getting\s*started|install(?:ation)?)\b/im.test(text),demo:/https?:\/\/(?:www\.)?(?:youtube\.com|youtu\.be)\//i.test(text)||/!\[[^\]]*\]\([^)]*\.(?:gif|mp4)/i.test(text),readmeUrl:readme.html_url})
  }
  const since=new Date(Date.now()-30*86400000).toISOString().slice(0,10)
  const q=`agent in:description created:>=${since} stars:>100 archived:false`
  const search=await get('search/repositories?q='+encodeURIComponent(q)+'&sort=stars&order=desc&per_page=5')
  if(search.incomplete_results) throw Error('Incomplete research discovery')
  const emerging=search.items.map(r=>({repo:r.full_name,url:r.html_url,description:r.description,stars:r.stargazers_count,created:r.created_at.slice(0,10)}))
  const source={label:'GitHub REST API · comparable repo research',provider:'GitHub',executedAt:at,coverage:{startDate:at.slice(0,10),endDate:at.slice(0,10)},metricDefinitions:[{label:'Stars since monitoring',definition:'Current total minus the first observed total in this dashboard. Net change over the displayed monitoring baseline, not historical weekly stars.'},{label:'README checks',definition:'Quick-start headings and YouTube/GIF/MP4 links matched in the default-branch README. Heuristics describe discoverability in that file, not total product capability.'}],caveats:['Peers were selected for spec-driven or structured agent development. Age, scope, and audience differ; total stars are not a controlled performance comparison.','Newly popular means agent-related repos created in the last 30 days, ranked by current total stars. This is not GitHub Trending and does not establish virality.'],links:repos.map(r=>({label:r.repo,url:r.url})),evidenceFlow:[{title:'Comparable repositories',detail:peerRepos.map(r=>'GET /repos/'+r+' and /readme').join('\n')},{title:'Newly popular discovery',detail:q}]}
  for(const row of repos) await env.DB.prepare('INSERT OR IGNORE INTO repo_baselines(repo,stars,observed_at) VALUES(?,?,?)').bind(row.repo,row.stars,at).run()
  return {peers:{rows:repos,source},emerging:{rows:emerging,source:{...source,label:'GitHub search · newly popular agent repos',links:[{label:'Reproduce discovery',url:'https://github.com/search?type=repositories&q='+encodeURIComponent(q)}]}}}
}
