// Suggested prompts for Ask. The three growth starters carry the evidence-and-experiment prompts that used to
// live behind the Growth advice tab; each tab adds a couple of short questions about what is on screen.
export const growthStarters = [
  {id: 'opportunities', label: 'Find growth opportunities', detail: 'Prioritize experiments', icon: 'lightbulb', question: 'Using the repository traffic, referrers, website and mentions, propose the three most useful growth experiments. For each, give the evidence, a concrete next step, a success measure and what remains unknown. Do not infer causality.'},
  {id: 'first-use', label: 'Improve first use', detail: 'Find onboarding friction', icon: 'sites', question: 'Using repository traffic and available research evidence, propose a small experiment to improve the first EGM workflow. Explain the evidence, the steps, the success measure and what is not measured.'},
  {id: 'distribution', label: 'Explore distribution', detail: 'Discover channels', icon: 'arrowUpRight', question: 'Using referrers, videos and mentions, propose a practical distribution experiment for EGM. Distinguish observed reach from hypotheses and specify how to evaluate it.'},
]

const tabQuestions = {
  reach: ['What changed in the last 7 days compared with the 7 before?', 'What is behind the recent jump in views and clones?'],
  acquisition: ['Which channels send the most repo views, and which are worth testing?', 'How much of our traffic is unattributed?'],
  adoption: ['What do clone counts tell us, and what do they not?', 'How could we measure a successful first workflow?'],
  website: ['How much traffic does egm.dev send to GitHub?', 'What is not measured about the website?'],
  development: ['Which open issues should we look at first?', 'How active has development been in the last two weeks?'],
  research: ['Which comparable repos handle first use better than EGM?', 'Which discussions are worth acting on?'],
  mentions: ['Which videos or posts are driving attention?', 'Where are people talking about EGM?'],
}

export const starterIds = growthStarters.map(starter => starter.id)

/** The dashboard tab id for a URL; Overview is registered as `reach`. */
export function tabIdFromLocation(pathname = '/', search = '') {
  const path = String(pathname).replace(/^\/+|\/+$/g, '')
  const requested = path || new URLSearchParams(search).get('tab') || 'reach'
  const id = requested === 'overview' ? 'reach' : requested
  return Object.hasOwn(tabQuestions, id) ? id : 'reach'
}

export function startersFor(tabId) {
  return {growth: growthStarters, questions: tabQuestions[tabId] ?? tabQuestions.reach}
}
