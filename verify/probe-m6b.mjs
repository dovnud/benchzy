// Probe: sign, strong, interleave, split-by-size, flatten with status capture.
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
await new Promise((r) => server.listen(8980, r));
const BASE = 'http://127.0.0.1:8980';
const CORPUS = '/home/hatch/workspace/file-toolkit/corpus';
const PHOTO_PDF = '/home/hatch/workspace/file-toolkit/bench/pdfnums/out/photo-1page.pdf';
const PHOTO3_PDF = '/home/hatch/workspace/file-toolkit/bench/pdfnums/out/photo-3page.pdf';
const FORM_FIXTURE = path.join(HERE, 'fixtures', 'form-fixture.pdf');

const browser = await puppeteer.launch({ executablePath: '/home/hatch/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome', headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'], protocolTimeout: 900000 });

async function open(route) {
  const page = await browser.newPage();
  page.on('console', (m) => { if (m.type() === 'error') console.log(route, 'console:', m.text().slice(0, 300)); });
  page.on('pageerror', (e) => console.log(route, 'pageerror:', e.message.slice(0, 300)));
  await page.goto(BASE + route, { waitUntil: 'networkidle0', timeout: 60000 });
  return page;
}
async function waitResult(page, prefix, timeout = 180000) {
  try {
    await page.waitForFunction((i) => !document.getElementById(i).classList.contains('hidden'), { timeout }, prefix + '-result');
    const note = await page.$eval('#' + prefix + '-achieved', (el) => el.textContent).catch(() => '(no achieved el)');
    console.log(prefix, 'RESULT:', note.replace(/\s+/g, ' ').slice(0, 220));
    return true;
  } catch (e) {
    const st = await page.$eval('#' + prefix + '-status', (el) => el.textContent).catch(() => '?');
    console.log(prefix, 'NO RESULT. status:', st);
    return false;
  }
}

// sign
{
  const page = await open('/sign-pdf/');
  await (await page.$('#sg-file')).uploadFile(path.join(CORPUS, 'test-10page.pdf'));
  await page.waitForFunction(() => !document.getElementById('sg-run').disabled, { timeout: 30000 });
  await page.type('#sg-typed', 'Ada Lovelace');
  await page.click('#sg-run');
  await waitResult(page, 'sg');
  await page.close();
}
// strong (photo)
{
  const page = await open('/compress-pdf-strong/');
  await (await page.$('#cp-file')).uploadFile(PHOTO_PDF);
  await page.waitForFunction(() => !document.getElementById('cp-run').disabled, { timeout: 30000 });
  await page.click('#cp-run');
  await waitResult(page, 'cp', 600000);
  await page.close();
}
// interleave
{
  const page = await open('/interleave-pdf/');
  await (await page.$('#il-file-a')).uploadFile(path.join(CORPUS, 'test-10page.pdf'));
  await (await page.$('#il-file-b')).uploadFile(path.join(CORPUS, 'test-3page-second.pdf'));
  await page.waitForFunction(() => !document.getElementById('il-run').disabled, { timeout: 30000 });
  await page.click('#il-run');
  await waitResult(page, 'il');
  await page.close();
}
// split by size
{
  const page = await open('/split-pdf/');
  await (await page.$('#sp-file')).uploadFile(PHOTO3_PDF);
  await page.waitForFunction(() => !document.getElementById('sp-run').disabled, { timeout: 30000 });
  await page.$eval('input[name="sp-mode"][value="size"]', (el) => el.click());
  await page.$eval('#sp-size-kb', (el) => { el.value = '5000'; el.dispatchEvent(new Event('change')); });
  await page.click('#sp-run');
  const ok = await waitResult(page, 'sp', 600000);
  if (ok) {
    const links = await page.$$eval('#sp-links a', (as) => as.map((a) => a.download));
    console.log('sp links:', JSON.stringify(links));
  }
  await page.close();
}
// flatten
{
  const page = await open('/flatten-pdf/');
  await (await page.$('#fl-file')).uploadFile(FORM_FIXTURE);
  await page.waitForFunction(() => (document.getElementById('fl-spec') || {}).textContent.includes('3 form fields'), { timeout: 30000 });
  await page.click('#fl-run');
  await waitResult(page, 'fl');
  await page.close();
}

await browser.close();
server.close();
console.log('PROBE B DONE');
