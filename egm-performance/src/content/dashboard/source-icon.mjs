import icons from './channel-icons.json' with {type:'json'}

const globe='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/></svg>'
const x='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M18.9 2H22l-6.8 7.8L23 22h-6.2l-4.9-7.4L5.4 22H2l7.4-8.6L1 2h6.4l4.4 6.8L18.9 2Zm-1.1 18h1.7L6.3 3.9H4.5L17.8 20Z"/></svg>'
export function sourceIcon(source) {
  const svg=source==='X'||source==='t.co'||source==='x.com'||source==='twitter.com'?x:icons[source]??globe
  return 'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg.replaceAll('currentColor','#a0a0a0'))
}
