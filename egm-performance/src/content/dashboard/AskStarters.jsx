import React from 'react'
import {Icon} from '../../data-app-public.jsx'
import {startersFor} from './ask-starters.mjs'
import './ask-starters.css'

/** Suggested prompts shown under the Ask box before the first question, like AI Elements' Suggestions. */
export function AskStarters({tabId, onPick}) {
  const {growth, questions} = startersFor(tabId)
  return <div className="egm-ask-starters" role="group" aria-label="Suggested questions">
    <section className="egm-ask-starter-group" aria-labelledby="egm-ask-starters-growth">
      <h4 id="egm-ask-starters-growth">Growth experiments</h4>
      <ul>{growth.map(starter => <li key={starter.id}>
        <button type="button" onClick={() => onPick({id: starter.id, question: starter.question})}>
          <span className="egm-ask-starter-icon"><Icon name={starter.icon} size={18}/></span>
          <span className="egm-ask-starter-text"><strong>{starter.label}</strong><small>{starter.detail}</small></span>
          <Icon name="arrowUpRight" size={14}/>
        </button>
      </li>)}</ul>
    </section>
    <section className="egm-ask-starter-group" aria-labelledby="egm-ask-starters-page">
      <h4 id="egm-ask-starters-page">About this page</h4>
      <ul>{questions.map(question => <li key={question}>
        <button type="button" onClick={() => onPick({id: 'tab-question', question})}>
          <span className="egm-ask-starter-text"><span>{question}</span></span>
          <Icon name="arrowUpRight" size={14}/>
        </button>
      </li>)}</ul>
    </section>
  </div>
}
