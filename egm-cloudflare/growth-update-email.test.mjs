import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import {
  buildGrowthUpdateEmail,
  growthUpdateEmailPreview,
  sendGrowthUpdateEmail,
  defaultGrowthRecipient,
  growthChartLightUrl,
  growthChartDarkUrl
} from './growth-update-email.mjs'
import seed from '../egm-performance/src/data.json' with { type: 'json' }

test('buildGrowthUpdateEmail includes linked improvements, attention items, light/dark images, and zero em dashes', () => {
  const email = buildGrowthUpdateEmail(seed, {
    images: [{
      src: 'https://egm.n3wth.com/email/custom-light.png',
      darkSrc: 'https://egm.n3wth.com/email/custom-dark.png',
      alt: 'Custom brief diagram',
      caption: 'Tracked under #272'
    }]
  })
  assert.equal(email.isoWeek, '2026-W44')
  assert.match(email.subject, /EGM Growth & Weekly Brief \(2026-W44\): 10,838 stars \(\+8,924 over 7 days\)/)
  assert.match(email.text, /https:\/\/egm\.n3wth\.com/)
  assert.match(email.text, /https:\/\/egm\.n3wth\.com\/development#weekly-building-brief/)

  // Verify light and dark mode chart images + custom image support
  assert.match(email.html, new RegExp(growthChartLightUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  assert.match(email.html, new RegExp(growthChartDarkUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  assert.match(email.html, /https:\/\/egm\.n3wth\.com\/email\/custom-light\.png/)
  assert.match(email.html, /https:\/\/egm\.n3wth\.com\/email\/custom-dark\.png/)
  assert.match(email.html, /prefers-color-scheme:dark/)

  // Verify links on User-verified improvements and Needs attention items
  assert.match(email.html, /href="https:\/\/github\.com\/google\/elephant-goldfish-model\/pull\/194"[^>]*>Render brainstorm lenses table with valid GFM pipes<\/a>/)
  assert.match(email.html, /href="https:\/\/github\.com\/google\/elephant-goldfish-model\/issues\/193"[^>]*>Issue #193<\/a>/)
  assert.match(email.html, /href="https:\/\/github\.com\/timfee"[^>]*>@timfee<\/a>/)
  assert.match(email.html, /href="https:\/\/github\.com\/google\/elephant-goldfish-model\/issues\/274"[^>]*>Resolve Claude Code 2\.1\.312 plugin manifest key rejection<\/a>/)
  assert.match(email.html, /href="https:\/\/github\.com\/google\/elephant-goldfish-model\/issues\/272"[^>]*>agy plugin validate --strict fails on root AGENTS\.md and missing plugin\.json logo<\/a>/)
  assert.match(email.html, /href="https:\/\/github\.com\/google\/elephant-goldfish-model\/issues\/196"[^>]*>Unprefixed \/egm-\* slash commands fail discovery when disable-model-invocation is true<\/a>/)
  assert.match(email.html, /href="https:\/\/github\.com\/google\/elephant-goldfish-model\/issues\/238"[^>]*>Claude Code child isolation verifier rejects structured SubagentHandback<\/a>/)
  assert.match(email.html, /href="https:\/\/github\.com\/google\/elephant-goldfish-model\/issues\/261"[^>]*>Bootstrap script test execution and non-Claude harness read-only reviewer enforcement<\/a>/)
  assert.match(email.html, /href="https:\/\/github\.com\/google\/elephant-goldfish-model\/issues\/264"[^>]*>#264<\/a>/)
  assert.match(email.html, /href="https:\/\/github\.com\/google\/elephant-goldfish-model\/issues\/268"[^>]*>#268<\/a>/)

  // Verify preview helper and formatting rules
  const darkPreview = growthUpdateEmailPreview(seed, 'dark')
  assert.match(darkPreview, /\.logo-dark,\.img-dark\{display:block !important/)
  assert.doesNotMatch(email.html, /<strong>/i, 'No mid-sentence strong tags')
  assert.doesNotMatch(email.text, /[—–]/, 'No em or en dashes in plain text')
  assert.doesNotMatch(email.html, /[—–]/, 'No em or en dashes in HTML')
})

test('sendGrowthUpdateEmail sends once via Resend to newth@google.com and records state in D1', async () => {
  const db = new DatabaseSync(':memory:')
  try {
    db.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'))
    const DB = {
      prepare(sql) {
        return {
          async first() { return db.prepare(sql).get() ?? null },
          async run() {
            const res = db.prepare(sql).run()
            return { meta: { changes: res.changes } }
          },
          bind(...args) {
            return {
              async first() { return db.prepare(sql).get(...args) ?? null },
              async run() {
                const res = db.prepare(sql).run(...args)
                return { meta: { changes: res.changes } }
              }
            }
          }
        }
      }
    }
    const calls = []
    const mockFetch = async (url, init) => {
      calls.push({ url, init: { ...init, body: JSON.parse(init.body) } })
      return new Response(JSON.stringify({ id: 're_test_123' }), { status: 200 })
    }
    const env = { DB, RESEND_API_KEY: 're_secret' }

    const blocked = await sendGrowthUpdateEmail(env, { recipient: 'other@example.com' }, mockFetch)
    assert.equal(blocked.status, 'recipient_not_allowed')
    assert.equal(calls.length, 0)

    const first = await sendGrowthUpdateEmail(env, {}, mockFetch)
    assert.equal(first.status, 'sent')
    assert.equal(first.providerId, 're_test_123')
    assert.equal(calls.length, 1)
    assert.equal(calls[0].url, 'https://api.resend.com/emails')
    assert.deepEqual(calls[0].init.body.to, [defaultGrowthRecipient])
    assert.equal(calls[0].init.body.from, 'EGM Dashboard <updates@n3wth.com>')

    const second = await sendGrowthUpdateEmail(env, {}, mockFetch)
    assert.equal(second.status, 'already_sent')
    assert.equal(calls.length, 1, 'Idempotent second call does not re-send')
  } finally {
    db.close()
  }
})
