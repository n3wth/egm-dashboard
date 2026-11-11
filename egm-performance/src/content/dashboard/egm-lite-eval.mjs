// Reviewed findings from the egm-lite eval loop (egm-growth lite-loop REPORT.md, rounds/log.yaml and
// dashboard/results.csv, 2026-11-11). Static data: the page does not fetch or refresh it.

export const evalDate = '2026-11-11'

export const result = 'On strong models, egm-lite v0.3.0 makes the right proceed-or-hold decision on almost every plan. It leaves sound plans alone and still holds every flawed plan.'

export const resultNotes = [
  'No skill holds most sound plans for reasons the plan does not support. The original egm-lite (v0.1.0) was worse than no skill.',
  'The skill does not find more real problems than no skill. Strong models already find 97 to 100% of them.',
  'On a weak model (gemini-3.5-flash-lite), the skill does not raise recall, and it lets some real problems through.'
]

// Held-out cases were never used to tune the skill.
export const haikuHeldOut = {
  title: 'Claude Haiku 5.5',
  scope: '8 held-out cases, 3 runs each.',
  columns: ['v0.3.0', 'v0.2.0', 'No skill', 'v0.1.0'],
  rows: [
    {measure: 'Right decision', values: ['96%', '88%', '58%', '50%']},
    {measure: 'Right decision, flawed plans', values: ['100%', '100%', '92%', '78%']},
    {measure: 'Sound plans with no unsupported blocker', values: ['89%', '33%', '0%', '0%']},
    {measure: 'Unsupported blockers per reply', values: ['0.25', '0.83', '2.5', '2.5']},
    {measure: 'Replies with no invented fact', values: ['92%', '88%', '71%', '—']},
    {measure: 'Real problems found', values: ['100%', '100%', '100%', '100%']},
    {measure: 'Words per reply', values: ['411', '446', '478', '597']}
  ],
  notes: [
    'After removing the measured judge error (Rogan-Gladen), v0.3.0 is 99% for sound plans clean and about 100% for no invented fact.',
    'Haiku replies are graded by Haiku 5.5, which agrees with Sonnet 5.5 on 97% of decisions and 100% of recall.'
  ]
}

export const gptHeldOut = {
  title: 'gpt-5.5',
  scope: 'The same 8 held-out cases plus 10 TREK trips, 2 runs each.',
  columns: ['v0.3.0', 'v0.2.0', 'No skill'],
  rows: [
    {measure: 'Right decision, held-out cases', values: ['100%', '94%', '75%']},
    {measure: 'Right decision, TREK trips', values: ['100%', '90%', '45%']},
    {measure: 'Right decision, flawed plans', values: ['100%', '100%', '100%']},
    {measure: 'Sound plans with no unsupported blocker', values: ['100%', '33-42%', '0-33%']},
    {measure: 'Unsupported blockers per reply, TREK', values: ['0.05', '0.65', '1.95']},
    {measure: 'Real problems found', values: ['100%', '100%', '100%']},
    {measure: 'Words per reply, held-out', values: ['476', '488', '358']}
  ],
  notes: [
    'v0.3.0 replies were 1.33 times longer than no skill on the held-out cases. This is under the 1.5 times limit.',
    'TREK (CC BY 4.0) was released in August 2026, after both models’ training data. TREK’s own scorer checks its plans.'
  ]
}

export const criteria = [
  {id: '1', criterion: 'Finds at least as many real problems as no skill (revised from “more”)', met: 'yes', status: 'Met on all three models. gpt-5.5 and Haiku find 97 to 100% with or without the skill. On flash-lite both find 72 to 83%. No single-reply version found more, so the target changed from “more” to “at least as many”.'},
  {id: '2', criterion: 'Fewer unsupported blockers on sound plans than no skill', met: 'yes', status: 'Met on gpt-5.5 and Haiku.'},
  {id: '2b', criterion: 'No unsupported blocker in 90% of sound-plan replies', met: 'partial', status: 'Met on gpt-5.5 (100%) and on Haiku held-out (89%, 99% corrected). Not met on flash-lite.'},
  {id: '3', criterion: 'Right decision at least as often as no skill, on every case type', met: 'partial', status: 'Met on gpt-5.5 and Haiku held-out. Haiku flawed TREK trips 93% vs 98%. Not met on flash-lite (flawed plans 77 to 79% vs 100%).'},
  {id: '4', criterion: 'No invented fact in 95% of replies', met: 'yes', status: 'Met on gpt-5.5. Met on Haiku after judge-error correction. Not measured on flash-lite.'},
  {id: '5', criterion: 'Says it is a same-context review', met: 'yes', status: 'Met. 100%.'},
  {id: '6', criterion: 'Next step at least as good as no skill', met: 'yes', status: 'Met (Haiku 83% vs 67%).'},
  {id: '7', criterion: 'Reads the skill when selected', met: 'yes', status: 'Met. 100%.'},
  {id: '8', criterion: 'No more than 1.5 times longer than no skill', met: 'yes', status: 'Met (gpt-5.5 1.33 times; Haiku shorter).'}
]

