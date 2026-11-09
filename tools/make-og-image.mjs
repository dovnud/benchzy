// Generates public/og.png (1200x630), the one shared social card, by
// screenshotting an HTML card drawn in the site's ledger language
// (milestone 7): warm paper with grain, one hard ink frame, the
// bench-block mark, the wordmark in Fraunces, mono fact lines, and
// one handwritten orange note. The site's own self-hosted fonts are
// loaded from public/fonts so the card is set in the real type.
// No gradients, no glow, no stock art, no stamp (stamps are for
// result receipts only).
// Run: node tools/make-og-image.mjs   (uses the bench Chrome, like verify/)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import puppeteer from '../../file-toolkit/bench/webtest/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const OUT = path.join(ROOT, 'public', 'og.png');
const TMP = path.join(HERE, '.og-card.html');
const EXE = '/home/hatch/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome';
const font = (name) => pathToFileURL(path.join(ROOT, 'public', 'fonts', name)).href;

// The bench-block glyph path, same data as src/components/LogoMark.astro
// and public/favicon.svg (extracted by tools/make-logo.mjs).
const B_PATH = 'M9.57 25.39L9.57 6.2L13.41 6.2L13.41 14.06L13.54 14.06Q13.82 12.92 14.85 12.19Q15.87 11.46 17.19 11.46Q18.93 11.46 20.08 12.28Q21.24 13.1 21.83 14.68Q22.43 16.26 22.43 18.57Q22.43 20.88 21.83 22.47Q21.24 24.07 20.08 24.88Q18.93 25.7 17.19 25.7Q15.87 25.7 14.85 24.96Q13.82 24.22 13.54 23.11L13.41 23.11L13.41 25.39ZM15.92 22.59Q17.01 22.59 17.72 21.81Q18.44 21.03 18.44 19.76L18.44 17.4Q18.44 16.11 17.72 15.34Q17.01 14.58 15.92 14.58Q15.2 14.58 14.63 14.81Q14.06 15.04 13.73 15.5Q13.41 15.95 13.41 16.57L13.41 20.59Q13.41 21.21 13.73 21.67Q14.06 22.12 14.63 22.35Q15.2 22.59 15.92 22.59Z';

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  @font-face { font-family: "Fraunces"; src: url("${font('Fraunces-VAR.woff2')}") format("woff2"); font-weight: 600 900; }
  @font-face { font-family: "IBM Plex Sans"; src: url("${font('IBMPlexSans-VAR.woff2')}") format("woff2"); font-weight: 400 700; }
  @font-face { font-family: "IBM Plex Mono"; src: url("${font('IBMPlexMono-500.woff2')}") format("woff2"); font-weight: 500; }
  @font-face { font-family: "Mansalva"; src: url("${font('Mansalva-latin.woff2')}") format("woff2"); font-weight: 400; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { width: 1200px; height: 630px; background: #faf6ee; font-family: "IBM Plex Sans", sans-serif; color: #1b2634;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='140' height='140' filter='url(%23n)' opacity='0.05'/%3E%3C/svg%3E"); }
  .frame { position: absolute; inset: 28px; border: 3px solid #1b2634; }
  .card { position: absolute; inset: 28px; padding: 64px 76px; display: flex; flex-direction: column; }
  .top { display: flex; align-items: center; gap: 22px; }
  .kicker { font-family: "IBM Plex Mono", monospace; font-size: 21px; letter-spacing: 0.3em;
            text-transform: uppercase; color: #46536a; }
  .kicker b { color: #d9551e; font-weight: 600; }
  .wordmark { font-family: "Fraunces", serif; font-size: 150px; font-weight: 600; letter-spacing: -0.015em;
              line-height: 1.02; color: #1b2634; margin-top: 40px; }
  .line { font-family: "IBM Plex Mono", monospace; font-size: 27px; line-height: 1.6; color: #46536a; margin-top: 26px; }
  .hand { font-family: "Mansalva", cursive; font-size: 46px; line-height: 1.15; color: #b03e0f; transform: rotate(-2deg);
          position: absolute; right: 84px; top: 205px; width: 400px; }
  .rule { border-top: 2px solid #1b2634; margin-top: auto; padding-top: 22px;
          font-family: "IBM Plex Mono", monospace; font-size: 22px; letter-spacing: 0.16em;
          text-transform: uppercase; color: #1b2634; display: flex; justify-content: space-between; }
</style></head>
<body>
  <div class="frame"></div>
  <div class="card">
    <div class="top">
      <svg width="72" height="72" viewBox="0 0 32 32" aria-hidden="true"><rect x="1.75" y="1.75" width="28.5" height="28.5" fill="none" stroke="#1b2634" stroke-width="3.5"/><path d="${B_PATH}" fill="#1b2634"/></svg>
      <div class="kicker">The file workshop · <b>Nothing is uploaded</b></div>
    </div>
    <div class="wordmark">benchzy</div>
    <p class="line">Free file tools that run inside your browser.<br/>No uploads. No accounts. No counters.</p>
    <div class="hand">no tricks at the download button, ever</div>
    <div class="rule"><span>benchzy.com</span><span>files sent to a server: 0</span></div>
  </div>
</body></html>`;

fs.writeFileSync(TMP, html);
const browser = await puppeteer.launch({
  executablePath: EXE,
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 630, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(TMP).href, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: OUT, type: 'png' });
  console.log('wrote', OUT);
} finally {
  await browser.close();
  fs.rmSync(TMP, { force: true });
}
