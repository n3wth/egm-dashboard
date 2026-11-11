export const pages = [
  {id:'reach',path:'/overview',label:'Overview',summary:'Visitors, views, clones and stars at a glance'},
  {id:'acquisition',path:'/acquisition',label:'Acquisition',summary:'Where repo visitors come from and what they read'},
  {id:'adoption',path:'/adoption',label:'Adoption',summary:'Clones and release downloads, and what they miss'},
  {id:'website',path:'/website',label:'Website',summary:'How much traffic egm.dev sends to the repo'},
  {id:'development',path:'/development',label:'Development',summary:'Open issues and PRs, and daily merge activity'},
  {id:'research',path:'/research',label:'Research',summary:'Comparable projects and evidence worth acting on'},
  {id:'mentions',path:'/mentions',label:'Mentions',summary:'Videos, posts and articles that mention EGM'},
  {id:'egm-lite',path:'/egm-lite',label:'egm-lite eval',summary:'How egm-lite v0.2.0 compares with no skill on held-out cases'}
]

export const pagePath = id => pages.find(page=>page.id===id)?.path ?? null

/** Plain left clicks switch tabs in place; modified and middle clicks keep the browser's own link behaviour. */
export const isPlainClick = event => !event.defaultPrevented&&event.button===0&&!event.metaKey&&!event.ctrlKey&&!event.shiftKey&&!event.altKey
