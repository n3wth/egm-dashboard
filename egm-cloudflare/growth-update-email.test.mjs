import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import {
  buildGrowthUpdateEmail,
  growthUpdateEmailPreview,
  generateGrowthEmailInsight,
  sendGrowthUpdateEmail,
  defaultGrowthRecipient,
  growthChartLightUrl,
  growthChartDarkUrl
} from './growth-update-email.mjs'
import seed from '../egm-performance/src/data.json' with { type: 'json' }

test('buildGrowthUpdateEmail uses hosted images, single-line linked items, transparent background, and zero em dashes', () => {
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

  // Verify hosted light and dark mode chart URLs + custom image support (no attachments)
  assert.match(email.html, new RegExp(growthChartLightUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  assert.match(email.html, new RegExp(growthChartDarkUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  assert.match(email.html, /https:\/\/egm\.n3wth\.com\/email\/custom-light\.png/)
  assert.match(email.html, /https:\/\/egm\.n3wth\.com\/email\/custom-dark\.png/)
  assert.match(email.html, /prefers-color-scheme:dark/)
  assert.match(email.html, /background:transparent;background-color:transparent/)

  // Verify links on single-line User-verified improvements and Needs attention items
  assert.match(email.html, /href="https:\/\/github\.com\/google\/elephant-goldfish-model\/pull\/194"[^>]*>Valid GFM pipes in brainstorm table<\/a>/)
  assert.match(email.html, /href="https:\/\/github\.com\/google\/elephant-goldfish-model\/issues\/193"[^>]*>#193<\/a>/)
  assert.match(email.html, /href="https:\/\/github\.com\/timfee"[^>]*>@timfee<\/a>/)
  assert.match(email.html, /href="https:\/\/github\.com\/google\/elephant-goldfish-model\/issues\/274"[^>]*>Claude Code 2\.1\.312 manifest key fix<\/a>/)
  assert.match(email.html, /href="https:\/\/github\.com\/google\/elephant-goldfish-model\/issues\/272"[^>]*>agy plugin validate --strict packaging<\/a>/)
  assert.match(email.html, /href="https:\/\/github\.com\/google\/elephant-goldfish-model\/issues\/196"[^>]*>Unprefixed \/egm-\* command discovery<\/a>/)
  assert.match(email.html, /href="https:\/\/github\.com\/google\/elephant-goldfish-model\/issues\/238"[^>]*>SubagentHandback isolation retest<\/a>/)
  assert.match(email.html, /href="https:\/\/github\.com\/google\/elephant-goldfish-model\/issues\/261"[^>]*>Bootstrap tests &amp; read-only reviewer<\/a>/)
  assert.match(email.html, /href="https:\/\/github\.com\/google\/elephant-goldfish-model\/issues\/264"[^>]*>#264<\/a>/)
  assert.match(email.html, /href="https:\/\/github\.com\/google\/elephant-goldfish-model\/issues\/268"[^>]*>#268<\/a>/)

  // Verify preview helper and formatting rules
  const darkPreview = growthUpdateEmailPreview(seed, 'dark')
  assert.match(darkPreview, /\.logo-dark,\.img-dark\{display:block !important/)
  assert.doesNotMatch(email.html, /<strong>/i, 'No mid-sentence strong tags')
  assert.doesNotMatch(email.text, /[—–]/, 'No em or en dashes in plain text')
  assert.doesNotMatch(email.html, /[—–]/, 'No em or en dashes in HTML')
})

test('generateGrowthEmailInsight synthesizes and linkifies LLM one-line insight when INFER is present', async () => {
  const mockEnv = {
    INFER: {
      async run() {
        return { response: 'v0.1.0 lags main by 24 PRs · Ship v0.1.1 and #272 to unblock evaluators.' }
      }
    }
  }
  const line = await generateGrowthEmailInsight(mockEnv, {
    latestRelease: 'v0.1.0',
    unreleasedMergedPRs: 24,
    headline: 'lag',
    implication: 'ship',
    attentionItems: []
  })
  assert.equal(line, 'v0.1.0 lags main by 24 PRs · Ship v0.1.1 and #272 to unblock evaluators.')
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
    assert.equal(calls[0].init.body.attachments, undefined, 'No attachments payload; all images are hosted HTTPS URLs')

    const second = await sendGrowthUpdateEmail(env, {}, mockFetch)
    assert.equal(second.status, 'already_sent')
    assert.equal(calls.length, 1, 'Idempotent second call does not re-send')
  } finally {
    db.close()
  }
})