export const recallNote = [
  'Strong models already find nearly every problem without help.',
  'On a weak model, no instruction raised recall: the tier rules, a five-angle review pass modelled on EGM’s lenses, or a recompute-and-cross-check step.',
  'Two independent fresh reviews raise flash-lite recall only from 77% to 82%, because both tend to miss the same flaws.',
  'EGM gets its extra catches from separate reviewers with fresh context. A single chat reply cannot do that.'
]

export const journey = [
  {step: 'Pilot', kind: 'Problem', text: 'In ChatGPT, egm-lite v0.1.0 scored 15 of 18 and no skill scored 16 of 18. It held sound plans for small gaps.', result: 'We built an eval loop with traces, written answer keys and a judge model.'},
  {step: 'Round 0', kind: 'Problem', text: 'v0.1.0 was worse than no skill. It raised more unsupported blockers, invented more facts and was twice as long.', result: 'Cause: “challenge the proposal” and the plan checklist turned gaps into conditions.'},
  {step: 'Round 1', kind: 'Change', text: 'Sort issues as blocker, fix or note. Hold only for a blocker.', result: 'Kept. Unsupported blockers fell, but invented facts rose.'},
  {step: 'Round 2', kind: 'Change', text: 'Restate facts exactly. Use a short, fixed reply order.', result: 'No single change beat round 1. We moved the test model to Claude Haiku 5.5 and reset the baseline.'},
  {step: 'Round 3', kind: 'Change', text: 'Treat facts in the text as true. Do not wait to re-check them.', result: 'Kept. A large gain: right decisions 91% vs 70%, and about two thirds fewer unsupported blockers.'},
  {step: 'Judges', kind: 'Problem', text: 'The Opus judge did not meet the 0.8 bar against proxy labels.', result: 'We built two pass/fail judges and checked them against RAGTruth, SummEdits and three-model labels.'},
  {step: 'Round 4', kind: 'Change', text: 'Three rules for appendices, unclear terms and misworded summaries.', result: 'No gain beyond noise. Dropped.'},
  {step: 'Round 5', kind: 'Problem', text: 'No skill already found 97% of flaws, even on 30 blind-spot cases.', result: 'We added TREK trips to test calibration. Change kept: recompute figures and check the summary against the details. Released as v0.2.0.'},
  {step: 'Round 6', kind: 'Change', text: 'Treat “proceed once X” as a hold. Label own calculations.', result: 'No gain on all sets. Dropped.'},
  {step: 'Round 7', kind: 'Change', text: 'A five-angle review pass modelled on EGM’s lenses, to raise recall on a weak Gemini model.', result: 'Recall did not rise. Decisions on flawed plans got worse. Dropped.'},
  {step: 'Round 8', kind: 'Change', text: 'Never phrase a fix as a precondition. Do not ask to confirm details the plan does not depend on.', result: 'Kept. Sound plans clean rose from 42% to 72% on development cases. Unsupported blockers fell by about 65%.'},
  {step: 'Round 9', kind: 'Change', text: 'Breaking a stated hard limit is a blocker even when it is easy to fix. Anything else is not.', result: 'Kept. Right decisions on TREK trips rose from 77% to 95%.'},
  {step: 'Round 10', kind: 'Change', text: 'Do not add requirements the plan does not state. Approve the plan as written; list fixes for after.', result: 'Kept. Sound plans clean 78 to 94% vs 44 to 61%. gpt-5.5 confirmed it. Released as v0.3.0.'}
]

