// Reviewed findings from the egm-lite eval loop (egm-growth lite-loop REPORT.md, rounds/log.yaml and
// dashboard/results.csv, 2026-11-11). Static data: the page does not fetch or refresh it.

export const evalDate = '2026-11-11'

export const result = 'egm-lite v0.2.0 makes better proceed-or-hold decisions than no skill, with far fewer unsupported blockers, fewer invented facts and replies of about the same length.'

export const resultNotes = [
  'The original egm-lite (v0.1.0) was worse than no skill.',
  'The skill does not find more real problems than no skill. Current models already find 97 to 100% of them, so there is no room to show a gain.'
]

// Held-out cases were never used to tune the skill.
export const haikuHeldOut = {
  title: 'Claude Haiku 5.5',
  scope: '8 held-out cases, 3 runs each.',
  columns: ['v0.2.0', 'No skill', 'v0.1.0'],
  rows: [
    {measure: 'Right decision', values: ['92%', '63%', '58%']},
    {measure: 'Unsupported blockers per reply', values: ['0.8', '3.4', '3.4']},
    {measure: 'Replies with an invented fact', values: ['12%', '29%', '21%']},
    {measure: 'Sound plans with no unsupported blocker', values: ['33%', '0%', '0%']},
    {measure: 'Real problems found', values: ['100%', '100%', '100%']},
    {measure: 'Words per reply', values: ['446', '478', '597']}
  ]
}

export const gptHeldOut = {
  title: 'gpt-5.5',
  scope: 'The same 8 held-out cases plus 10 TREK trips, 2 runs each.',
  columns: ['v0.2.0', 'No skill'],
  rows: [
    {measure: 'Right decision, held-out cases', values: ['94%', '81%']},
    {measure: 'Right decision, TREK trips', values: ['95%', '50%']},
    {measure: 'Right decision, sound TREK trips', values: ['92%', '17%']},
    {measure: 'Right decision, flawed TREK trips', values: ['100%', '100%']},
    {measure: 'Unsupported blockers per reply, held-out', values: ['0.25', '1.06']}
  ],
  notes: [
    'Neither version invented a fact, and both found every real problem.',
    'v0.2.0 replies were 36% longer on the held-out cases. This is under the 1.5 times limit.',
    'TREK (CC BY 4.0) was released in August 2026, after both models’ training data. TREK’s own scorer checks its plans.'
  ]
}

export const criteria = [
  {id: '1', criterion: 'Finds more real problems than no skill', met: 'no', status: 'Not shown. Both find 97 to 100%.'},
  {id: '2', criterion: 'Fewer unsupported blockers on sound plans than no skill', met: 'yes', status: 'Met on every set and both models.'},
  {id: '2b', criterion: 'No unsupported blocker in 90% of sound-plan replies', met: 'no', status: 'Not met. 33 to 57% on Haiku. gpt-5.5 holds far fewer sound trips.'},
  {id: '3', criterion: 'Right decision at least as often as no skill, on every case type', met: 'partial', status: 'Met on gpt-5.5. On Haiku, flawed plans drop 5 to 8 points on two hard sets.'},
  {id: '4', criterion: 'No invented fact in 95% of replies', met: 'partial', status: 'Not met on Haiku (87 to 93%). Met on gpt-5.5 (100%).'},
  {id: '5', criterion: 'Says it is a same-context review', met: 'yes', status: 'Met. 100%.'},
  {id: '6', criterion: 'Next step at least as good as no skill', met: 'yes', status: 'Met.'},
  {id: '7', criterion: 'Reads the skill when selected', met: 'yes', status: 'Met. 100%.'},
  {id: '8', criterion: 'No more than 1.5 times longer than no skill', met: 'yes', status: 'Met.'}
]

