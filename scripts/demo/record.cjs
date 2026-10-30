// Records a scripted walkthrough of the local EGM dashboard as timestamped JPEG frames.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const WORK = process.env.DEMO_DIR || path.join(__dirname, '.out');
const OUT = path.join(WORK, 'frames');
const W = 1440, H = 900;
const URL = process.env.DEMO_URL || 'http://127.0.0.1:5173/overview';

const overlay = `
(() => {
  const install = () => {
    if (document.getElementById('demo-cursor')) return;
    const style = document.createElement('style');
    style.textContent = \`
      #demo-cursor{position:fixed;left:0;top:0;width:22px;height:22px;z-index:2147483647;pointer-events:none;
        transform:translate(-100px,-100px);transition:transform 0s;}
      #demo-cursor svg{filter:drop-shadow(0 2px 3px rgba(0,0,0,.35))}
      .demo-ripple{position:fixed;width:36px;height:36px;margin:-18px 0 0 -18px;border-radius:50%;z-index:2147483646;
        pointer-events:none;background:rgba(37,99,235,.28);border:2px solid rgba(37,99,235,.6);animation:demo-r .5s ease-out forwards}
      @keyframes demo-r{from{transform:scale(.3);opacity:1}to{transform:scale(1.4);opacity:0}}
      #demo-caption{position:fixed;left:50%;bottom:36px;z-index:2147483645;pointer-events:none;
        transform:translate(-50%,20px);opacity:0;transition:opacity .35s ease,transform .35s ease;
        background:rgba(17,17,17,.88);color:#fff;font:500 19px/1.35 "Suisse Intl",-apple-system,system-ui,sans-serif;
        padding:12px 22px;border-radius:999px;letter-spacing:-.01em;box-shadow:0 8px 30px rgba(0,0,0,.25);white-space:nowrap}
      #demo-caption.show{opacity:1;transform:translate(-50%,0)}
      #demo-caption b{font-weight:600;color:#93c5fd;margin-right:8px}
    \`;
    document.head.appendChild(style);
    const c = document.createElement('div');
    c.id = 'demo-cursor';
    c.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24"><path d="M4 2l15 11.5-6.6.9 3.9 7.4-2.9 1.4-3.8-7.5L4 20z" fill="#111" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>';
    document.body.appendChild(c);
    const cap = document.createElement('div');
    cap.id = 'demo-caption';
    document.body.appendChild(cap);
    addEventListener('mousemove', e => { c.style.transform = 'translate(' + (e.clientX - 3) + 'px,' + (e.clientY - 2) + 'px)'; }, true);
    addEventListener('mousedown', e => {
      const r = document.createElement('div'); r.className = 'demo-ripple';
      r.style.left = e.clientX + 'px'; r.style.top = e.clientY + 'px';
      document.body.appendChild(r); setTimeout(() => r.remove(), 600);
    }, true);
  };
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', install); else install();
})();
`;

