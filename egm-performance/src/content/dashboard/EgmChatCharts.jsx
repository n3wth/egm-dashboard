import React, {useMemo, useState} from 'react'
import skills from './egm-chat-skills.json'
import {decimal, percent, versionRows} from './egm-chat-eval.mjs'

const PANELS = [
  {key: 'decision', title: 'Right decision', max: 1, fmt: percent},
  {key: 'blockers', title: 'Unsupported blockers per reply', max: 3, fmt: decimal},
  {key: 'soundClean', title: 'Sound plans with no unsupported blocker', max: 1, fmt: percent}
]

export function VersionDots() {
  const rows = versionRows.filter(row => Number.isFinite(row.decision))
  const none = rows.find(row => row.variant === 'No skill')
  const rowH = 22, top = 8, h = top + rows.length * rowH + 8
  return <div className="egm-chat-dots">
    {PANELS.map(panel => {
      const x = value => 4 + (Math.min(value, panel.max) / panel.max) * 220
      return <figure key={panel.key} className="egm-chat-dot-panel">
        <figcaption>{panel.title}</figcaption>
        <svg viewBox={`0 0 340 ${h}`} role="img" aria-label={`${panel.title} by version`}>
          <line x1={x(none[panel.key])} x2={x(none[panel.key])} y1={top} y2={h - 8} className="egm-chat-dot-base"/>
          {rows.map((row, i) => {
            const y = top + i * rowH + rowH / 2
            return <g key={row.variant} data-status={row.status}>
              <title>{`${row.variant}: ${panel.fmt(row[panel.key])}`}</title>
              <line x1={4} x2={228} y1={y} y2={y} className="egm-chat-dot-grid"/>
              <circle cx={x(row[panel.key])} cy={y} r={5}/>
              <text x={236} y={y + 4}>{`${row.variant.replace(' (v0.2.0)', '')} ${panel.fmt(row[panel.key])}`}</text>
            </g>
          })}
        </svg>
      </figure>
    })}
  </div>
}

const tokens = text => text.match(/\s+|[^\s]+/g) || []

function wordDiff(a, b) {
  const x = tokens(a), y = tokens(b), n = x.length, m = y.length, w = m + 1
  const L = new Uint16Array((n + 1) * w)
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
    L[i * w + j] = x[i] === y[j] ? L[(i + 1) * w + j + 1] + 1 : Math.max(L[(i + 1) * w + j], L[i * w + j + 1])
  const ops = []
  let i = 0, j = 0
  const push = (kind, t) => { const last = ops.at(-1); if (last && last.kind === kind) last.text += t; else ops.push({kind, text: t}) }
  while (i < n && j < m) {
    if (x[i] === y[j]) { push('same', x[i]); i++; j++ }
    else if (L[(i + 1) * w + j] >= L[i * w + j + 1]) push('del', x[i++])
    else push('ins', y[j++])
  }
  while (i < n) push('del', x[i++])
  while (j < m) push('ins', y[j++])
  return ops
}

const words = text => (text.match(/\S+/g) || []).length

export function SkillDiff() {
  const [from, setFrom] = useState(skills[0].id)
  const [to, setTo] = useState(skills.filter(skill => skill.release).at(-1).id)
  const [onlyChanges, setOnlyChanges] = useState(false)
  const A = skills.find(skill => skill.id === from), B = skills.find(skill => skill.id === to)
  const ops = useMemo(() => wordDiff(A.text, B.text), [A, B])
  const added = ops.filter(op => op.kind === 'ins').reduce((sum, op) => sum + words(op.text), 0)
  const removed = ops.filter(op => op.kind === 'del').reduce((sum, op) => sum + words(op.text), 0)
  return <div className="egm-chat-diff-wrap">
    <div className="egm-chat-diff-bar">
      <label>From <select value={from} onChange={event => setFrom(event.target.value)}>{skills.map(skill => <option key={skill.id} value={skill.id}>{skill.label}</option>)}</select></label>
      <label>To <select value={to} onChange={event => setTo(event.target.value)}>{skills.map(skill => <option key={skill.id} value={skill.id}>{skill.label}</option>)}</select></label>
      <label><input type="checkbox" checked={onlyChanges} onChange={event => setOnlyChanges(event.target.checked)}/> Changes only</label>
      <span className="egm-note">{`${added} words added, ${removed} removed. ${A.label}: ${words(A.text)} words. ${B.label}: ${words(B.text)} words.`}</span>
    </div>
    <div className={`egm-chat-diff${onlyChanges ? ' egm-chat-diff-only' : ''}`}>
      {ops.map((op, index) => op.kind === 'same' ? <span key={index} className="egm-chat-same">{op.text}</span> : React.createElement(op.kind, {key: index}, op.text))}
    </div>
  </div>
}
