// Focused milestone-6 debugging, suite order in ONE browser:
// batch-bg (rows + zip), then workflows with live state sampling.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from '../../file-toolkit/bench/webtest/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
import JSZip from 'jszip';

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
await new Promise((r) => server.listen(8978, r));
const BASE = 'http://127.0.0.1:8978';
const CORPUS = '/home/hatch/workspace/file-toolkit/corpus';
const PHOTO_PDF = '/home/hatch/workspace/file-toolkit/bench/pdfnums/out/photo-1page.pdf';

const browser = await puppeteer.launch({ executablePath: '/home/hatch/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome', headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'], protocolTimeout: 900000 });

// --- batch bg (suite order: first)
{
  const page = await browser.newPage();
  page.on('console', (m) => { if (m.type() === 'error') console.log('BG console error:', m.text()); });
  page.on('pageerror', (e) => console.log('BG pageerror:', e.message));
  await page.goto(BASE + '/batch-remove-background/', { waitUntil: 'networkidle0', timeout: 60000 });
  const input = await page.$('#bb-file');
  await input.uploadFile(path.join(CORPUS, 'test-bg-hard.png'), path.join(CORPUS, 'test-photo-realistic-large.jpg'));
  await page.waitForFunction(() => !document.getElementById('bb-run').disabled, { timeout: 30000 });
  await page.click('#bb-run');
  await page.waitForFunction(() => !document.getElementById('bb-result').classList.contains('hidden'), { timeout: 900000 });
  const rows = await page.$$eval('#bb-rows > div', (ds) => ds.map((d) => d.textContent.replace(/\s+/g, ' ').trim()));
  console.log('BG rows:', JSON.stringify(rows));
  const zipB64 = await page.evaluate(async () => {
    const a = document.getElementById('bb-zip');
    const buf = await (await fetch(a.href)).arrayBuffer();
    const bytes = new Uint8Array(buf);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  });
  const zip = await JSZip.loadAsync(Buffer.from(zipB64, 'base64'));
  console.log('BG zip entries:', Object.keys(zip.files));
  await page.close();
}

// --- workflows with live sampling
{
  const page = await browser.newPage();
  page.on('console', (m) => { if (m.type() === 'error') console.log('WF console error:', m.text()); });
  page.on('pageerror', (e) => console.log('WF pageerror:', e.message));
  await page.goto(BASE + '/workflows/', { waitUntil: 'networkidle0', timeout: 60000 });
  await page.click('[data-starter="starter-invoice-pack"]');
  await page.waitForFunction(() => document.querySelectorAll('#wf-steps > div').length === 2, { timeout: 15000 });
  const input = await page.$('#wf-file');
  const three = ['batch-01.pdf', 'batch-02.pdf', 'batch-03.pdf'].map((f) => path.join(CORPUS, 'batch25', f));
  await input.uploadFile(...three, PHOTO_PDF);
  await page.waitForFunction(() => !document.getElementById('wf-run').disabled, { timeout: 30000 });
  await page.click('#wf-run');
  const t0 = Date.now();
  let done = false;
  while (Date.now() - t0 < 600000) {
    await new Promise((r) => setTimeout(r, 20000));
    const state = await page.evaluate(() => ({
      status: (document.getElementById('wf-status') || {}).textContent || '',
      log: ((document.getElementById('wf-log') || {}).textContent || '').replace(/\s+/g, ' ').slice(0, 300),
      outputs: document.querySelectorAll('#wf-outputs a').length,
      resultShown: !document.getElementById('wf-result').classList.contains('hidden'),
    })).catch((e) => ({ error: e.message }));
    console.log('WF t+' + Math.round((Date.now() - t0) / 1000) + 's:', JSON.stringify(state));
    if (state.outputs >= 1 || state.resultShown) { done = true; break; }
  }
  console.log('WF done:', done);
  await page.close();
}

await browser.close();
server.close();
console.log('DEBUG DONE');
