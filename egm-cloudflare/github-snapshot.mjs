const dateOf = value => value?.slice(0, 10)

export function alignTraffic(views, clones) {
  const cloneMap = new Map(clones.clones.map(row => [row.timestamp, row]))
  const traffic = views.views.map(view => {
    const clone = cloneMap.get(view.timestamp)
    if (!clone) throw Error('Traffic windows do not align')
    return {
      date: view.timestamp.slice(0, 10),
      views: view.count,
      visitors: view.uniques,
      clones: clone.count,
      cloners: clone.uniques
    }
  })
  const viewTotal = traffic.reduce((sum, row) => sum + row.views, 0)
  const cloneTotal = traffic.reduce((sum, row) => sum + row.clones, 0)
  if (viewTotal !== views.count || cloneTotal !== clones.count) throw Error('Traffic totals do not reconcile')
  return traffic
}

export function usableStargazers(starResult, stargazerCount) {
  if (!starResult) return null
  if (Math.abs(starResult.length - stargazerCount) > 5) return null
  if (!starResult.every(row => Number.isFinite(Date.parse(row.starred_at)))) return null
  return starResult
}

export function activityRows(traffic, pulls, issues, commits) {
  return traffic.map(({ date }) => ({
    date,
    mergedPRs: pulls.filter(pull => dateOf(pull.merged_at) === date).length,
    openedIssues: issues.filter(issue => dateOf(issue.created_at) === date).length,
    closedIssues: issues.filter(issue => dateOf(issue.closed_at) === date).length,
    commits: commits.filter(commit => dateOf(commit.commit.committer.date) === date).length
  }))
}

export function issueQueue(openIssues) {
  return [...openIssues]
    .sort((a, b) => b.comments - a.comments)
    .map(issue => ({
      number: issue.number,
      title: issue.title,
      created: dateOf(issue.created_at),
      comments: issue.comments,
      url: issue.html_url
    }))
}

export function downloadRows(releases) {
  return releases.flatMap(release => release.assets.map(asset => ({
    release: release.tag_name,
    asset: asset.name,
    downloads: asset.download_count,
    published: dateOf(release.published_at)
  })))
}

export function referralHistory(previousRows, started, web, traffic) {
  const observations = new Map((previousRows ?? []).map(row => [row.observedAt, row]))
  observations.set(started, {
    observedAt: started,
    referralViews: web?.count ?? null,
    referralVisitors: web?.uniques ?? null
  })
  return {
    rows: [...observations.values()].sort((a, b) => a.observedAt.localeCompare(b.observedAt)).slice(-336),
    source: {
      label: 'GitHub · observed rolling referral totals from egm.dev',
      provider: 'GitHub',
      executedAt: started,
      coverage: { startDate: traffic[0].date, endDate: traffic.at(-1).date },
      metricDefinitions: [{
        label: 'Referral observations',
        definition: 'Actual timestamped observations of GitHub’s rolling 14-day referral views and unique visitors from egm.dev. These are overlapping rolling totals, not daily traffic.'
      }],
      caveats: [
        'Collection starts when this dashboard observes the source. No historical observations are backfilled.',
        'At most 336 observations are retained. Missing top-ten referrer entries stay unknown, never zero.',
        'Changes between overlapping rolling windows do not equal new visits, and GitHub referral visitors are not total website visitors.'
      ],
      links: [{ label: 'Repository traffic', url: 'https://github.com/google/elephant-goldfish-model/graphs/traffic' }],
      evidenceFlow: [{
        title: 'Actual rolling referral observations',
        detail: 'GET /repos/google/elephant-goldfish-model/traffic/popular/referrers; exact egm.dev entry'
      }]
    }
  }
}

const trafficFields = ['views', 'visitors', 'clones', 'cloners']
const trafficDay = row => /^\d{4}-\d{2}-\d{2}$/.test(row?.date ?? '') && trafficFields.every(field => Number.isInteger(row[field]) && row[field] >= 0)

