import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {createServer} from 'vite'

test('research excerpts remain readable and filter status names the active language',async()=>{
  const server=await createServer({server:{middlewareMode:true},logLevel:'silent'})
  try {
    const {ResearchExcerpt,ResearchLeadStatus}=await server.ssrLoadModule('/src/content/dashboard/Research.jsx')
    const render=(Component,props)=>renderToStaticMarkup(React.createElement(Component,props))
    assert.match(render(ResearchExcerpt,{evidence:'A long excerpt'}),/A long excerpt/)
    assert.match(render(ResearchLeadStatus,{selected:2,total:5,language:'english',estimated:true}),/English only \(estimated\)/)
    assert.match(render(ResearchLeadStatus,{selected:5,total:5,language:'all'}),/All languages/)
    const css=await readFile('src/content/dashboard/egm.css','utf8')
    assert.doesNotMatch(css.match(/\.egm-research-excerpt-text\s*\{[^}]*\}/)?.[0]??'',/line-clamp|overflow:\s*hidden/)
  } finally {await server.close()}
})

test('configured discovery displays a neutral empty state',async()=>{
  const server=await createServer({server:{middlewareMode:true},logLevel:'silent'})
  try {
    const {SupplementaryMentions}=await server.ssrLoadModule('/src/content/dashboard/Mentions.jsx')
    const render=discovery=>renderToStaticMarkup(React.createElement(SupplementaryMentions,{discovery}))
    assert.match(render({rows:[],queryIds:['exa_status'],sourceRowsByQuery:{},providers:[['Exa']]}),/No additional links to show/)
    assert.equal(render({rows:[],queryIds:[],sourceRowsByQuery:{},providers:[]}), '')
    const {MissingMentionCollection}=await server.ssrLoadModule('/src/content/dashboard/Mentions.jsx')
    const html=renderToStaticMarkup(React.createElement(MissingMentionCollection,{providers:[['Exa','exa_mentions','exa_status']],queries:{exa_status:{rows:[{status:'unavailable'}]}}}))
    assert.match(html,/unavailable/)
  } finally {await server.close()}
})

test('failed engagement refresh preserves mention identity and cached observed counts',async()=>{
  const server=await createServer({server:{middlewareMode:true},logLevel:'silent'})
  try {
    const {enrichMention}=await server.ssrLoadModule('/src/content/dashboard/Mentions.jsx')
    const mention={url:'https://news.ycombinator.com/item?id=42&utm_source=test',status:'verified',firstSeen:'2026-10-01',title:'Discussion'}
    const engagement=[{url:'https://news.ycombinator.com/item?id=42',status:'unavailable',hnPoints:12,comments:3,engagementObservedAt:'2026-10-02',engagementSource:'Hacker News',lastAttemptAt:'2026-10-03'}]
    assert.deepEqual(enrichMention(mention,engagement),{...mention,hnPoints:12,comments:3,engagementObservedAt:'2026-10-02',engagementSource:'Hacker News'})
  } finally {await server.close()}
})
