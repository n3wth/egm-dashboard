// Renders the intro and outro title cards as 1440x900 PNGs into DEMO_DIR.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '../..');
const work = process.env.DEMO_DIR || path.join(__dirname, '.out');
const icon = fs.readFileSync(path.join(root, 'assets/branding/icon-dark.svg'), 'utf8');
const font = 'file://' + path.join(root, 'egm-performance/public/fonts/');
const css = `@font-face{font-family:S;src:url(${font}SuisseIntl-Book.woff2)}@font-face{font-family:S;font-weight:600;src:url(${font}SuisseIntl-Semibold.woff2)}
body{margin:0;width:1440px;height:900px;display:flex;flex-direction:column;align-items:center;justify-content:center;background:radial-gradient(1200px 700px at 50% 40%,#1c2433,#0b0d12);color:#fff;font-family:S,system-ui;letter-spacing:-.02em}
.i{width:120px;height:120px;margin-bottom:36px}.i svg{width:100%;height:100%}
h1{font-weight:600;font-size:72px;margin:0}p{font-size:28px;color:#a9b4c6;margin:20px 0 0}
.u{margin-top:44px;font-size:22px;color:#93c5fd;border:1px solid #2b3a55;padding:10px 22px;border-radius:999px}`;
const cards = {
  intro: `<div class=i>${icon}</div><h1>EGM Growth Dashboard</h1><p>How the Elephant-Goldfish Model is growing, in one place</p>`,
  outro: `<div class=i>${icon}</div><h1>EGM Growth Dashboard</h1><p>Reach · Acquisition · Adoption · Development · Mentions</p><div class=u>egm.n3wth.com</div>`,
};
(async () => {
  fs.mkdirSync(work, { recursive: true });
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  for (const [k, h] of Object.entries(cards)) {
    await p.setContent(`<style>${css}</style>${h}`);
    await p.waitForTimeout(300);
    await p.screenshot({ path: path.join(work, k + '.png') });
  }
  await b.close();
})();
