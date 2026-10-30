// Owner notifications to Grok Bot webhook routines. Bearer-authenticated POSTs, one routine per channel.
// Notifications only: nothing here approves, denies or acts on feedback.
import {accessRequestedEvent,sendWebhook} from './approval-events.mjs'
import {feedbackSubmittedEvent} from './feedback-events.mjs'

const sinks = {
  access: {url:'GROK_ACCESS_WEBHOOK_URL',key:'GROK_ACCESS_WEBHOOK_KEY'},
  feedback: {url:'GROK_FEEDBACK_WEBHOOK_URL',key:'GROK_FEEDBACK_WEBHOOK_KEY'}
}

export function grokSink(env, name) {
  const sink = sinks[name], url = env[sink.url], key = env[sink.key]
  return typeof url === 'string' && url && typeof key === 'string' && key && env.GROK_WEBHOOK_HOSTS ? {url,key} : null
}

export async function deliverGrok(env, name, event, fetcher = fetch) {
  const sink = grokSink(env,name)
  if(!sink) throw Error('Sink not configured')
  const result = await sendWebhook(sink.url,JSON.stringify(event),{authorization:'Bearer ' + sink.key},env.GROK_WEBHOOK_HOSTS,fetcher)
  return result.status >= 200 && result.status < 300
}

async function startedAt(env, name, now) {
  await env.DB.prepare('INSERT OR IGNORE INTO notify_sinks(sink,started_at) VALUES(?,?)').bind('grok_' + name,now).run()
  return (await env.DB.prepare('SELECT started_at FROM notify_sinks WHERE sink=?').bind('grok_' + name).first()).started_at
}

async function deliverOnce(env, name, event, time, fetcher) {
  const sink = 'grok_' + name
  await env.DB.prepare('INSERT OR IGNORE INTO notify_receipts(sink,event_id) VALUES(?,?)').bind(sink,event.eventId).run()
  // Atomic lease prevents overlapping scheduled and request-triggered deliveries.
  const receipt = await env.DB.prepare('UPDATE notify_receipts SET attempts=attempts+1,next_attempt=? WHERE sink=? AND event_id=? AND complete=0 AND attempts<12 AND next_attempt<=? RETURNING attempts').bind(time + 600,sink,event.eventId,time).first()
  if(!receipt) return null
  let complete = 0
  try {complete = await deliverGrok(env,name,event,fetcher) ? 1 : 0} catch { /* Retry without logging payloads or credentials. */ }
  await env.DB.prepare('UPDATE notify_receipts SET complete=?,next_attempt=? WHERE sink=? AND event_id=?').bind(complete,time + Math.min(300,10 * 2 ** receipt.attempts),sink,event.eventId).run()
  return complete
}

export async function flushGrokNotifications(env, fetcher = fetch) {
  const time = Math.floor(Date.now() / 1000)
  let remaining = 20
  if(grokSink(env,'access')) {
    const pending = (await env.DB.prepare("SELECT id,name,email,created_at FROM users WHERE status='pending' AND verified=1 ORDER BY created_at LIMIT 100").all()).results
    for(const person of pending) {
      if(remaining <= 0) return
      const event = {eventId:'access_' + person.id,name:accessRequestedEvent.name,test:false,timestamp:person.created_at,data:{request_id:person.id,name:person.name,email:person.email,url:env.APP_URL}}
      const result = await deliverOnce(env,'access',event,time,fetcher)
      if(result === null) continue
      remaining--
      if(!result) break
    }
  }
  if(grokSink(env,'feedback')) {
    // Only feedback submitted after this sink was first enabled; no backfill of older items.
    const since = await startedAt(env,'feedback',time * 1000)
    const items = (await env.DB.prepare('SELECT id,kind,message,created_at FROM feedback_items WHERE created_at>=? ORDER BY created_at LIMIT 100').bind(since).all()).results
    for(const item of items) {
      if(remaining <= 0) return
      const event = {eventId:'feedback_' + item.id,name:feedbackSubmittedEvent.name,test:false,timestamp:new Date(item.created_at).toISOString(),data:{feedback_id:item.id,kind:item.kind,message:item.message}}
      const result = await deliverOnce(env,'feedback',event,time,fetcher)
      if(result === null) continue
      remaining--
      if(!result) break
    }
  }
}
