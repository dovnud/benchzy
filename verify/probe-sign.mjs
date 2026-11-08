// Surgical sign-pdf probe.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from '../../file-toolkit/bench/webtest/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(HERE, '..', 'dist');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.onnx': 'application/octet-stream', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.traineddata': 'application/octet-stream' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const fp = path.join(DIST, p);
  if (!fp.startsWith(DIST) || !fs.existsSync(fp)) { res.writeHead(404); res.end('nf'); return; }
  res.writeHead(200, { 'content-type': MIME[path.extname(fp)] || 'application/octet-stream' });
  fs.createReadStream(fp).pipe(res);
});
await new Promise((r) => server.listen(8981, r));
const BASE = 'http://127.0.0.1:8981';
const CORPUS = '/home/hatch/workspace/file-toolkit/corpus';

const browser = await puppeteer.launch({ executablePath: '/home/hatch/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome', headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'], protocolTimeout: 900000 });
const page = await browser.newPage();
page.on('console', (m) => console.log('console[' + m.type() + ']:', m.text().slice(0, 400)));
page.on('pageerror', (e) => console.log('pageerror:', (e.stack || e.message).slice(0, 600)));
await page.goto(BASE + '/sign-pdf/', { waitUntil: 'networkidle0', timeout: 60000 });
const els = await page.evaluate(() => {
  const ids = ['sg-tray', 'sg-file', 'sg-spec', 'sg-run', 'sg-status', 'sg-result', 'sg-pad', 'sg-clear', 'sg-typed', 'sg-initials', 'sg-date', 'sg-size', 'sg-download', 'sg-achieved', 'sg-stamp'];
  return Object.fromEntries(ids.map((i) => [i, !!document.getElementById(i)]));
});
console.log('elements:', JSON.stringify(els));
const input = await page.$('#sg-file');
await input.uploadFile(path.join(CORPUS, 'test-10page.pdf'));
await new Promise((r) => setTimeout(r, 3000));
console.log('status after upload:', JSON.stringify(await page.$eval('#sg-status', (el) => el.textContent)));
console.log('spec after upload:', JSON.stringify(await page.$eval('#sg-spec', (el) => el.textContent)));
console.log('run disabled:', await page.$eval('#sg-run', (el) => el.disabled));
await page.type('#sg-typed', 'Ada Lovelace');
await page.click('#sg-run');
await new Promise((r) => setTimeout(r, 5000));
console.log('status after run:', JSON.stringify(await page.$eval('#sg-status', (el) => el.textContent)));
console.log('result hidden:', await page.$eval('#sg-result', (el) => el.classList.contains('hidden')));
await browser.close();
server.close();
console.log('SIGN PROBE DONE');
