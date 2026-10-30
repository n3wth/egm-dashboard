// Table cards in Ask answers: merge url and title into one source column and mark long text for clipping.
export const humanize=field=>String(field).replace(/([a-z])([A-Z])/g,'$1 $2').replace(/[_-]+/g,' ').replace(/^./,letter=>letter.toUpperCase())
const titleFields=['title','name','label']

export function askTableColumns(columns=[],rows=[],labels={}) {
  const fields=columns.filter(field=>typeof field==='string')
  const titleField=fields.includes('url')?titleFields.find(field=>fields.includes(field)):null
  const merged=fields.includes('url')
  return fields.filter(field=>!(merged&&field==='url'&&titleField)).map(field=>{
    const longest=rows.reduce((max,row)=>Math.max(max,typeof row?.[field]==='string'?row[field].length:0),0)
    return {
      field,
      label:labels[field]??(field===titleField?'Source':field==='url'?'Link':humanize(field)),
      link:field===titleField,
      clip:longest>48||field===titleField||field==='url',
    }
  })
}

// Text shown in a clipped cell and the tooltip that carries the full value.
export function askCellText(value,row,column) {
  const text=value==null||value===''?'—':String(value)
  const tooltip=column.link&&typeof row?.url==='string'?`${text}\n${row.url}`:text
  return {text,tooltip}
}
