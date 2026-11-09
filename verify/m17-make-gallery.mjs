// Milestone 17: produce the quality-page gallery by running the
// SHIPPED tool itself. This driver serves dist/ locally, opens the
// real /remove-background/ page in headless Chrome, and for each
// gallery source picks the file and presses the page's own Run
// button, exactly as a visitor would. Nothing here reimplements the
// engine: the cutouts saved to verify/m17-out/ are the page's own
// download blobs, and the times are the page's own printed times
// line ("Program start: X s. Cutout: Y s. Full size result: ...").
//
// Each input runs twice in the same page session: the first run
// warms the session (the bench's known first-inference cost), the
// second is the recorded warm run. The busy photo also runs at two
// extra sizes (resized copies, see m17-sources/PROVENANCE.md) for
// the speed-by-size table. Outputs: verify/m17-out/<case>.png (the
// recorded run's blob) and verify/m17-runs.json (every run's times).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from '../../file-toolkit/bench/webtest/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(HERE, '..', 'dist');
const SRC = path.join(HERE, 'm17-sources');
const OUT = path.join(HERE, 'm17-out');
fs.mkdirSync(OUT, { recursive: true });
const EXE = '/home/hatch/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome';

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.wasm': 'application/wasm', '.onnx': 'application/octet-stream',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.traineddata': 'application/octet-stream',
};
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const fp = path.join(DIST, p);
  if (!fp.startsWith(DIST) || !fs.existsSync(fp)) { res.writeHead(404); res.end('nf'); return; }
  res.writeHead(200, { 'content-type': MIME[path.extname(fp)] || 'application/octet-stream' });
  fs.createReadStream(fp).pipe(res);
});
await new Promise((r) => server.listen(8978, r));
const BASE = 'http://127.0.0.1:8978';

const CASES = [
  { key: 'white', file: 'white.jpg' },
  { key: 'chrome', file: 'chrome.webp' },
  { key: 'glass', file: 'glass.jpg' },
  { key: 'hair', file: 'hair.jpg' },
  { key: 'busy', file: 'busy.jpg' },
  { key: 'strands', file: 'strands.png' },
  { key: 'busy-1024', file: 'busy-1024.jpg', ladderOnly: true },
  { key: 'busy-2880', file: 'busy-2880.jpg', ladderOnly: true },
];

const runs = {};
let browser;
try {
  browser = await puppeteer.launch({
    executablePath: EXE,
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
    protocolTimeout: 900000,
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.goto(BASE + '/remove-background/', { waitUntil: 'networkidle0', timeout: 60000 });

  let lastHref = '';
  async function runOnce(caseKey, filePath) {
    const input = await page.$('#bg-file');
    await input.uploadFile(filePath);
    await page.waitForFunction(() => !document.getElementById('bg-run').disabled, { timeout: 30000 });
    await page.click('#bg-run');
    // A finished run swaps in a fresh blob URL and fills the times line;
    // a no-subject file shows its own panel instead.
    const outcome = await page.waitForFunction((prev) => {
      const dl = document.getElementById('bg-download');
      const times = document.getElementById('bg-times');
      if (dl && dl.href && dl.href.startsWith('blob:') && dl.href !== prev && times && times.textContent.includes('Cutout:')) return 'done';
      const ns = document.getElementById('bg-nosubject');
      if (ns && !ns.classList.contains('hidden')) return 'nosubject';
      return false;
    }, { timeout: 900000, polling: 500 }, lastHref).then((h) => h.jsonValue());
    if (outcome === 'nosubject') return { noSubject: true };
    const times = await page.$eval('#bg-times', (el) => el.textContent);
    const m = /Program start: ([\d.]+) s\. Cutout: ([\d.]+) s\. Full size result: (\d+) x (\d+),/.exec(times);
    if (!m) throw new Error('unparsable times line: ' + times);
    const b64 = await page.evaluate(async () => {
      const href = document.getElementById('bg-download').href;
      const buf = await (await fetch(href)).arrayBuffer();
      const bytes = new Uint8Array(buf);
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      return btoa(bin);
    });
    lastHref = await page.$eval('#bg-download', (el) => el.href);
    const buf = Buffer.from(b64, 'base64');
    return {
      loadSecs: Number(m[1]), cutSecs: Number(m[2]),
      width: Number(m[3]), height: Number(m[4]), bytes: buf.length, buf,
    };
  }

  for (const c of CASES) {
    const fp = path.join(SRC, c.file);
    runs[c.key] = { file: c.file, attempts: [] };
    for (let i = 0; i < 2; i++) {
      const t0 = Date.now();
      const r = await runOnce(c.key, fp);
      const wallSecs = (Date.now() - t0) / 1000;
      if (r.noSubject) {
        runs[c.key].attempts.push({ noSubject: true, wallSecs });
        console.log('M17', c.key, 'run', i + 1, ': NO SUBJECT');
        continue;
      }
      runs[c.key].attempts.push({ loadSecs: r.loadSecs, cutSecs: r.cutSecs, width: r.width, height: r.height, bytes: r.bytes, wallSecs: +wallSecs.toFixed(1) });
      console.log('M17', c.key, 'run', i + 1, ': cut', r.cutSecs, 's,', r.width + 'x' + r.height, r.bytes, 'B');
      if (i === 1 && !c.ladderOnly) fs.writeFileSync(path.join(OUT, c.key + '.png'), r.buf);
      if (i === 1 && c.key === 'busy') fs.writeFileSync(path.join(OUT, 'busy.png'), r.buf);
    }
  }
  runs.consoleErrors = errors;
  console.log('M17 console errors:', JSON.stringify(errors));
} finally {
  if (browser) await browser.close();
  server.close();
}
fs.writeFileSync(path.join(HERE, 'm17-runs.json'), JSON.stringify(runs, null, 2));
console.log('M17 GALLERY RUNS DONE');
