// Milestone 10 fixtures: pictures of known text, rendered by the bench
// Chrome (same pattern as tools/make-og-image.mjs). The big fixture is
// a letter page at 300 DPI (2550 px wide, text at 46 px, about 11 pt at
// that depth). The small fixture is the same text at 800 px wide and
// 15 px type: the downscaled-photo case the pre-run tip exists for.
// ES/PT fixtures are mid-size renders for the language gates.
// Run: node verify/m10-make-fixtures.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from '../../file-toolkit/bench/webtest/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
import { BIG_TEXT, ES_TEXT, PT_TEXT } from './m10-texts.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'fixtures', 'm10');
fs.mkdirSync(OUT, { recursive: true });
const EXE = '/home/hatch/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome';

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
function htmlFor(text, { width, fontPx, padX, padY }) {
  const lines = text.split('\n').map((l) => (l === '' ? '<div class="blank">&nbsp;</div>' : `<div>${esc(l)}</div>`)).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { width: ${width}px; background: #ffffff; color: #000000;
           font-family: "DejaVu Sans", sans-serif; font-size: ${fontPx}px; line-height: 1.55;
           padding: ${padY}px ${padX}px; }
    .blank { height: 0.6em; }
  </style></head><body>${lines}</body></html>`;
}

const browser = await puppeteer.launch({
  executablePath: EXE, headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
try {
  const jobs = [
    ['fixture-big.png', BIG_TEXT, { width: 2550, fontPx: 46, padX: 300, padY: 280 }],
    ['fixture-small.png', BIG_TEXT, { width: 800, fontPx: 15, padX: 48, padY: 40 }],
    ['fixture-mid.png', BIG_TEXT, { width: 1400, fontPx: 26, padX: 90, padY: 80 }],
    ['fixture-es.png', ES_TEXT, { width: 1700, fontPx: 36, padX: 120, padY: 110 }],
    ['fixture-pt.png', PT_TEXT, { width: 1700, fontPx: 36, padX: 120, padY: 110 }],
  ];
  for (const [name, text, spec] of jobs) {
    const page = await browser.newPage();
    await page.setViewport({ width: spec.width, height: 1200, deviceScaleFactor: 1 });
    await page.setContent(htmlFor(text, spec), { waitUntil: 'networkidle0' });
    const out = path.join(OUT, name);
    await page.screenshot({ path: out, type: 'png', fullPage: true });
    console.log('wrote', out, fs.statSync(out).size, 'bytes');
    await page.close();
  }
} finally {
  await browser.close();
}
