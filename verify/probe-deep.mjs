// Probe D: deep-ladder outputs on island page vs core batch page.
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
await new Promise((r) => server.listen(8984, r));
const BASE = 'http://127.0.0.1:8984';
const PHOTO_PDF = '/home/hatch/workspace/file-toolkit/bench/pdfnums/out/photo-1page.pdf';
const browser = await puppeteer.launch({ executablePath: '/home/hatch/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome', headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'], protocolTimeout: 900000 });

async function grab(page, sel, outName) {
  const b64 = await page.evaluate(async (s) => {
    const buf = await (await fetch(document.querySelector(s).href)).arrayBuffer();
    const bytes = new Uint8Array(buf);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }, sel);
  const p = path.join(HERE, outName);
  fs.writeFileSync(p, Buffer.from(b64, 'base64'));
  return fs.statSync(p).size;
}

// island, custom target 20 KB
{
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('island pageerror:', e.message));
  await page.goto(BASE + '/compress-pdf/', { waitUntil: 'networkidle0', timeout: 60000 });
  await (await page.$('#cp-file')).uploadFile(PHOTO_PDF);
  await page.waitForFunction(() => !document.getElementById('cp-run').disabled, { timeout: 30000 });
  await page.$eval('#cp-custom', (el) => { el.value = '20'; el.dispatchEvent(new Event('change')); });
  await page.click('#cp-run');
  await page.waitForFunction(() => !document.getElementById('cp-result').classList.contains('hidden'), { timeout: 600000 });
  console.log('island note:', await page.$eval('#cp-achieved', (el) => el.textContent));
  console.log('island bytes:', await grab(page, '#cp-download', 'probe-island-deep.pdf'));
  await page.close();
}
// core batch page, custom target 20 KB
{
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('batch pageerror:', e.message));
  await page.goto(BASE + '/batch-compress-pdf/', { waitUntil: 'networkidle0', timeout: 60000 });
  await (await page.$('#bp-file')).uploadFile(PHOTO_PDF);
  await page.waitForFunction(() => !document.getElementById('bp-run').disabled, { timeout: 30000 });
  await page.$eval('#bp-custom', (el) => { el.value = '20'; el.dispatchEvent(new Event('change')); });
  await page.click('#bp-run');
  await page.waitForFunction(() => !document.getElementById('bp-result').classList.contains('hidden'), { timeout: 600000 });
  const rows = await page.$$eval('#bp-rows > div', (ds) => ds.map((d) => d.textContent.replace(/\s+/g, ' ').trim()));
  console.log('batch rows:', JSON.stringify(rows));
  console.log('batch zip bytes:', await grab(page, '#bp-zip', 'probe-batch-deep.zip'));
  await page.close();
}
await browser.close();
server.close();
console.log('PROBE D DONE');
