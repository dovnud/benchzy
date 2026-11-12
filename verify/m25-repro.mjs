// Milestone 25 reproduction: /crop-image/ loses a typed position
// when the position is entered BEFORE the size. Drives the built
// page exactly as the m24 gate does (same fixture, same field
// helper), only in the failing order: X and Y first, then W and H.
// Prints the field values after each step, the receipt line, and
// the output pixels. Run: node verify/m25-repro.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from '../../file-toolkit/bench/webtest/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
import sharp from 'sharp';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(HERE, '..', 'dist');
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

const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'], protocolTimeout: 300000 });
try {
  const page = await browser.newPage();
  // The sandbox cannot reach Google; answer the counter/ad hosts
  // with empties so page load is not held up (same reason as the
  // main harness).
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const u = req.url();
    if (u.includes('google-analytics.com') || u.includes('googletagmanager.com') || u.includes('googlesyndication.com')) req.respond({ status: 200, contentType: 'text/javascript', body: '' });
    else req.continue();
  });
  await page.goto('http://127.0.0.1:8979/crop-image/', { waitUntil: 'domcontentloaded' });
  const input = await page.$('#cr-file');
  await input.uploadFile(path.join(HERE, 'fixtures', 'm24', 'cropme.png')); // 400x300, left red, right blue
  await page.waitForFunction(() => !document.getElementById('cr-run').disabled, { timeout: 60000 });
  const setField = async (id, v) => page.$eval(id, (el, val) => { el.value = String(val); el.dispatchEvent(new Event('change')); }, v);
  const readFields = () => page.evaluate(() => ['cr-x', 'cr-y', 'cr-w', 'cr-h'].map((i) => document.getElementById(i).value).join(','));
  console.log('after load (x,y,w,h):', await readFields());
  await setField('#cr-x', 100);
  console.log('after X=100          :', await readFields());
  await setField('#cr-y', 50);
  console.log('after Y=50           :', await readFields());
  await setField('#cr-w', 200);
  console.log('after W=200          :', await readFields());
  await setField('#cr-h', 150);
  console.log('after H=150          :', await readFields());
  await page.click('#cr-run');
  await page.waitForFunction(() => !document.getElementById('cr-result').classList.contains('hidden'), { timeout: 120000 });
  const note = await page.$eval('#cr-achieved', (el) => el.textContent);
  console.log('receipt:', note);
  const href = await page.$eval('#cr-download', (el) => el.href);
  const b64 = await page.evaluate(async (h) => { const b = await (await fetch(h)).blob(); const buf = await b.arrayBuffer(); let s = ''; const bytes = new Uint8Array(buf); for (let i = 0; i < bytes.length; i += 32768) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 32768)); return btoa(s); }, href);
  const outPath = path.join(HERE, 'm25-repro-crop.png');
  fs.writeFileSync(outPath, Buffer.from(b64, 'base64'));
  const meta = await sharp(outPath).metadata();
  const { data, info } = await sharp(outPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const pxAt = (x, y) => { const i = (y * info.width + x) * 4; return [data[i], data[i + 1], data[i + 2]]; };
  console.log('output:', meta.width + 'x' + meta.height, '| px(10,10)', pxAt(10, 10).join(','), '| px(190,140)', pxAt(190, 140).join(','));
  const fields = await readFields();
  const bug = !fields.startsWith('100,50') || !note.includes('starting at 100, 50');
  console.log(bug ? 'DEFECT REPRODUCED: typed position did not survive / was not used' : 'NO DEFECT: position survived and was used');
} finally {
  await browser.close();
  server.close();
}
