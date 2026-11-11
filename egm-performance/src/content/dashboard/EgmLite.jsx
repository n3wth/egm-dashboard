import React from 'react'
import {Section} from '../../data-app-public.jsx'
import './egm-lite.css'
import {changes,criteria,decimal,evalDate,gptHeldOut,haikuHeldOut,journey,limits,method,percent,removed,result,resultNotes,versionRows,whole} from './egm-lite-eval.mjs'

const metLabel = {yes: 'Met', no: 'Not met', partial: 'Partly met'}
const displayDate = new Date(evalDate + 'T12:00:00Z').toLocaleDateString('en-US', {year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC'})

function HeldOutTable({table}) {
  return <div className="egm-lite-heldout">
    <h3>{table.title}</h3>
    <p className="egm-note">{table.scope}</p>
    <div className="egm-table-scroll">
      <table className="egm-brief-table egm-lite-table" data-reviewed-rows>
        <thead><tr><th scope="col">Measure</th>{table.columns.map(column => <th scope="col" key={column} className="egm-lite-num">{column}</th>)}</tr></thead>
        <tbody>{table.rows.map(row => <tr key={row.measure}><td>{row.measure}</td>{row.values.map((value, index) => <td key={table.columns[index]} className={`egm-lite-num${index === 0 ? ' egm-lite-current' : ''}`}>{value}</td>)}</tr>)}</tbody>
      </table>
    </div>
    {table.notes?.map(note => <p className="egm-note" key={note}>{note}</p>)}
  </div>
}

function DecisionBar({value}) {
  if (!Number.isFinite(value)) return <span>—</span>
  return <span className="egm-lite-bar"><span className="egm-lite-bar-track" aria-hidden="true"><span style={{width: `${value * 100}%`}}/></span><span>{percent(value)}</span></span>
}

export function EgmLite() {
  return <article className="egm-lite">
    <Section title="egm-lite eval" id="egm-lite-summary-heading" className="egm-dash-hero" spacing="none">
      <p className="egm-dash-hero-headline">{result}</p>
      <ul className="egm-dash-hero-facts">{resultNotes.map(note => <li key={note}>{note}</li>)}</ul>
      <p className="egm-dash-hero-range"><span>Eval date: <time dateTime={evalDate}>{displayDate}</time>. Reviewed results, not live data.</span></p>
    </Section>

    <Section title="Held-out results" id="egm-lite-heldout">
      <p className="egm-note">These cases were never used to tune the skill.</p>
      <div className="egm-lite-pair">
        <HeldOutTable table={haikuHeldOut}/>
        <HeldOutTable table={gptHeldOut}/>
      </div>
    </Section>

    <Section title="Against the success criteria" id="egm-lite-criteria">
      <div className="egm-table-scroll">
        <table className="egm-brief-table egm-lite-table" data-reviewed-rows>
          <thead><tr><th scope="col">#</th><th scope="col">Criterion</th><th scope="col">Status</th><th scope="col">Detail</th></tr></thead>
          <tbody>{criteria.map(row => <tr key={row.id}><td>{row.id}</td><td>{row.criterion}</td><td><span className="egm-lite-status" data-met={row.met}>{metLabel[row.met]}</span></td><td>{row.status}</td></tr>)}</tbody>
        </table>
      </div>
    </Section>

    <Section title="How we got here" id="egm-lite-journey">
      <ol className="egm-lite-steps">{journey.map(item => <li key={item.step}>
        <span className="egm-lite-step">{item.step}</span>
        <span><strong>{item.kind}.</strong> {item.text} <span className="egm-lite-step-result">{item.result}</span></span>
      </li>)}</ol>
    </Section>

    <Section title="What the skill now says" id="egm-lite-changes">
      <ol className="egm-lite-steps">{changes.map(item => <li key={item.round}><span className="egm-lite-step">Round {item.round}</span><span>{item.text}</span></li>)}</ol>
      <p className="egm-note">{removed}</p>
    </Section>

    <Section title="Versions on Claude Haiku 5.5" id="egm-lite-versions">
      <p className="egm-note">Development cases, scored by the Opus judge. These numbers differ from the held-out results above. Opus over-flags blockers, so “sound plans clean” is too low for every version. Rows with a dash were scored only on other test sets.</p>
      <div className="egm-table-scroll">
        <table className="egm-brief-table egm-lite-table egm-lite-versions" data-reviewed-rows>
          <thead><tr><th scope="col">Version</th><th scope="col" className="egm-lite-num">Round</th><th scope="col">Status</th><th scope="col">Right decision</th><th scope="col" className="egm-lite-num">Blockers per reply</th><th scope="col" className="egm-lite-num">Sound plans clean</th><th scope="col" className="egm-lite-num">No invented fact</th><th scope="col" className="egm-lite-num">Words</th><th scope="col">Change tested</th></tr></thead>
          <tbody>{versionRows.map(row => <tr key={row.variant} data-status={row.status}>
            <td>{row.variant}</td><td className="egm-lite-num">{row.round}</td><td>{row.status}</td><td><DecisionBar value={row.decision}/></td>
            <td className="egm-lite-num">{decimal(row.blockers)}</td><td className="egm-lite-num">{percent(row.soundClean)}</td><td className="egm-lite-num">{percent(row.inventedFree)}</td><td className="egm-lite-num">{whole(row.words)}</td><td>{row.change}</td>
          </tr>)}</tbody>
        </table>
      </div>
      <p className="egm-note">Rounds 0 and 1 also ran on Gemini 3.7 Flash with a different judge. Those rows are not shown.</p>
    </Section>

    <Section title="How it was tested" id="egm-lite-method">
      <ul className="egm-lite-list">{method.map(item => <li key={item}>{item}</li>)}</ul>
    </Section>

    <Section title="Limits" id="egm-lite-limits">
      <ul className="egm-lite-list">{limits.map(item => <li key={item}>{item}</li>)}</ul>
    </Section>
  </article>
}
