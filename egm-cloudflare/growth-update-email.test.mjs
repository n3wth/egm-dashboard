import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import {
  buildGrowthUpdateEmail,
  growthUpdateEmailPreview,
  generateGrowthEmailInsight,
  sendGrowthUpdateEmail,
  createUnsubscribeToken,
  verifyUnsubscribeToken,
  unsubscribeGrowthEmail,
  defaultGrowthRecipient,
  growthChartLightUrl,
  growthChartDarkUrl
} from './growth-update-email.mjs'
import { handle } from './worker.mjs'
import seed from '../egm-performance/src/data.json' with { type: 'json' }

test('buildGrowthUpdateEmail uses hosted images, single-line linked items, Monday schedule note, Unsubscribe link, transparent background, and zero em dashes', () => {
  const email = buildGrowthUpdateEmail(seed, {
    unsubscribeUrl: 'https://egm.n3wth.com/email/unsubscribe?token=abc.def',
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
  assert.match(email.text, /Future briefs arrive Mondays · Unsubscribe: https:\/\/egm\.n3wth\.com\/email\/unsubscribe\?token=abc\.def/)
  assert.match(email.html, /EGM Growth Dashboard · Future briefs arrive Mondays/)
  assert.match(email.html, /Breakout week\. Two blockers before v0\.1\.1\./)
  assert.match(email.html, /Your to-do list for v0\.1\.1/)
  assert.match(email.html, /Confirmed fixed by users/)
  assert.doesNotMatch(email.html, /text-transform:uppercase/, 'No all-caps labels')
  assert.doesNotMatch(email.html, /logo-dark|egm-mark-white/, 'Single logo on a fixed tile, no light/dark swap')
  assert.match(email.html, /href="https:\/\/egm\.n3wth\.com\/email\/unsubscribe\?token=abc\.def"[^>]*>Unsubscribe<\/a>/)

  // Verify hosted light and dark mode chart URLs + custom image support (no attachments)
  assert.match(email.html, new RegExp(growthChartLightUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  assert.match(email.html, new RegExp(growthChartDarkUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  assert.match(email.html, /https:\/\/egm\.n3wth\.com\/email\/custom-light\.png/)
  assert.match(email.html, /https:\/\/egm\.n3wth\.com\/email\/custom-dark\.png/)
  assert.match(email.html, /prefers-color-scheme:dark/)
  assert.doesNotMatch(email.html, /mix-blend-mode/)
  assert.match(email.html, />Total stars since launch<\/td>/)
  assert.match(email.html, />New per day, last 14 days<\/td>/)

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
  assert.match(darkPreview, /\.img-dark\{display:block !important/)
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

test('sendGrowthUpdateEmail sends individually to all approved members, excludes pending/denied/unsubscribed, includes List-Unsubscribe headers, and enforces Monday schedule gate', async () => {
  const db = new DatabaseSync(':memory:')
  try {
    db.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'))
    db.prepare("INSERT INTO users(id,email,name,verified,status,created_at) VALUES('u1','newth@google.com','Oliver',1,'approved','2026-10-01T00:00:00Z')").run()
    db.prepare("INSERT INTO users(id,email,name,verified,status,created_at) VALUES('u2','member2@google.com','Member Two',1,'approved','2026-10-02T00:00:00Z')").run()
    db.prepare("INSERT INTO users(id,email,name,verified,status,created_at) VALUES('u3','pending@google.com','Pending User',1,'pending','2026-10-03T00:00:00Z')").run()
    db.prepare("INSERT INTO users(id,email,name,verified,status,created_at) VALUES('u4','denied@google.com','Denied User',1,'denied','2026-10-04T00:00:00Z')").run()

    const DB = {
      prepare(sql) {
        return {
          async first() { return db.prepare(sql).get() ?? null },
          async all() { return { results: db.prepare(sql).all() } },
          async run() {
            const res = db.prepare(sql).run()
            return { meta: { changes: res.changes } }
          },
          bind(...args) {
            return {
              async first() { return db.prepare(sql).get(...args) ?? null },
              async all() { return { results: db.prepare(sql).all(...args) } },
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
      return new Response(JSON.stringify({ id: `re_test_${calls.length}` }), { status: 200 })
    }
    const secret = 's'.repeat(64)
    const env = { APP_URL: 'https://egm.n3wth.com', DB, RESEND_API_KEY: 're_secret', SESSION_SECRET: secret }

    // 1. Non-approved explicit recipient is rejected
    const blocked = await sendGrowthUpdateEmail(env, { recipient: 'other@example.com' }, mockFetch)
    assert.equal(blocked.status, 'recipient_not_allowed')
    assert.equal(calls.length, 0)

    // 2. Monday schedule guard skips non-Monday automatic cron ticks
    const tuesdaySkip = await sendGrowthUpdateEmail(
      env,
      { onlyMondays: true, nowDate: new Date('2026-11-03T16:00:00Z') },
      mockFetch
    )
    assert.equal(tuesdaySkip.status, 'skipped_not_monday')
    assert.equal(calls.length, 0)

    // 3. Unsubscribe token and public /email/unsubscribe endpoint
    const unsubToken = await createUnsubscribeToken('member2@google.com', secret)
    assert.equal(await verifyUnsubscribeToken(unsubToken, secret), 'member2@google.com')
    assert.equal(await verifyUnsubscribeToken(unsubToken + 'x', secret), null)

    // 4. Broadcast sends individually to each approved member (never exposing multiple addresses in `to`)
    const broadcast = await sendGrowthUpdateEmail(env, { idempotencySuffix: 'w44-broadcast' }, mockFetch)
    assert.equal(broadcast.status, 'sent')
    assert.equal(broadcast.sentCount, 2)
    assert.equal(calls.length, 2)
    assert.deepEqual(calls[0].init.body.to, ['newth@google.com'], 'Recipient 1 gets an isolated email')
    assert.deepEqual(calls[1].init.body.to, ['member2@google.com'], 'Recipient 2 gets an isolated email')
    for (const call of calls) {
      assert.equal(call.init.body.to.length, 1, 'Never batch multiple recipients in a single email')
      assert.equal(call.init.body.from, 'EGM Dashboard <updates@n3wth.com>')
      assert.equal(call.init.body.attachments, undefined, 'No attachments payload')
      assert.match(call.init.body.headers['List-Unsubscribe'], /^<https:\/\/egm\.n3wth\.com\/email\/unsubscribe\?token=[^>]+>$/)
      assert.equal(call.init.body.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click')
    }

    // 5. Second call with same idempotencySuffix is idempotent
    const second = await sendGrowthUpdateEmail(env, { idempotencySuffix: 'w44-broadcast' }, mockFetch)
    assert.equal(second.status, 'already_sent')
    assert.equal(calls.length, 2)

    // 6. Unsubscribing member2 via GET /email/unsubscribe prevents future sends to member2
    const getUnsub = await handle(new Request(`https://egm.n3wth.com/email/unsubscribe?token=${encodeURIComponent(unsubToken)}`), env)
    assert.equal(getUnsub.status, 200)
    assert.match(await getUnsub.text(), /Unsubscribed/)

    const nextMonday = await sendGrowthUpdateEmail(
      env,
      { onlyMondays: true, nowDate: new Date('2026-11-09T16:00:00Z'), idempotencySuffix: 'w45-monday' },
      mockFetch
    )
    assert.equal(nextMonday.status, 'sent')
    assert.equal(nextMonday.sentCount, 1)
    assert.equal(calls.length, 3)
    assert.deepEqual(calls[2].init.body.to, ['newth@google.com'], 'Unsubscribed member2 is skipped')
  } finally {
    db.close()
  }
})
