// Reviewed findings from the egm-chat eval loop (egm-growth lite-loop REPORT.md, rounds/log.yaml and
// dashboard/results.csv, 2026-11-11). Static data: the page does not fetch or refresh it.

export const evalDate = '2026-11-11'

export const status = 'With two approved changes to the success criteria, v0.3.0 meets all eight on gpt-5.5 and on Claude Haiku 5.5 held-out cases. Criterion 1 now asks for at least as many real problems found as no skill. Criteria 2 and 3 now apply to strong models. Small, fast models are a known gap.'

export const result = 'On strong models, egm-chat v0.3.0 makes the right proceed-or-hold decision on 96 to 100% of held-out cases, against 58 to 75% without it.'

export const modelWarning = 'Use egm-chat with a strong model, such as GPT-5.5 or Claude. On small, fast models (for example gemini-3.5-flash-lite), it can approve plans that have real problems: it made the right decision on only 77 to 95% of flawed plans. For a review you depend on, use full EGM Review, which uses separate reviewers. This is a known gap.'

export const stats = [
  {value: '12', label: 'rounds'},
  {value: '33', label: 'skill versions tested'},
  {value: '7,726', label: 'model runs'},
  {value: '5', label: 'models'},
  {value: '77', label: 'test cases'},
  {value: '14,320', label: 'judge scores'}
]

export const findings = [
  {title: 'Better decisions.', text: 'On held-out cases, v0.3.0 makes the right proceed-or-hold decision 96 to 100% of the time. Without the skill, the figure is 58 to 75%. The first version (v0.1.0) did worse than no skill.'},
  {title: 'Sound plans left alone.', text: 'With v0.3.0, 89 to 100% of replies to sound plans have no unsupported blocker. Without the skill, the figure is 0 to 33%. On gpt-5.5 and Claude Haiku 5.5, the skill still holds every flawed plan.'},
  {title: 'No extra catches.', text: 'The skill does not find more real problems than no skill. Strong models already find 97 to 100% without help.'},
  {title: 'Weak-model gap.', text: 'On gemini-3.5-flash-lite, no instruction made the model find more real problems. The skill lets some real problems through: right decisions on flawed plans are 77 to 95%, against 100% without the skill.'}
]

export const resultNotes = [
  'No skill holds most sound plans for reasons the plan does not support. The original egm-chat (v0.1.0) was worse than no skill.',
  'The skill does not find more real problems than no skill. Strong models already find 97 to 100% of them without help.',
  'On a weak model (gemini-3.5-flash-lite), the skill does not help the model find more real problems. It also lets some real problems through.'
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
    'We measured how often the judge is wrong and corrected the scores for it (Rogan-Gladen estimator). After correction, 99% of v0.3.0 replies to sound plans have no unsupported blocker, and about 100% have no invented fact.',
    'Haiku 5.5 grades these replies. It agrees with Sonnet 5.5 on 97% of decisions and 100% of real problems found.'
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
    'TREK is a public set of trip plans (CC BY 4.0) with its own scorer. It was released in August 2026, after both models’ training data, so neither model can have seen it.'
  ]
}

export const criteria = [
  {id: '1', criterion: 'Finds at least as many real problems as no skill (changed from “more”)', met: 'yes', status: 'Met on all three models. gpt-5.5 and Haiku find 97 to 100% of real problems, with or without the skill. gemini-3.5-flash-lite finds 72 to 83%, with or without it. In 12 rounds no single-reply version found more, so we changed the target.'},
  {id: '2', criterion: 'Fewer unsupported blockers on sound plans than no skill', met: 'yes', status: 'Met on gpt-5.5 and Haiku.'},
  {id: '2b', criterion: 'No unsupported blocker in 90% of sound-plan replies (strong models, held-out cases)', met: 'yes', status: 'Met on gpt-5.5 (100%) and on Haiku held-out cases (89%, or 99% after judge-error correction). Known gap on gemini-3.5-flash-lite (22 to 83%).'},
  {id: '3', criterion: 'Right decision at least as often as no skill, on every case type (strong models, held-out cases)', met: 'yes', status: 'Met on gpt-5.5 and on Haiku held-out cases. Known gap on gemini-3.5-flash-lite: right on 77 to 95% of flawed plans, against 100%.'},
  {id: '4', criterion: 'No invented fact in 95% of replies', met: 'yes', status: 'Met on gpt-5.5. Met on Haiku after judge-error correction. Not measured on flash-lite.'},
  {id: '5', criterion: 'Tells the user the review ran in the same chat, not by an independent reviewer', met: 'yes', status: 'Met (100%).'},
  {id: '6', criterion: 'Next step at least as good as no skill', met: 'yes', status: 'Met (Haiku 83% vs 67%).'},
  {id: '7', criterion: 'Reads the skill when selected', met: 'yes', status: 'Met (100%).'},
  {id: '8', criterion: 'No more than 1.5 times longer than no skill', met: 'yes', status: 'Met (gpt-5.5 1.33 times; Haiku shorter).'}
]