export const journey = [
  {step: 'Pilot', kind: 'Problem', text: 'In ChatGPT, egm-lite v0.1.0 scored 15 of 18 and no skill scored 16 of 18. It held sound plans for small gaps.', result: 'We built an eval loop with traces, written answer keys and a judge model.'},
  {step: 'Round 0', kind: 'Problem', text: 'v0.1.0 was worse than no skill. It raised more unsupported blockers, invented more facts and was twice as long.', result: 'Cause: “challenge the proposal” and the plan checklist turned gaps into conditions.'},
  {step: 'Round 1', kind: 'Change', text: 'Sort issues as blocker, fix or note. Hold only for a blocker.', result: 'Kept. Unsupported blockers fell, but invented facts rose.'},
  {step: 'Round 2', kind: 'Change', text: 'Restate facts exactly. Use a short, fixed reply order.', result: 'No single change beat round 1. We moved the test model to Claude Haiku 5.5 and reset the baseline.'},
  {step: 'Round 3', kind: 'Change', text: 'Treat facts in the text as true. Do not wait to re-check them.', result: 'Kept. The largest gain: right decisions 91% vs 70%, and about two thirds fewer unsupported blockers.'},
  {step: 'Judges', kind: 'Problem', text: 'The Opus judge did not meet the 0.8 bar against proxy labels.', result: 'We built two pass/fail judges and checked them against RAGTruth, SummEdits and three-model labels.'},
  {step: 'Round 4', kind: 'Change', text: 'Three rules for appendices, unclear terms and misworded summaries.', result: 'No gain beyond noise. Dropped.'},
  {step: 'Round 5', kind: 'Problem', text: 'No skill already found 97% of flaws, even on 30 blind-spot cases.', result: 'We added TREK trips to test calibration. Change kept: recompute figures and check the summary against the details.'},
  {step: 'Round 6', kind: 'Change', text: 'Treat “proceed once X” as a hold. Label own calculations.', result: 'No gain on all sets. Loop stopped. v0.2.0 is the round 5 version.'}
]

export const changes = [
  {round: 1, text: 'Sort each issue as a blocker, a fix to make while proceeding, or a note. Hold only for a blocker.'},
  {round: 2, text: 'Reply in a fixed order: decision, blockers, fixes, next step. Start the review directly.'},
  {round: 3, text: 'Treat facts in the text as true. Do not wait to re-check what the text already says. This was the largest gain.'},
  {round: 5, text: 'Recompute totals and dates from the plan’s own figures. Check the summary against the details.'}
]

export const removed = 'Removed: “challenge the proposal before endorsing it”, the plan checklist and the separate critique section. These caused most unsupported blockers.'

export const method = [
  'The models ran through the OpenAI Agents SDK. In tool mode, the model must open the skill file, as in the ChatGPT app.',
  '77 cases: 27 hand-written (19 for tuning, 8 held out), 30 blind-spot cases and 20 TREK trips.',
  'Judges: Claude Opus 5.5 (rounds 2 to 4), then Claude Sonnet 5.5, plus two pass/fail judges checked against labels.',
  'The blocker judge (Haiku 5.5) scored TPR 0.90 / TNR 1.00 against three-model proxy labels. The invented-fact judge (Sonnet 5.5) scored TPR 0.73 / TNR 0.92 against human labels from RAGTruth and SummEdits.',
  'We kept a change only when it beat the current version by more than the run-to-run noise between two no-skill batches, and it made no other measure worse.'
]

export const limits = [
  'Labels for the blocker judge come from three models, not from people.',
  'Opus over-flags blockers, so absolute “sound plans clean” rates from rounds 2 to 4 are too low.',
  'The line between a fix and a blocker is a judgment call. Some “wrong decisions” on flawed TREK trips name the problem but file it as a fix.',
  'ChatGPT web runs were not repeated for v0.2.0. The gpt-5.5 API runs use the same model family.'
]

