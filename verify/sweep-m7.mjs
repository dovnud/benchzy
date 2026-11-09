// M7 final-dist sweep: console errors on every route, homepage ledger-row
// background probe, and empty .file-loaded banner visibility check.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from '../../file-toolkit/bench/webtest/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(HERE, '..', 'dist');
const EXE = '/home/hatch/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const fp = path.join(DIST, p);
  if (!fp.startsWith(DIST) || !fs.existsSync(fp)) { res.writeHead(404); res.end('nf'); return; }
  res.writeHead(200, { 'content-type': MIME[path.extname(fp)] || 'application/octet-stream' });
  fs.createReadStream(fp).pipe(res);
});
await new Promise((r) => server.listen(8979, r));
const BASE = 'http://127.0.0.1:8979';

const routes = [];
(function walk(d, rel) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.isDirectory()) walk(path.join(d, e.name), rel + e.name + '/');
    else if (e.name === 'index.html') routes.push('/' + rel);
  }
})(DIST, '');
routes.sort();
console.log('routes:', routes.length);

const browser = await puppeteer.launch({ executablePath: EXE, args: ['--no-sandbox'] });
let bad = 0;
for (const route of routes) {
  const page = await browser.newPage();
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  page.on('requestfailed', (r) => errs.push('reqfail: ' + r.url()));
  await page.goto(BASE + route, { waitUntil: 'networkidle0', timeout: 30000 }).catch((e) => errs.push('goto: ' + e.message));
  if (errs.length) { bad++; console.log('ERR', route, JSON.stringify(errs.slice(0, 3))); }
  await page.close();
}
console.log('routes with errors:', bad);

// Homepage probes
const page = await browser.newPage();
await page.goto(BASE + '/', { waitUntil: 'networkidle0' });
const probe = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('.job-row')].slice(0, 8).map((el) => getComputedStyle(el).backgroundColor);
  const banner = document.querySelector('.file-loaded');
  return { rows, bannerDisplay: banner ? getComputedStyle(banner).display : 'none-found', bannerVisible: banner ? banner.offsetParent !== null || banner.getClientRects().length > 0 : null };
});
console.log('job-row backgrounds:', JSON.stringify(probe.rows));
console.log('empty banner display:', probe.bannerDisplay, '| has layout box:', probe.bannerVisible);
await browser.close();
server.close();
console.log('SWEEP DONE');