// GitHub's rolling window can truncate its oldest day and the current day is
// partial, so each day keeps the largest count observed for every field.
export function mergeTrafficRows(previousRows, rows, limit = 730) {
  const days = new Map()
  for (const row of [...(previousRows ?? []), ...(rows ?? [])].filter(trafficDay)) {
    const kept = days.get(row.date)
    days.set(row.date, { date: row.date, ...Object.fromEntries(trafficFields.map(field => [field, Math.max(row[field], kept?.[field] ?? 0)])) })
  }
  return [...days.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-limit)
}

export function trafficHistory(previousRows, traffic, started) {
  const rows = mergeTrafficRows(previousRows, traffic)
  return {
    rows,
    source: {
      label: 'GitHub REST API · google/elephant-goldfish-model · retained daily history',
      provider: 'GitHub',
      executedAt: started,
      coverage: { startDate: rows[0]?.date ?? null, endDate: rows.at(-1)?.date ?? null },
      filters: ['Repository: google/elephant-goldfish-model', 'Daily traffic buckets use UTC'],
      metricDefinitions: [
        { label: 'Repository views', definition: 'Repository page views in each UTC day. Excludes egm.dev website pageviews.' },
        { label: 'Daily visitors', definition: 'Unique repository visitors within each day. Visitors overlap across days; daily visitors must not be summed to get period visitors.' },
        { label: 'Clones', definition: 'Clone operations, including automation. Not installs, active users, or retained users.' },
        { label: 'Daily unique cloners', definition: 'Unique cloners in each UTC day. Not additive across dates.' }
      ],
      caveats: [
        'GitHub returns only the latest 14 days. Each scheduled refresh adds them to this retained history, so days before collection began are unavailable.',
        'Each day keeps the largest count observed for each field, because GitHub can truncate the oldest day of its window and the current day is partial.',
        'Days with no observation stay missing, never zero. History grows only while scheduled collection is enabled; at most 730 days are retained.'
      ],
      links: [{ label: 'GitHub traffic', url: 'https://github.com/google/elephant-goldfish-model/graphs/traffic' }],
      evidenceFlow: [{
        title: 'Retained daily traffic',
        detail: 'GET /repos/google/elephant-goldfish-model/traffic/views and /traffic/clones on each scheduled refresh, merged by UTC date with the previously saved history'
      }]
    }
  }
}

export function starHistory(stars) {
  const pacific = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' })
  const starDates = (stars ?? []).map(star => pacific.format(new Date(star.starred_at)))
  const counts = new Map()
  for (const date of starDates) counts.set(date, (counts.get(date) ?? 0) + 1)
  const today = pacific.format(new Date())
  const start = starDates.sort()[0] ?? today
  const history = []
  let total = 0
  for (let day = new Date(start + 'T12:00:00Z'); day.toISOString().slice(0, 10) <= today; day.setUTCDate(day.getUTCDate() + 1)) {
    const date = day.toISOString().slice(0, 10)
    const newStars = counts.get(date) ?? 0
    total += newStars
    history.push({ date, newStars, stars: total })
  }
  return { history, start, today }
}

export function staleStarCaveat(stargazerCount) {
  if (stargazerCount >= 10000) {
    return 'Star history is stale: full stargazer collection was skipped at the 10,000-record bound. Current total stars remain available in the reach query.'
  }
  return 'Star history is stale: stargazer collection failed or was incomplete. Current total stars remain available in the reach query.'
}

export function stampCollectedQueries(data, collectedQueries, started, requests, traffic, starRange) {
  for (const [id, query] of Object.entries(data.queries)) {
    // Seeded independent-provider records are dated evidence, not GitHub results.
    if (!collectedQueries.has(id)) continue
    query.source.executedAt = started
    query.source.coverage = id === 'star_history'
      ? { startDate: starRange.start, endDate: starRange.today }
      : { startDate: traffic[0].date, endDate: traffic.at(-1).date }
    query.source.caveats = (query.source.caveats ?? []).filter(caveat => !caveat.includes('Oct 13') && !caveat.includes('Oct 27'))
    query.source.caveats.push('Automated GitHub refresh. Sources were collected in one run; current counts can change during collection.')
    query.source.evidenceFlow = [{ title: 'Automated GitHub REST collection', detail: requests.join('\n') }]
  }
}