// Per-version rows on Claude Haiku 5.5, development cases, Opus judge (results.csv). Fractions; null = not run on this set.
// inventedFree is the share of replies with no invented fact. Rows h5-a, h5-b and h6-* were scored on other sets only.
export const versionRows = [
  {variant: 'No skill', round: 0, status: 'baseline', change: 'Plain model, no skill', decision: 0.705, blockers: 1.779, soundClean: 0.022, inventedFree: 0.45, words: 404},
  {variant: 'v0.1.0', round: 0, status: 'baseline', change: 'egm-lite as shipped in the ChatGPT preview', decision: 0.667, blockers: 2.533, soundClean: 0, inventedFree: 0.44, words: 528},
  {variant: 'h1-b', round: 1, status: 'accepted', change: 'Blocker, fix or note tiers. Only blockers hold the decision', decision: 0.873, blockers: 1.014, soundClean: 0.158, inventedFree: 0.563, words: 503},
  {variant: 'h2-a', round: 2, status: 'rejected', change: 'h1-b + restate facts exactly, label inferences', decision: 0.884, blockers: 0.928, soundClean: 0.118, inventedFree: 0.667, words: 503},
  {variant: 'h2-b', round: 2, status: 'rejected', change: 'h1-b + drop critique section and plan checklist', decision: 0.851, blockers: 1.23, soundClean: 0.136, inventedFree: 0.5, words: 407},
  {variant: 'h2-c', round: 2, status: 'rejected', change: 'h1-b + compact output in tier order, no opener', decision: 0.816, blockers: 1.224, soundClean: 0.125, inventedFree: 0.513, words: 511},
  {variant: 'h2-d', round: 2, status: 'rejected', change: 'h1-b + all three round 2 changes', decision: 0.8, blockers: 1.08, soundClean: 0.13, inventedFree: 0.72, words: 418},
  {variant: 'h3-a', round: 3, status: 'rejected', change: 'h2-a + treat stated facts as true', decision: 0.908, blockers: 0.566, soundClean: 0.375, inventedFree: 0.724, words: 495},
  {variant: 'h3-b', round: 3, status: 'accepted', change: 'h2-d + treat stated facts as true', decision: 0.908, blockers: 0.632, soundClean: 0.292, inventedFree: 0.75, words: 391},
  {variant: 'h3-c', round: 3, status: 'rejected', change: 'h3-a + check the strongest case for proceeding', decision: 0.908, blockers: 0.724, soundClean: 0.25, inventedFree: 0.645, words: 480},
  {variant: 'h3-d', round: 3, status: 'rejected', change: 'h3-b + check the strongest case for proceeding', decision: 0.882, blockers: 0.579, soundClean: 0.167, inventedFree: 0.737, words: 394},
  {variant: 'h4-a', round: 4, status: 'rejected', change: 'h3-b + search the whole text before calling a blocker', decision: 0.908, blockers: 0.697, soundClean: 0.25, inventedFree: 0.829, words: 382},
  {variant: 'h4-b', round: 4, status: 'rejected', change: 'h3-b + an unclear term blocks only if every reading fails', decision: 0.855, blockers: 0.553, soundClean: 0.292, inventedFree: 0.789, words: 393},
  {variant: 'h4-c', round: 4, status: 'rejected', change: 'h3-b + a misworded summary is a fix, not a blocker', decision: 0.855, blockers: 0.553, soundClean: 0.333, inventedFree: 0.697, words: 378},
  {variant: 'h4-d', round: 4, status: 'rejected', change: 'h3-b + all three round 4 rules', decision: 0.842, blockers: 0.605, soundClean: 0.25, inventedFree: 0.605, words: 397},
  {variant: 'h5-a', round: 5, status: 'rejected', change: 'h3-b + recompute totals, dates and units', decision: null, blockers: null, soundClean: null, inventedFree: null, words: null},
  {variant: 'h5-b', round: 5, status: 'rejected', change: 'h3-b + check the summary against the details', decision: null, blockers: null, soundClean: null, inventedFree: null, words: null},
  {variant: 'h5-c (v0.2.0)', round: 5, status: 'accepted', change: 'h3-b + both round 5 checks', decision: 0.92, blockers: 0.613, soundClean: 0.348, inventedFree: 0.72, words: 393},
  {variant: 'h6-a', round: 6, status: 'rejected', change: 'h5-c + “proceed once X” is a hold', decision: null, blockers: null, soundClean: null, inventedFree: null, words: null},
  {variant: 'h6-b', round: 6, status: 'rejected', change: 'h5-c + label own calculations', decision: null, blockers: null, soundClean: null, inventedFree: null, words: null},
  {variant: 'h6-c', round: 6, status: 'rejected', change: 'h5-c + both round 6 rules', decision: null, blockers: null, soundClean: null, inventedFree: null, words: null}
]

export const percent = value => Number.isFinite(value) ? `${Math.round(value * 100)}%` : '—'
export const decimal = value => Number.isFinite(value) ? value.toFixed(2) : '—'
export const whole = value => Number.isFinite(value) ? String(Math.round(value)) : '—'