export const recallNote = [
  'Strong models already find nearly every problem without help.',
  'On a weak model, we tried five kinds of instruction: blocker, fix and note tiers; a review from five angles based on EGM’s reviewer roles; recomputing figures; a second review pass in the same reply; and checking every stated limit first. None made the model find more real problems.',
  'Two separate reviews, each with fresh context, raise real problems found on gemini-3.5-flash-lite only from 77% to 82%. Both reviews tend to miss the same problems.',
  'EGM is the full review method that egm-chat is based on. It uses several separate reviewers, each with fresh context. A single chat reply cannot do that.'
]

export const journey = [
  {step: 'Pilot', kind: 'Problem', text: 'In ChatGPT, egm-chat v0.1.0 scored 15 of 18 and no skill scored 16 of 18. It held sound plans for small gaps.', result: 'We built an automated test loop. A judge model grades each reply against a written answer key.'},
  {step: 'Round 0', kind: 'Problem', text: 'v0.1.0 was worse than no skill. It raised more unsupported blockers, invented more facts and was twice as long.', result: 'Cause: the instruction “challenge the proposal” and the plan checklist made small gaps into conditions for proceeding.'},
  {step: 'Round 1', kind: 'Change', text: 'Sort issues as blocker, fix or note. Hold only for a blocker.', result: 'Kept. Unsupported blockers fell, but invented facts rose.'},
  {step: 'Round 2', kind: 'Change', text: 'Restate facts exactly. Use a short, fixed reply order.', result: 'No single change beat round 1. We moved the test model to Claude Haiku 5.5 and reset the baseline.'},
  {step: 'Round 3', kind: 'Change', text: 'Treat facts in the text as true. Do not wait to re-check them.', result: 'Kept. Right decisions rose to 91%, against 70% before. Unsupported blockers fell by about two thirds.'},
  {step: 'Judges', kind: 'Problem', text: 'The Opus judge missed our target of 0.8 for catching real errors, measured against labels from three models.', result: 'We built two pass/fail judges and checked them against RAGTruth, SummEdits and three-model labels.'},
  {step: 'Round 4', kind: 'Change', text: 'Three rules for appendices, unclear terms and misworded summaries.', result: 'No gain beyond noise. Dropped.'},
  {step: 'Round 5', kind: 'Problem', text: 'Without the skill, the model already found 97% of real problems, even on 30 blind-spot cases (cases written to hide problems models often miss).', result: 'We added TREK trips to test whether the skill holds only the plans it should. Change kept: recompute figures and check the summary against the details. Released as v0.2.0.'},
  {step: 'Round 6', kind: 'Change', text: 'Treat “proceed once X” as a hold. Label own calculations.', result: 'It did not improve results on every test set. Dropped.'},
  {step: 'Round 7', kind: 'Change', text: 'A review pass from five angles, based on EGM’s reviewer roles, to find more problems on gemini-3.5-flash-lite.', result: 'The model did not find more real problems. It made more wrong decisions on flawed plans. Dropped.'},
  {step: 'Round 8', kind: 'Change', text: 'Never phrase a fix as a precondition. Do not ask to confirm details the plan does not depend on.', result: 'Kept. Sound plans with no unsupported blocker rose from 42% to 72% on development cases. Unsupported blockers fell by about 65%.'},
  {step: 'Round 9', kind: 'Change', text: 'If the plan breaks a limit it states, such as a budget cap or a deadline, that is a blocker, even when it is easy to fix. Nothing else is a blocker.', result: 'Kept. Right decisions on TREK trips rose from 77% to 95%.'},
  {step: 'Round 10', kind: 'Change', text: 'Do not add requirements the plan does not state. Approve the plan as written; list fixes for after.', result: 'Kept. Sound plans with no unsupported blocker: 78 to 94%, against 44 to 61% for round 9. A gpt-5.5 run confirmed the gain. Released as v0.3.0.'}
]

