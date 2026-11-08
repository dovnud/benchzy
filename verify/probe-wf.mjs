// Probe: which file mix breaks the workflow chain?
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
await new Promise((r) => server.listen(8979, r));
const BASE = 'http://127.0.0.1:8979';
const CORPUS = '/home/hatch/workspace/file-toolkit/corpus';
const PHOTO_PDF = '/home/hatch/workspace/file-toolkit/bench/pdfnums/out/photo-1page.pdf';
const three = ['batch-01.pdf', 'batch-02.pdf', 'batch-03.pdf'].map((f) => path.join(CORPUS, 'batch25', f));

const browser = await puppeteer.launch({ executablePath: '/home/hatch/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome', headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'], protocolTimeout: 900000 });

async function trial(label, files) {
  const page = await browser.newPage();
  page.on('console', (m) => { if (m.type() === 'error') console.log(label, 'console:', m.text().slice(0, 900)); });
  page.on('pageerror', (e) => console.log(label, 'pageerror:', e.message));
  await page.goto(BASE + '/workflows/', { waitUntil: 'networkidle0', timeout: 60000 });
  await page.click('[data-starter="starter-invoice-pack"]');
  await page.waitForFunction(() => document.querySelectorAll('#wf-steps > div').length === 2, { timeout: 15000 });
  const input = await page.$('#wf-file');
  await input.uploadFile(...files);
  await page.waitForFunction(() => !document.getElementById('wf-run').disabled, { timeout: 30000 });
  await page.click('#wf-run');
  try {
    await page.waitForFunction(() => !document.getElementById('wf-result').classList.contains('hidden'), { timeout: 300000 });
    const out = await page.evaluate(async () => {
      const a = document.querySelector('#wf-outputs a');
      const b = await (await fetch(a.href)).blob();
      return { name: a.download, size: b.size };
    });
    console.log(label, 'OK:', JSON.stringify(out));
  } catch (e) {
    const st = await page.$eval('#wf-status', (el) => el.textContent).catch(() => '?');
    console.log(label, 'FAILED, status:', st);
  }
  await page.close();
}

await trial('small-only', three);
await trial('photo-only', [PHOTO_PDF]);
await browser.close();
server.close();
console.log('PROBE DONE');