export const changes = [
  {round: 1, text: 'Sort each issue as a blocker, a fix to make while proceeding, or a note. Hold only for a blocker.'},
  {round: 2, text: 'Reply in a fixed order: decision, blockers, fixes, next step. Start the review directly.'},
  {round: 3, text: 'Treat facts in the text as true. Do not wait to re-check what the text already says.'},
  {round: 5, text: 'Recompute totals and dates from the plan’s own figures. Check the summary against the details.'},
  {round: 8, text: 'Never phrase a fix as a precondition. Do not ask to confirm details the plan does not depend on.'},
  {round: 9, text: 'Breaking a stated hard limit is a blocker even when it is easy to fix. Anything else is not.'},
  {round: 10, text: 'Do not add requirements the plan does not state. Approve the plan as written; list fixes for after.'}
]

export const removed = 'Removed: “challenge the proposal before endorsing it”, the plan checklist and the separate critique section. These caused most unsupported blockers.'

export const method = [
  'The models ran through the OpenAI Agents SDK. In tool mode, the model must open the skill file, as in the ChatGPT app.',
  '77 cases: 27 hand-written (19 for tuning, 8 held out), 30 blind-spot cases and 20 TREK trips.',
  'Rubric judges: Claude Opus 5.5 (rounds 2 to 4), Sonnet 5.5 (rounds 5 and 6), Haiku 5.5 (rounds 7 to 10).',
  'The blocker judge (Haiku 5.5) scored TPR 0.90 / TNR 1.00 against three-model proxy labels. The invented-fact judge (Sonnet 5.5) scored TPR 0.73 / TNR 0.92 against human labels from RAGTruth and SummEdits.',
  'We kept a change only when it beat the current version by more than the run-to-run noise between two no-skill batches, and it made no other measure worse.',
  'Ten rounds, 31 skill versions tested.'
]

export const limits = [
  'Labels for the blocker judge come from three models, not from people.',
  'The held-out set is small (8 cases). The gpt-5.5 check uses 2 runs per case.',
  'The line between a fix and a blocker is a judgment call.',
  'ChatGPT web runs were not repeated. The gpt-5.5 API runs use the same model family.',
  'Gemini 3.6 and 3.7 Flash were overloaded (HTTP 503) during the final rounds, so the Gemini results use flash-lite only.'
]

// Per-version rows on Claude Haiku 5.5, development cases, Opus judge (results.csv). Fractions; null = not run on this set.
// inventedFree is the share of replies with no invented fact. Rows h5-a, h5-b and h6-h10 were scored on other sets or by another judge.
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
  {variant: 'h6-c', round: 6, status: 'rejected', change: 'h5-c + both round 6 rules', decision: null, blockers: null, soundClean: null, inventedFree: null, words: null},
  {variant: 'h7-a', round: 7, status: 'rejected', change: 'h5-c + a five-angle review before deciding, kept internal', decision: null, blockers: null, soundClean: null, inventedFree: null, words: null},
  {variant: 'h7-b', round: 7, status: 'rejected', change: 'h7-a, with the five angles shown as a Checks list', decision: null, blockers: null, soundClean: null, inventedFree: null, words: null},
  {variant: 'h8-a', round: 8, status: 'accepted', change: 'h5-c + never phrase a fix as a precondition', decision: null, blockers: null, soundClean: null, inventedFree: null, words: null},
  {variant: 'h8-b', round: 8, status: 'rejected', change: 'h8-a + quote the goal or rule a hold depends on', decision: null, blockers: null, soundClean: null, inventedFree: null, words: null},
  {variant: 'h8-c', round: 8, status: 'rejected', change: 'h5-c + the quote rule alone', decision: null, blockers: null, soundClean: null, inventedFree: null, words: null},
  {variant: 'h9-a', round: 9, status: 'rejected', change: 'h8-a + breaking a stated hard limit is a blocker', decision: null, blockers: null, soundClean: null, inventedFree: null, words: null},
  {variant: 'h9-b', round: 9, status: 'accepted', change: 'h9-a + anything else is not a blocker', decision: null, blockers: null, soundClean: null, inventedFree: null, words: null},
  {variant: 'h10-a (v0.3.0)', round: 10, status: 'accepted', change: 'h9-b + approve the plan as written; no added requirements', decision: null, blockers: null, soundClean: null, inventedFree: null, words: null},
  {variant: 'h10-b', round: 10, status: 'rejected', change: 'h10-a + a fixed decision line', decision: null, blockers: null, soundClean: null, inventedFree: null, words: null}
]

export const percent = value => Number.isFinite(value) ? `${Math.round(value * 100)}%` : '—'
export const decimal = value => Number.isFinite(value) ? value.toFixed(2) : '—'
export const whole = value => Number.isFinite(value) ? String(Math.round(value)) : '—'
