import {channelViews} from './referrer-channels.mjs'

export const experimentRule = 'Heuristic, not measured impact: prioritize explicit first-use friction, then documentation discovery friction, then a distribution test grounded in recorded referral views. Category scores are 3, 2 and 1; comment counts do not set priority. Issues precede verified prose within a category; ties use the source URL. Only evidence for the selected category is shown.'

const rank = {issue:0,quote:1,referral:2}
const friction=/\b(?:fail(?:s|ed|ure)?|broken|errors?|cannot|unable|stuck|confus\w*|missing|unclear|difficult|hard|friction)\b|\bcan['’]t\b|\bnot working\b/i
const firstUse=/\b(?:install(?:ation|ing)?|setup|set up|first[ -](?:run|workflow)|quick[ -]?start|getting started)\b/i
const documentation=/\b(?:readme|docs?|documentation|tutorial|guide|links?)\b/i

function prose(value) {
  if(typeof value!=='string')return ''
  const text=value.replace(/!\[[^\]]*\]\([^)]*\)/g,' ').replace(/\[([^\]]*)\]\([^)]*\)/g,'$1').replace(/https?:\/\/\S+/gi,' ').replace(/<[^>]*>/g,' ').replace(/[`*_#>\[\]()]/g,' ').replace(/\s+/g,' ').trim()
  return /[a-z]{2,}\s+[a-z]{2,}/i.test(text)?text:''
}

function categoryOf(text) {
  if(!friction.test(text))return null
  if(firstUse.test(text))return 'first-use'
  if(documentation.test(text))return 'docs'
  return null
}

function urlOf(value) {
  if (typeof value !== 'string' || !/^https:\/\//.test(value)) return null
  try { const url = new URL(value); return url.protocol === 'https:' ? url.href : null } catch { return null }
}

export function suggestExperiment(queries = {}) {
  const candidates = []
  for (const issue of queries.issue_queue?.rows ?? []) {
    const url = urlOf(issue.url)
    const title=prose(issue.title)
    const category=categoryOf(title)
    if(!url||!category)continue
    candidates.push({kind:'issue',category,title,url,score:category==='first-use'?3:2})
  }
  for (const row of queries.research_evidence?.rows ?? []) {
    const url = urlOf(row.url)
    const quote=prose(row.contentExcerpt)
    const category=categoryOf(quote)
    if(row.status!=='verified'||!url||!category||(typeof row.rawMarkdown==='string'&&!prose(row.rawMarkdown)))continue
    candidates.push({kind:'quote',category,title:prose(row.title)||quote,url,score:category==='first-use'?3:2,quote})
  }
  const channel=channelViews((queries.referrers?.rows??[]).filter(row=>typeof row.referrer==='string'&&row.referrer.trim()&&Number.isFinite(row.count)&&row.count>0))[0]
  if(channel) {
    candidates.push({kind:'referral',category:'distribution',title:`${channel.source}: ${channel.count.toLocaleString('en-US')} recorded referral views`,url:'https://github.com/google/elephant-goldfish-model/graphs/traffic',score:1,channel:channel.source})
  }
  candidates.sort((a, b) => b.score - a.score || rank[a.kind] - rank[b.kind] || (a.url < b.url ? -1 : a.url > b.url ? 1 : 0))
  const winner = candidates[0]
  if (!winner) return null
  const seen = new Set()
  const evidence = []
  for (const item of candidates) {
    if (item.category!==winner.category||seen.has(item.url)) continue
    seen.add(item.url)
    evidence.push({ kind: item.kind, title: item.title, url: item.url, score: item.score, quote: item.quote ?? null })
    if (evidence.length === 3) break
  }
  const tests={
    'first-use':{action:'Observe five new users following the existing installation and first-workflow instructions without help. Record completion and the first step that stops each person.',success:'Record a completion result for each of five attempts. A repeated blocker becomes the next change to test; this is not a measured install or retention rate.'},
    docs:{action:'Start five new readers at the documentation linked in the evidence. Ask them to find installation and the first-workflow instructions without help; record wrong turns.',success:'Record how many of five readers find the instructions unaided and where the others stop. Test one routing change against the same task.'},
    distribution:{action:`Test one first-workflow example with the audience arriving via ${winner.channel}. Record the published link, date and intended audience.`,success:`Record reader feedback and ${winner.channel}'s next reported rolling 14-day referral count separately. Overlapping referral windows cannot establish causal lift or conversion.`}
  }
  return {rule:experimentRule,...tests[winner.category],category:winner.category,winner,evidence}
}
