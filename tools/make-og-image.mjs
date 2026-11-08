// Generates public/og.png (1200x630), the one shared social card, by
// screenshotting an HTML card drawn in the site's own ticket language
// (milestone 5): warm paper, ink frame, serif wordmark, mono spec
// lines, the rubber stamp. No gradients, no glow, no stock art.
// Run: node tools/make-og-image.mjs   (uses the bench Chrome, like verify/)
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from '../../file-toolkit/bench/webtest/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, '..', 'public', 'og.png');
const EXE = '/home/hatch/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome';

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { width: 1200px; height: 630px; background: #faf5ea; font-family: Georgia, 'Times New Roman', serif; }
  .frame { position: absolute; inset: 28px; border: 3px solid #1b2634; }
  .frame::after { content: ''; position: absolute; inset: 8px; border: 1px solid #1b2634; }
  .card { position: absolute; inset: 28px; padding: 72px 84px; display: flex; flex-direction: column; }
  .kicker { font-family: 'Courier New', monospace; font-size: 21px; letter-spacing: 0.32em;
            text-transform: uppercase; color: #b54313; }
  .wordmark { font-size: 148px; font-weight: 900; letter-spacing: -0.02em; color: #1b2634; margin-top: 26px; }
  .wordmark .dot { color: #d9551e; }
  .line { font-family: 'Courier New', monospace; font-size: 27px; line-height: 1.55; color: #51606f; margin-top: 30px; }
  .stamp { position: absolute; right: 70px; bottom: 292px; font-family: 'Courier New', monospace;
           font-size: 25px; letter-spacing: 0.14em; text-transform: uppercase; color: #b54313;
           border: 3px solid #b54313; border-radius: 6px; padding: 12px 20px; transform: rotate(-4deg); }
  .rule { border-top: 2px solid #1b2634; margin-top: auto; padding-top: 22px;
          font-family: 'Courier New', monospace; font-size: 22px; letter-spacing: 0.18em;
          text-transform: uppercase; color: #1b2634; display: flex; justify-content: space-between; }
</style></head>
<body>
  <div class="frame"></div>
  <div class="card">
    <div class="kicker">Job ticket · the file workshop</div>
    <div class="wordmark">Benchzy<span class="dot">.</span></div>
    <p class="line">Free file tools that run inside your browser.<br/>No uploads. No accounts. No counters.</p>
    <div class="rule"><span>benchzy.com</span><span>files stay on your device</span></div>
    <div class="stamp">Done on your device</div>
  </div>
</body></html>`;

const browser = await puppeteer.launch({
  executablePath: EXE,
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 630, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: 'load' });
  await page.screenshot({ path: OUT, type: 'png' });
  console.log('wrote', OUT);
} finally {
  await browser.close();
}