(async () => {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, colorScheme: 'light' });
  await ctx.addInitScript(overlay);
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  let mx = W / 2, my = H / 2;
  const sleep = ms => page.waitForTimeout(ms);
  const ease = t => (t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  async function move(x, y, ms = 700) {
    const steps = Math.max(8, Math.round(ms / 16));
    const sx = mx, sy = my;
    for (let i = 1; i <= steps; i++) {
      const k = ease(i / steps);
      await page.mouse.move(sx + (x - sx) * k, sy + (y - sy) * k);
      await sleep(ms / steps);
    }
    mx = x; my = y;
  }
  async function moveTo(locator, ms, dx = 0.5, dy = 0.5) {
    await locator.scrollIntoViewIfNeeded().catch(() => {});
    const box = await locator.boundingBox();
    if (!box) throw new Error('no box for ' + locator);
    await move(box.x + box.width * dx, box.y + box.height * dy, ms);
    return box;
  }
  async function click(locator, ms = 700) {
    const box = await moveTo(locator, ms);
    await sleep(120);
    await locator.click({ position: { x: box.width / 2, y: box.height / 2 } });
  }
  async function scrollTo(y, ms = 1200) {
    await page.evaluate(([y, ms]) => new Promise(res => {
      const s = scrollY, d = Math.max(0, Math.min(y, document.documentElement.scrollHeight - innerHeight)) - s, t0 = performance.now();
      const e = t => (t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
      const f = now => { const k = Math.min(1, (now - t0) / ms); scrollTo(0, s + d * e(k)); k < 1 ? requestAnimationFrame(f) : res(); };
      requestAnimationFrame(f);
    }), [y, ms]);
    await sleep(100);
  }
  async function scrollToEl(locator, offset = 90, ms = 1200) {
    const y = await locator.evaluate((el, o) => el.getBoundingClientRect().top + scrollY - o, offset);
    await scrollTo(y, ms);
  }
  async function caption(html) {
    await page.evaluate(h => {
      const c = document.getElementById('demo-caption');
      if (!h) return c.classList.remove('show');
      c.classList.remove('show');
      setTimeout(() => { c.innerHTML = h; c.classList.add('show'); }, c.innerHTML ? 250 : 0);
    }, html);
  }
  async function sweep(locator, ms = 2200, y = 0.55, from = 0.08, to = 0.92) {
    const box = await moveTo(locator, 600, from, y);
    const steps = Math.round(ms / 25);
    for (let i = 1; i <= steps; i++) {
      const k = i / steps;
      mx = box.x + box.width * (from + (to - from) * k); my = box.y + box.height * y;
      await page.mouse.move(mx, my);
      await sleep(25);
    }
  }
  const tab = name => page.locator(`[role=tab][aria-label="${name}"]`);
  const card = title => page.locator('section, article, div').filter({ has: page.getByText(title, { exact: true }) }).filter({ has: page.locator('.recharts-surface') }).last();

  // --- start capture
  const cdp = await ctx.newCDPSession(page);
  const frames = [];
  let n = 0;
  cdp.on('Page.screencastFrame', async ({ data, metadata, sessionId }) => {
    const file = path.join(OUT, String(n++).padStart(6, '0') + '.jpg');
    fs.writeFileSync(file, Buffer.from(data, 'base64'));
    frames.push({ file, t: metadata.timestamp });
    cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: W, maxHeight: H, everyNthFrame: 1 });
  // A tiny always-on animation keeps the screencast emitting frames during still moments.
  await page.evaluate(() => {
    const d = document.createElement('div');
    d.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;opacity:.01;pointer-events:none;z-index:2147483647';
    document.body.appendChild(d);
    let i = 0; const f = () => { d.style.background = (i++ % 2) ? '#fff' : '#fefefe'; requestAnimationFrame(f); }; f();
  });

  await page.mouse.move(mx, my);
  await sleep(600);

  // 1. Overview headline + KPIs
  await caption('<b>Overview</b>Two weeks of EGM growth, summarised in one line');
  await moveTo(page.getByText('88% of 29,252 repo views', { exact: false }).first(), 900, 0.3);
  await sleep(1400);
  await caption('<b>KPIs</b>Visitors, views, clones and stars with trend sparklines');
  for (const label of ['Unique visitors', 'Repo views', 'Clone operations', 'Total stars']) {
    await moveTo(page.getByText(label, { exact: true }).first(), 450, 0.5, 6);
    await sleep(350);
  }
  await click(page.locator('button.info[aria-label="More information"]').nth(1), 600);
  await sleep(1800);
  await page.keyboard.press('Escape');
  await move(720, 600, 500);

  // 2. Charts on overview
  const daily = page.getByText('Daily views and unique visitors', { exact: true }).first();
  await caption('<b>Traffic</b>Hover any chart for exact daily values');
  await scrollToEl(daily, 80, 1300);
  const dailyChart = page.locator('.recharts-surface').first();
  await sweep(dailyChart, 2600, 0.5, 0.05, 0.97);
  await sleep(600);
  await caption('<b>Stars</b>3,639 stars, reconstructed day by day from stargazers');
  const stars = page.getByText('Star accumulation', { exact: true }).first();
  await scrollToEl(stars, 80, 1100);
  await sweep(page.locator('.recharts-surface').nth(1), 2400, 0.5, 0.75, 0.985);
  await sleep(700);
  await scrollTo(0, 1200);
  await caption(null);

  // 3. Tabs
  await caption('<b>Acquisition</b>Where repo views come from, by channel');
  await click(tab('Acquisition'));
  await sleep(1100);
  const rows = page.locator('tr, [role=row]').filter({ hasText: /Google|YouTube|LinkedIn|egm\.dev/ });
  const rc = await rows.count();
  for (let i = 0; i < Math.min(rc, 4); i++) { await moveTo(rows.nth(i), 380, 0.25); await sleep(250); }
  await sleep(700);

  await caption('<b>Adoption</b>Clones and unique cloners, day by day');
  await click(tab('Adoption'));
  await sleep(1000);
  await scrollTo(220, 900);
  await sweep(page.locator('.recharts-surface').first(), 2200, 0.5, 0.5, 0.98);
  await sleep(500);

  await caption('<b>Development</b>Issues and pull requests moving through the queue');
  await scrollTo(0, 500);
  await click(tab('Development'));
  await sleep(1000);
  await sweep(page.locator('.recharts-surface').first(), 2000, 0.6, 0.05, 0.95);
  await sleep(500);

  await caption('<b>Research</b>How EGM compares with peer repos');
  await click(tab('Research'));
  await sleep(900);
  await scrollTo(450, 1600);
  await sleep(900);

  await caption('<b>Mentions</b>Videos and posts talking about EGM');
  await scrollTo(0, 500);
  await click(tab('Mentions'));
  await sleep(900);
  await scrollTo(380, 1400);
  await moveTo(page.locator('img').nth(0), 700);
  await sleep(500);
  await moveTo(page.locator('img').nth(1), 600);
  await sleep(500);
  await moveTo(page.locator('img').nth(2), 600);
  await sleep(700);
  await scrollTo(0, 900);

  // 4. Ask
  await click(tab('Overview'));
  await sleep(700);
  await caption('<b>Ask</b>Ask questions about the dashboard, with starter prompts');
  await click(page.locator('button[aria-label="Ask Gemini"]').first());
  await sleep(900);
  const starters = page.getByText(/Find growth opportunities|Improve first use|Explore distribution|What changed in the last 7 days/);
  for (let i = 0; i < Math.min(await starters.count(), 4); i++) { await moveTo(starters.nth(i), 380, 0.3); await sleep(300); }
  const input = page.locator('input[placeholder*="Ask"], textarea[placeholder*="Ask"]').first();
  await click(input, 500);
  await page.keyboard.type('What is behind the recent jump in views?', { delay: 45 });
  await sleep(1300);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await sleep(500);

  // 5. Themes
  await caption('<b>Themes</b>Restyle the whole dashboard in one click');
  const openThemes = async () => {
    await click(page.locator('button.dashboard-header-overflow-button').first(), 600);
    await sleep(450);
    await click(page.getByRole('menuitem', { name: /Switch theme/ }), 500);
    await sleep(700);
  };
  for (const name of ['Sticker pop', 'Dark pixel', 'Scientific blue', 'Original theme']) {
    await openThemes();
    await click(page.locator('button').filter({ hasText: name }).first(), 550);
    await sleep(name === 'Original theme' ? 600 : 1500);
  }
  await openThemes();
  await caption('<b>Dark mode</b>Light, dark or follow the system');
  const appearance = page.locator('button.theme-appearance-trigger:visible, .theme-appearance-trigger:visible').first();
  const tag = await appearance.evaluate(el => el.tagName);
  console.log('appearance control', tag);
  if (tag === 'SELECT') {
    await moveTo(appearance, 500); await appearance.selectOption('dark');
  } else {
    await click(appearance, 500);
    await sleep(500);
    await click(page.locator('[role=menuitemradio]').filter({ hasText: 'Dark' }).first(), 500);
  }
  await sleep(1200);
  await click(page.locator('button.theme-drawer-close').first(), 600);
  await sleep(500);
  await move(700, 500, 600);
  await scrollTo(1050, 1600);
  await sleep(600);
  await scrollTo(0, 1300);
  await caption(null);
  await move(1000, 450, 900);
  await sleep(1500);

  const end = (await cdp.send('Runtime.evaluate', { expression: 'Date.now()/1000', returnByValue: true })).result.value;
  await cdp.send('Page.stopScreencast');
  await sleep(300);
  fs.writeFileSync(path.join(WORK, 'frames.json'), JSON.stringify({ frames, end }));
  console.log('frames', frames.length, 'duration', (end - frames[0].t).toFixed(1) + 's');
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