export const glossary = [
  {term: 'egm-chat', text: 'a ChatGPT skill that reviews a plan and says proceed or hold.'},
  {term: 'No skill', text: 'the same model with no skill loaded. Every comparison uses it as the baseline.'},
  {term: 'Sound plan / flawed plan', text: 'a sound plan has no problem that should stop it. A flawed plan has at least one.'},
  {term: 'Right decision', text: 'the reply says proceed or hold, as the answer key says.'},
  {term: 'Unsupported blocker', text: 'a reason to hold that the plan text does not support.'},
  {term: 'Real problems found (recall)', text: 'the share of the answer key’s known problems that the reply names.'},
  {term: 'Development / held-out cases', text: 'we tuned the skill on development cases. We never used held-out cases for tuning.'},
  {term: 'Judge model', text: 'a second model that grades each reply against the answer key. It does not know which version wrote the reply.'}
]

export const changes = [
  {round: 1, text: 'Sort each issue as a blocker, a fix to make while proceeding, or a note. Hold only for a blocker.'},
  {round: 2, text: 'Reply in a fixed order: decision, blockers, fixes, next step. Start the review directly.'},
  {round: 3, text: 'Treat facts in the text as true. Do not wait to re-check what the text already says.'},
  {round: 5, text: 'Recompute totals and dates from the plan’s own figures. Check the summary against the details.'},
  {round: 8, text: 'Never phrase a fix as a precondition. Do not ask to confirm details the plan does not depend on.'},
  {round: 9, text: 'If the plan breaks a limit it states, such as a budget cap or a deadline, that is a blocker, even when it is easy to fix. Nothing else is a blocker.'},
  {round: 10, text: 'Do not add requirements the plan does not state. Approve the plan as written; list fixes for after.'}
]

export const removed = 'Removed: “challenge the proposal before endorsing it”, the plan checklist and the separate critique section. These caused most unsupported blockers.'

export const method = [
  'We ran the models through the OpenAI Agents SDK. The skill is not in the prompt: the model must open the skill file itself, as in the ChatGPT app.',
  'We used 77 cases: 27 hand-written (19 for tuning, 8 held out), 30 blind-spot cases and 20 TREK trips.',
  'Judges: Claude Opus 5.5 in rounds 2 to 4, Sonnet 5.5 in rounds 5 and 6, and Haiku 5.5 in rounds 7 to 12.',
  'We tested two pass/fail judges against reference labels. TPR is the share of real errors a judge catches; TNR is the share of clean replies it passes. The blocker judge (Haiku 5.5): TPR 0.90, TNR 1.00, against labels from three models. The invented-fact judge (Sonnet 5.5): TPR 0.73, TNR 0.92, against human labels from the public RAGTruth and SummEdits datasets.',
  'We kept a change only if it beat the current version by more than the normal variation between repeated runs. It also had to make no other measure worse.',
  'We ran 12 rounds and tested 33 skill versions.'
]

export const limits = [
  'Labels for the blocker judge come from three models, not from people.',
  'The held-out set is small (8 cases). The gpt-5.5 check uses 2 runs per case.',
  'The line between a fix and a blocker is a judgment call.',
  'ChatGPT web runs were not repeated. The gpt-5.5 API runs use the same model family.',
  'Gemini 3.6 and 3.7 Flash were overloaded (HTTP 503) in the final rounds. The Gemini results use gemini-3.5-flash-lite only.'
]

// Per-version rows on Claude Haiku 5.5, development cases, Opus judge (results.csv). Fractions; null = not run on this set.
// inventedFree is the share of replies with no invented fact. Rows h5-a, h5-b and h6-h10 were scored on other sets or by another judge.
export const versionRows = [
  {variant: 'No skill', round: 0, status: 'baseline', change: 'Plain model, no skill', decision: 0.705, blockers: 1.779, soundClean: 0.022, inventedFree: 0.45, words: 404},
  {variant: 'v0.1.0', round: 0, status: 'baseline', change: 'egm-chat as shipped in the ChatGPT preview', decision: 0.667, blockers: 2.533, soundClean: 0, inventedFree: 0.44, words: 528},
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
