// Surgical probes: interleave + flatten.
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
await new Promise((r) => server.listen(8982, r));
const BASE = 'http://127.0.0.1:8982';
const CORPUS = '/home/hatch/workspace/file-toolkit/corpus';
const FORM_FIXTURE = path.join(HERE, 'fixtures', 'form-fixture.pdf');

const browser = await puppeteer.launch({ executablePath: '/home/hatch/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome', headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'], protocolTimeout: 900000 });

// interleave
{
  const page = await browser.newPage();
  page.on('console', (m) => { if (m.type() === 'error') console.log('IL console:', m.text().slice(0, 300)); });
  page.on('pageerror', (e) => console.log('IL pageerror:', (e.stack || e.message).slice(0, 700)));
  await page.goto(BASE + '/interleave-pdf/', { waitUntil: 'networkidle0', timeout: 60000 });
  console.log('IL initial status:', JSON.stringify(await page.$eval('#il-status', (el) => el.textContent)));
  await (await page.$('#il-file-a')).uploadFile(path.join(CORPUS, 'test-10page.pdf'));
  await new Promise((r) => setTimeout(r, 1500));
  console.log('IL after A:', JSON.stringify(await page.$eval('#il-status', (el) => el.textContent)), '| spec:', JSON.stringify(await page.$eval('#il-spec', (el) => el.textContent)));
  await (await page.$('#il-file-b')).uploadFile(path.join(CORPUS, 'test-3page-second.pdf'));
  await new Promise((r) => setTimeout(r, 1500));
  console.log('IL after B:', JSON.stringify(await page.$eval('#il-status', (el) => el.textContent)), '| run disabled:', await page.$eval('#il-run', (el) => el.disabled));
  await page.click('#il-run');
  await new Promise((r) => setTimeout(r, 4000));
  console.log('IL after run:', JSON.stringify(await page.$eval('#il-status', (el) => el.textContent)), '| result hidden:', await page.$eval('#il-result', (el) => el.classList.contains('hidden')));
  await page.close();
}

// flatten
{
  const page = await browser.newPage();
  page.on('console', (m) => { if (m.type() === 'error') console.log('FL console:', m.text().slice(0, 300)); });
  page.on('pageerror', (e) => console.log('FL pageerror:', (e.stack || e.message).slice(0, 700)));
  await page.goto(BASE + '/flatten-pdf/', { waitUntil: 'networkidle0', timeout: 60000 });
  await (await page.$('#fl-file')).uploadFile(FORM_FIXTURE);
  await new Promise((r) => setTimeout(r, 2500));
  console.log('FL spec:', JSON.stringify(await page.$eval('#fl-spec', (el) => el.textContent)));
  console.log('FL status:', JSON.stringify(await page.$eval('#fl-status', (el) => el.textContent)));
  await page.click('#fl-run');
  await new Promise((r) => setTimeout(r, 4000));
  console.log('FL after run:', JSON.stringify(await page.$eval('#fl-status', (el) => el.textContent)), '| achieved:', JSON.stringify(await page.$eval('#fl-achieved', (el) => el.textContent).catch(() => '(none)')));
  await page.close();
}

await browser.close();
server.close();
console.log('ILFL PROBE DONE');
