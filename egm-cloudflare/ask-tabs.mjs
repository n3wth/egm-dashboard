// Stored snapshot queries and the dashboard tab that shows them. Paths match the Worker page routes.
const tabs = {
  reach: ['/overview', 'Overview'],
  star_history: ['/overview', 'Overview'],
  star_observations: ['/overview', 'Overview'],
  traffic: ['/overview', 'Overview'],
  live_github: ['/overview', 'Overview'],
  referrers: ['/acquisition', 'Acquisition'],
  paths: ['/acquisition', 'Acquisition'],
  downloads: ['/adoption', 'Adoption'],
  website: ['/website', 'Website'],
  website_contribution: ['/website', 'Website'],
  website_referral_history: ['/website', 'Website'],
  web_pagespeed: ['/website', 'Website'],
  web_pagespeed_status: ['/website', 'Website'],
  web_crux: ['/website', 'Website'],
  web_crux_status: ['/website', 'Website'],
  site_performance: ['/website', 'Website'],
  maintenance: ['/development', 'Development'],
  activity: ['/development', 'Development'],
  issue_queue: ['/development', 'Development'],
  weekly_brief: ['/development', 'Development'],
  oss_health: ['/development', 'Development'],
  workflow_research: ['/adoption', 'Adoption'],
  research_evidence: ['/research', 'Research'],
  research_status: ['/research', 'Research'],
  exa_research: ['/research', 'Research'],
  exa_research_status: ['/research', 'Research'],
  peers: ['/research', 'Research'],
  emerging: ['/research', 'Research'],
  research_new_repos: ['/research', 'Research'],
  newly_popular: ['/research', 'Research'],
  semrush_status: ['/research', 'Research'],
  youtube_videos: ['/mentions', 'Mentions'],
  youtube_comments: ['/mentions', 'Mentions'],
  mentions: ['/mentions', 'Mentions'],
  mention_engagement: ['/mentions', 'Mentions'],
  mentions_status: ['/mentions', 'Mentions']
}

export function dashboardTab(queryId) {
  const tab = tabs[queryId]
  return tab ? {tab: tab[0], tabLabel: tab[1]} : {}
}
