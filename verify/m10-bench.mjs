// Milestone 10 bench: does enlarging a small picture before reading
// actually help this engine, and by how much? Runs the shipping
// pipeline (the vendored Tesseract.js on /ocr-pdf/, same assets the
// photo page loads) over the known-text fixtures: the big fixture read
// as picked, the small and mid fixtures read as picked and enlarged
// 2x / 3x / 4x through a smoothed canvas, exactly the transform the
// photo page applies. Accuracy is character accuracy against the
// known strings (verify/m10-texts.mjs). Run after `npm run build`:
// node verify/m10-bench.mjs  (writes verify/m10-bench-results.json)
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
await new Promise((r) => server.listen(8978, r));
const BASE = 'http://127.0.0.1:8978';

const b64 = (f) => fs.readFileSync(path.join(FIX, f)).toString('base64');
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
  const run = (file, factor) => page.evaluate(async (b64s, f) => {
    if (!window.__m10worker) {
      window.__m10worker = await window.Tesseract.createWorker('eng', window.Tesseract.OEM && window.Tesseract.OEM.LSTM_ONLY, {
        workerPath: '/tesseract/worker.min.js', corePath: '/tesseract/core', langPath: '/tesseract/lang',
        gzip: false, cacheMethod: 'none',
      });
    }
    const bin = atob(b64s);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    const blob = new Blob([arr], { type: 'image/png' });
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
  }, b64(file), factor);

  for (const [label, file, factors] of [
    ['big', 'fixture-big.png', [1]],
    ['mid', 'fixture-mid.png', [1, 2]],
    ['small', 'fixture-small.png', [1, 2, 3, 4]],
  ]) {
    out[label] = {};
    for (const f of factors) {
      const r = await run(file, f);
      const acc = charAccuracy(r.text, BIG_TEXT);
      out[label]['x' + f] = { accuracy: Number(acc.toFixed(4)), secs: Number(r.secs.toFixed(1)), chars: r.text.trim().length };
      console.log('BENCH', label, 'factor', f, '-> accuracy', acc.toFixed(4), '| secs', r.secs.toFixed(1));
    }
  }
  await page.close();
} finally {
  await browser.close();
  server.close();
}
fs.writeFileSync(path.join(HERE, 'm10-bench-results.json'), JSON.stringify(out, null, 2));
console.log('M10 BENCH DONE');
