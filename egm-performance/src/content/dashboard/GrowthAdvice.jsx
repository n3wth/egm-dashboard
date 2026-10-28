import React, {useState} from 'react'
import {Section} from '../../data-app-public.jsx'
import './growth-advice.css'

const prompts = [
  {label:'Find growth opportunities', question:'Using the repository traffic, referrers, website and mentions, propose the three most useful growth experiments. For each, give the evidence, a concrete next step, a success measure and what remains unknown. Do not infer causality.'},
  {label:'Improve first use', question:'Using repository traffic and available research evidence, propose a small experiment to improve the first EGM workflow. Explain the evidence, the steps, the success measure and what is not measured.'},
  {label:'Explore distribution', question:'Using referrers, videos and mentions, propose a practical distribution experiment for EGM. Distinguish observed reach from hypotheses and specify how to evaluate it.'}
]

export function GrowthAdvice() {
  const [result,setResult] = useState(null)
  const [loading,setLoading] = useState(false)
  const [error,setError] = useState('')
  async function ask(prompt) {
    setLoading(true); setError(''); setResult(null)
    try {
      const response = await fetch('/api/ask', {method:'POST', credentials:'same-origin', headers:{'content-type':'application/json'}, body:JSON.stringify({question:prompt.question})})
      if (!response.ok) throw new Error(response.status===429?'Question limit reached. Try again later.':response.status===401?'Your session expired. Sign in again.':'Advice is unavailable right now. Try again later.')
      const data = await response.json()
      if (typeof data.answer !== 'string' || !data.answer.trim()) throw new Error('The response was incomplete. Try again.')
      setResult({...data, label:prompt.label})
    } catch (failure) { setError(failure.message || 'Advice is unavailable right now.') }
    finally { setLoading(false) }
  }
  return <Section id="growth-advice-heading" title="Growth advice" spacing="none">
    <div className="egm-growth-advice">
      <p>Turn the dashboard’s evidence into proposed experiments. Choose a question to generate advice from the saved dashboard data.</p>
      <div className="egm-growth-prompts">{prompts.map(prompt=><button key={prompt.label} type="button" disabled={loading} onClick={()=>ask(prompt)}>{prompt.label}</button>)}</div>
      <p className="egm-note">Suggestions are hypotheses for review. Repository views and clones do not measure successful first use or retention.</p>
      {loading&&<p role="status">Preparing advice from dashboard data…</p>}
      {error&&<p role="alert">{error}</p>}
      {result&&<article className="egm-growth-result"><h2>{result.label}</h2><p className="egm-growth-answer">{result.answer}</p>
        {result.snapshotAt&&<p className="egm-note">Snapshot: <time dateTime={result.snapshotAt}>{new Date(result.snapshotAt).toLocaleString()}</time></p>}
        {result.coverageNote&&<p className="egm-note">{result.coverageNote}</p>}
        {Array.isArray(result.sources)&&result.sources.length>0&&<details><summary>Sources ({result.sources.length})</summary><ul>{result.sources.map((source,index)=><li key={source.id??index}>[{source.id??index+1}] {source.label??source.title??source.queryId??'Dashboard data'}{source.observedAt&&<> · <time dateTime={source.observedAt}>{new Date(source.observedAt).toLocaleDateString()}</time></>}</li>)}</ul></details>}
      </article>}
    </div>
  </Section>
}
