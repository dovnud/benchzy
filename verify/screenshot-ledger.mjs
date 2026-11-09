// Ledger-reskin screenshots (milestone 7): serves dist/ like verify.mjs
// and captures the pages the owner reviews before deploy — home
// (desktop + mobile), one batch page, the background tool, a hub —
// plus a loaded-file state so the shouting file-loaded banner is
// visible in the set. Filenames all carry "ledger".
// Run: node verify/screenshot-ledger.mjs
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from '../../file-toolkit/bench/webtest/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(HERE, '..', 'dist');
const SHOTS = path.join(HERE, 'screenshots');
const EXE = '/home/hatch/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome';
const PHOTO_PDF = '/home/hatch/workspace/file-toolkit/bench/pdfnums/out/photo-1page.pdf';

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.txt': 'text/plain', '.xml': 'application/xml', '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(DIST, p);
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); res.end('nf'); return; }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  });
});
await new Promise((r) => server.listen(0, r));
const BASE = 'http://127.0.0.1:' + server.address().port;
fs.mkdirSync(SHOTS, { recursive: true });

const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
  const page = await browser.newPage();
  const shots = [
    ['home-desktop-ledger.png', '/', { width: 1440, height: 900 }],
    ['home-mobile-ledger.png', '/', { width: 390, height: 844 }],
    ['batch-compress-pdf-ledger.png', '/batch-compress-pdf/', { width: 1440, height: 900 }],
    ['remove-background-ledger.png', '/remove-background/', { width: 1440, height: 900 }],
    ['tools-hub-ledger.png', '/tools/', { width: 1440, height: 900 }],
  ];
  for (const [name, route, vp] of shots) {
    await page.setViewport(vp);
    await page.goto(BASE + route, { waitUntil: 'networkidle0', timeout: 60000 });
    await new Promise((r) => setTimeout(r, 400));
    await page.screenshot({ path: path.join(SHOTS, name), fullPage: true });
    console.log('shot', name);
  }
  // Loaded state: drop the bench photo PDF on Compress PDF so the
  // file-loaded banner is in the set.
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(BASE + '/compress-pdf/', { waitUntil: 'networkidle0', timeout: 60000 });
  const input = await page.$('#cp-file');
  await input.uploadFile(PHOTO_PDF);
  await new Promise((r) => setTimeout(r, 900));
  await page.screenshot({ path: path.join(SHOTS, 'compress-pdf-loaded-ledger.png'), fullPage: false });
  console.log('shot compress-pdf-loaded-ledger.png');
} finally {
  await browser.close();
  server.close();
}
