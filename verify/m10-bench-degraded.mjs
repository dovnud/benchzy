// Milestone 10 bench, second half: the REALISTIC small picture. A
// clean render reads perfectly at any size, so this bench degrades
// the big fixture the way phones and portals actually degrade a
// picture: drawn down to 800 px wide through a smoothing canvas
// (the downscale blur) and re-encoded as JPEG at quality 0.55 (the
// compression mush), then read as picked and enlarged 2x / 3x / 4x
// through the same transform the photo page applies. Same server,
// browser and worker pattern as verify/m10-bench.mjs.
// Run: node verify/m10-bench-degraded.mjs
// (writes verify/m10-bench-degraded-results.json and the degraded
// fixture itself, verify/fixtures/m10/fixture-degraded.jpg)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from '../../file-toolkit/bench/webtest/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
import { BIG_TEXT, charAccuracy } from './m10-texts.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(HERE, '..', 'dist');
const FIX = path.join(HERE, 'fixtures', 'm10');
const EXE = '/home/hatch/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.traineddata': 'application/octet-stream' };
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

const browser = await puppeteer.launch({
  executablePath: EXE, headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
  protocolTimeout: 900000,
});
const out = {};
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('pageerror:', e.message));
  await page.goto(BASE + '/ocr-pdf/', { waitUntil: 'networkidle0', timeout: 60000 });
  await page.waitForFunction(() => !!window.Tesseract, { timeout: 30000 });
  const bigB64 = fs.readFileSync(path.join(FIX, 'fixture-big.png')).toString('base64');
  // Build the degraded fixture in the page and bring its bytes back,
  // so the fixture on disk is exactly what was benched.
  const degradedB64 = await page.evaluate(async (b64s) => {
    const bin = atob(b64s);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    const bmp = await createImageBitmap(new Blob([arr], { type: 'image/png' }));
    const canvas = document.createElement('canvas');
    canvas.width = 800;
    canvas.height = Math.round(bmp.height * (800 / bmp.width));
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.55));
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = '';
    for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    return btoa(s);
  }, bigB64);
  fs.writeFileSync(path.join(FIX, 'fixture-degraded.jpg'), Buffer.from(degradedB64, 'base64'));
  console.log('degraded fixture written:', fs.statSync(path.join(FIX, 'fixture-degraded.jpg')).size, 'bytes');

  const run = (factor) => page.evaluate(async (b64s, f) => {
    if (!window.__m10worker) {
      window.__m10worker = await window.Tesseract.createWorker('eng', window.Tesseract.OEM && window.Tesseract.OEM.LSTM_ONLY, {
        workerPath: '/tesseract/worker.min.js', corePath: '/tesseract/core', langPath: '/tesseract/lang',
        gzip: false, cacheMethod: 'none',
      });
    }
    const bin = atob(b64s);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    const blob = new Blob([arr], { type: 'image/jpeg' });
    let input = blob;
    if (f !== 1) {
      const bmp = await createImageBitmap(blob);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(bmp.width * f);
      canvas.height = Math.round(bmp.height * f);
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
      input = await new Promise((r) => canvas.toBlob(r, 'image/png'));
    }
    const t0 = performance.now();
    const { data } = await window.__m10worker.recognize(input);
    return { text: data.text || '', secs: (performance.now() - t0) / 1000 };
  }, degradedB64, factor);

  for (const f of [1, 2, 3, 4]) {
    const r = await run(f);
    const acc = charAccuracy(r.text, BIG_TEXT);
    out['x' + f] = { accuracy: Number(acc.toFixed(4)), secs: Number(r.secs.toFixed(1)), chars: r.text.trim().length };
    console.log('BENCH degraded factor', f, '-> accuracy', acc.toFixed(4), '| secs', r.secs.toFixed(1));
  }
  await page.close();
} finally {
  await browser.close();
  server.close();
}
fs.writeFileSync(path.join(HERE, 'm10-bench-degraded-results.json'), JSON.stringify(out, null, 2));
console.log('M10 DEGRADED BENCH DONE');
