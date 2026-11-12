// Milestone 24 probe: measure the two numbers the new copy
// states, on the shipped pages, before the copy is finalised.
// - pages5.pdf through /pdf-to-jpg/ as JPG and as PNG at 96 DPI:
//   the PNG set's total weight against the JPG set's.
// - photo.heic through /heic-to-png/: the PNG's byte size.
// Prints JSON; not a gate.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from '../../file-toolkit/bench/webtest/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(HERE, '..', 'dist');
const EXE = '/home/hatch/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
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
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'], protocolTimeout: 900000 });

async function blobInfo(page, sel) {
  return page.$eval(sel, async (a) => {
    const res = await fetch(a.href);
    const blob = await res.blob();
    return { type: blob.type, size: blob.size, name: a.download };
  });
}
async function shown(page, id, timeout = 180000) {
  await page.waitForFunction((i) => { const el = document.getElementById(i); return el && !el.classList.contains('hidden'); }, { timeout }, id);
}

const out = {};
{ // pages5 as JPG, then as PNG, via the shipped pdf-to-jpg page
  const page = await browser.newPage();
  await page.goto(BASE + '/pdf-to-jpg/', { waitUntil: 'networkidle0' });
  const input = await page.$('#pj-file');
  await input.uploadFile(path.join(HERE, 'fixtures', 'm14', 'pages5.pdf'));
  await page.waitForFunction(() => !document.getElementById('pj-run').disabled);
  await page.click('#pj-run');
  await shown(page, 'pj-result');
  out.jpgSet = await blobInfo(page, '#pj-download');
  out.jpgNote = await page.$eval('#pj-achieved', (el) => el.textContent);
  await page.close();
}
{
  const page = await browser.newPage();
  await page.goto(BASE + '/pdf-to-png/', { waitUntil: 'networkidle0' });
  const input = await page.$('#pj-file');
  await input.uploadFile(path.join(HERE, 'fixtures', 'm14', 'pages5.pdf'));
  await page.waitForFunction(() => !document.getElementById('pj-run').disabled);
  await page.click('#pj-run');
  await shown(page, 'pj-result');
  out.pngSet = await blobInfo(page, '#pj-download');
  out.pngNote = await page.$eval('#pj-achieved', (el) => el.textContent);
  await page.close();
}
{ // photo.heic via the new heic-to-png door
  const page = await browser.newPage();
  await page.goto(BASE + '/heic-to-png/', { waitUntil: 'networkidle0' });
  const input = await page.$('#hc-file');
  await input.uploadFile(path.join(HERE, 'fixtures', 'm15', 'photo.heic'));
  await page.waitForFunction(() => !document.getElementById('hc-run').disabled);
  const runLabel = await page.$eval('#hc-run', (el) => el.textContent);
  await page.click('#hc-run');
  await shown(page, 'hc-result');
  out.heicPng = await blobInfo(page, '#hc-download');
  out.heicNote = await page.$eval('#hc-achieved', (el) => el.textContent);
  out.heicRunLabel = runLabel;
  await page.close();
}
await browser.close();
server.close();
console.log(JSON.stringify(out, null, 2));
