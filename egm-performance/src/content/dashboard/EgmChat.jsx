import React from 'react'
import {Section} from '../../data-app-public.jsx'
import './egm-chat.css'
import {SkillDiff, VersionDots} from './EgmChatCharts.jsx'
import {changes,criteria,decimal,evalDate,findings,glossary,modelWarning,gptHeldOut,haikuHeldOut,journey,limits,method,percent,recallNote,stats,status,removed,result,resultNotes,versionRows,whole} from './egm-chat-eval.mjs'

const metLabel = {yes: 'Met', no: 'Not met', partial: 'Partly met'}
const displayDate = new Date(evalDate + 'T12:00:00Z').toLocaleDateString('en-US', {year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC'})

function HeldOutTable({table}) {
  return <div className="egm-chat-heldout">
    <h3>{table.title}</h3>
    <p className="egm-note">{table.scope}</p>
    <div className="egm-table-scroll">
      <table className="egm-brief-table egm-chat-table" data-reviewed-rows>
        <thead><tr><th scope="col">Measure</th>{table.columns.map(column => <th scope="col" key={column} className="egm-chat-num">{column}</th>)}</tr></thead>
        <tbody>{table.rows.map(row => <tr key={row.measure}><td>{row.measure}</td>{row.values.map((value, index) => <td key={table.columns[index]} className={`egm-chat-num${index === 0 ? ' egm-chat-current' : ''}`}>{value}</td>)}</tr>)}</tbody>
      </table>
    </div>
    {table.notes?.map(note => <p className="egm-note" key={note}>{note}</p>)}
  </div>
}

function DecisionBar({value}) {
  if (!Number.isFinite(value)) return <span>—</span>
  return <span className="egm-chat-bar"><span className="egm-chat-bar-track" aria-hidden="true"><span style={{width: `${value * 100}%`}}/></span><span>{percent(value)}</span></span>
}

export function EgmChat() {
  return <article className="egm-chat">
    <Section title="egm-chat eval" id="egm-chat-summary-heading" className="egm-dash-hero" spacing="none">
      <p className="egm-dash-hero-headline">{result}</p>
      <p>{status}</p>
      <ul className="egm-chat-stats">{stats.map(item => <li key={item.label}><strong>{item.value}</strong><span>{item.label}</span></li>)}</ul>
      <ul className="egm-dash-hero-facts">{resultNotes.map(note => <li key={note}>{note}</li>)}</ul>
      <p className="egm-dash-hero-range"><span>Eval date: <time dateTime={evalDate}>{displayDate}</time>. Reviewed results, not live data.</span></p>
    </Section>

    <Section title="Main findings" id="egm-chat-findings">
      <ol className="egm-chat-findings">{findings.map(item => <li key={item.title}><strong>{item.title}</strong> {item.text}</li>)}</ol>
    </Section>

    <Section title="Use a strong model" id="egm-chat-warning">
      <p>{modelWarning}</p>
    </Section>

    <Section title="Terms used on this page" id="egm-chat-terms">
      <ul className="egm-chat-list">{glossary.map(item => <li key={item.term}><strong>{item.term}:</strong> {item.text}</li>)}</ul>
    </Section>

    <Section title="Held-out results" id="egm-chat-heldout">
      <p className="egm-note">These cases were never used to tune the skill.</p>
      <div className="egm-chat-pair">
        <HeldOutTable table={haikuHeldOut}/>
        <HeldOutTable table={gptHeldOut}/>
      </div>
    </Section>

    <Section title="Against the success criteria" id="egm-chat-criteria">
      <div className="egm-table-scroll">
        <table className="egm-brief-table egm-chat-table" data-reviewed-rows>
          <thead><tr><th scope="col">#</th><th scope="col">Criterion</th><th scope="col">Status</th><th scope="col">Detail</th></tr></thead>
          <tbody>{criteria.map(row => <tr key={row.id}><td>{row.id}</td><td>{row.criterion}</td><td><span className="egm-chat-status" data-met={row.met}>{metLabel[row.met]}</span></td><td>{row.status}</td></tr>)}</tbody>
        </table>
      </div>
    </Section>

    <Section title="Why the skill cannot raise recall" id="egm-chat-recall">
      <ul className="egm-chat-list">{recallNote.map(item => <li key={item}>{item}</li>)}</ul>
    </Section>

    <Section title="How we got here" id="egm-chat-journey">
      <ol className="egm-chat-steps">{journey.map(item => <li key={item.step}>
        <span className="egm-chat-step">{item.step}</span>
        <span><strong>{item.kind}.</strong> {item.text} <span className="egm-chat-step-result">{item.result}</span></span>
      </li>)}</ol>
    </Section>

    <Section title="Each version against no skill" id="egm-chat-dots">
      <p className="egm-note">Claude Haiku 5.5, development cases, Opus judge. Each row is one skill version. The dashed line is no skill. Green marks a version we kept, red a version we dropped.</p>
      <VersionDots/>
    </Section>

    <Section title="Compare versions" id="egm-chat-compare">
      <p className="egm-note">The full skill text of two versions. Green is added, red is removed.</p>
      <SkillDiff/>
    </Section>

    <Section title="What the skill now says" id="egm-chat-changes">
      <ol className="egm-chat-steps">{changes.map(item => <li key={item.round}><span className="egm-chat-step">Round {item.round}</span><span>{item.text}</span></li>)}</ol>
      <p className="egm-note">{removed}</p>
    </Section>

    <Section title="Versions on Claude Haiku 5.5" id="egm-chat-versions">
      <p className="egm-note">Development cases, scored by the Opus judge. These numbers differ from the held-out results above. Opus over-flags blockers, so “sound plans clean” is too low for every version. Rows with a dash were scored only on other test sets or by another judge. Rounds 7 to 10 used the Haiku judge; their results are in the journey above.</p>
      <div className="egm-table-scroll">
        <table className="egm-brief-table egm-chat-table egm-chat-versions" data-reviewed-rows>
          <thead><tr><th scope="col">Version</th><th scope="col" className="egm-chat-num">Round</th><th scope="col">Status</th><th scope="col">Right decision</th><th scope="col" className="egm-chat-num">Blockers per reply</th><th scope="col" className="egm-chat-num">Sound plans clean</th><th scope="col" className="egm-chat-num">No invented fact</th><th scope="col" className="egm-chat-num">Words</th><th scope="col">Change tested</th></tr></thead>
          <tbody>{versionRows.map(row => <tr key={row.variant} data-status={row.status}>
            <td>{row.variant}</td><td className="egm-chat-num">{row.round}</td><td>{row.status}</td><td><DecisionBar value={row.decision}/></td>
            <td className="egm-chat-num">{decimal(row.blockers)}</td><td className="egm-chat-num">{percent(row.soundClean)}</td><td className="egm-chat-num">{percent(row.inventedFree)}</td><td className="egm-chat-num">{whole(row.words)}</td><td>{row.change}</td>
          </tr>)}</tbody>
        </table>
      </div>
      <p className="egm-note">Rounds 0 and 1 also ran on Gemini 3.7 Flash with a different judge. Those rows are not shown.</p>
    </Section>

    <Section title="How it was tested" id="egm-chat-method">
      <ul className="egm-chat-list">{method.map(item => <li key={item}>{item}</li>)}</ul>
    </Section>

    <Section title="Limits" id="egm-chat-limits">
      <ul className="egm-chat-list">{limits.map(item => <li key={item}>{item}</li>)}</ul>
    </Section>
  </article>
}
