// Probe C: strong alone in a fresh browser; dump the output image size.
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
await new Promise((r) => server.listen(8983, r));
const BASE = 'http://127.0.0.1:8983';
const PHOTO_PDF = '/home/hatch/workspace/file-toolkit/bench/pdfnums/out/photo-1page.pdf';
const browser = await puppeteer.launch({ executablePath: '/home/hatch/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome', headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'], protocolTimeout: 900000 });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('pageerror:', e.message));
await page.goto(BASE + '/compress-pdf-strong/', { waitUntil: 'networkidle0', timeout: 60000 });
await (await page.$('#cp-file')).uploadFile(PHOTO_PDF);
await page.waitForFunction(() => !document.getElementById('cp-run').disabled, { timeout: 30000 });
await page.click('#cp-run');
await page.waitForFunction(() => !document.getElementById('cp-result').classList.contains('hidden'), { timeout: 600000 });
const note = await page.$eval('#cp-achieved', (el) => el.textContent);
const b64 = await page.evaluate(async () => {
  const buf = await (await fetch(document.getElementById('cp-download').href)).arrayBuffer();
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
});
fs.writeFileSync(path.join(HERE, 'probe-strong-out.pdf'), Buffer.from(b64, 'base64'));
console.log('STRONG NOTE:', note);
console.log('bytes:', fs.statSync(path.join(HERE, 'probe-strong-out.pdf')).size);
await browser.close();
server.close();
console.log('PROBE C DONE');
