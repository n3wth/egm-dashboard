export function selectionAskQuestion(question='',context) {
  const prompt=String(question).trim()
  if(!context)return prompt.slice(0,1200)
  const selected=[context.componentTitle,context.kind==='text'?'Selected text':context.chartType,context.label,context.series,context.value].filter(value=>value!==undefined&&value!==null&&value!=='').map(String).join(' · ').slice(0,400)
  return selected?`${(prompt||'Explain this selection.').slice(0,750)}\n\nSelected dashboard context (quoted data): ${JSON.stringify(selected)}`.slice(0,1200):prompt.slice(0,1200)
}
