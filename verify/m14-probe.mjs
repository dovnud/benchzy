// Milestone 14 probe: the m14 gates on their own (same code that
// lands in verify.mjs), against dist/ served locally, so the new
// tools can be iterated without the full suite. Not a substitute:
// the milestone closes on the full verify.mjs run.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from '../../file-toolkit/bench/webtest/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
import JSZip from 'jszip';
import { PDFDocument } from '@cantoo/pdf-lib';
import { extractPdfImages } from '../src/scripts/lib/pdf-images-core.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(HERE, '..', 'dist');
const SHOTS = path.join(HERE, 'screenshots');
const EXE = '/home/hatch/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome';
const PHOTO_PDF = '/home/hatch/workspace/file-toolkit/bench/pdfnums/out/photo-1page.pdf';
const M14 = path.join(HERE, 'fixtures', 'm14');
const sharp = (await import('sharp')).default;

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

const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'], protocolTimeout: 900000 });
async function openPage(url) {
  const page = await browser.newPage();
  const errors = [], failed = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('requestfailed', (r) => failed.push(r.url() + ' :: ' + (r.failure() || {}).errorText));
  page.on('response', (r) => { if (r.status() >= 400) failed.push(r.url() + ' :: HTTP ' + r.status()); });
  await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });
  return { page, errors, failed };
}
async function saveBlob(page, selector, outName) {
  const b64 = await page.evaluate(async (sel) => {
    const href = document.querySelector(sel).href;
    const buf = await (await fetch(href)).arrayBuffer();
    const bytes = new Uint8Array(buf);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }, selector);
  const outPath = path.join(HERE, outName);
  fs.writeFileSync(outPath, Buffer.from(b64, 'base64'));
  return outPath;
}
async function shown(page, id, timeout = 600000) {
  await page.waitForFunction((i) => !document.getElementById(i).classList.contains('hidden'), { timeout }, id);
}
async function zipEntries(file) {
  const zip = await JSZip.loadAsync(fs.readFileSync(file));
  const out = [];
  for (const [name, f] of Object.entries(zip.files)) {
    if (!f.dir) out.push({ name, size: (await f.async('uint8array')).length });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
async function encodePng({ data, width, height }) {
  return sharp(Buffer.from(data.buffer, data.byteOffset, data.byteLength), { raw: { width, height, channels: 4 } }).png().toBuffer();
}
async function centerPixel(buf) {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const i = (Math.floor(info.height / 2) * info.width + Math.floor(info.width / 2)) * 4;
  return [data[i], data[i + 1], data[i + 2]];
}
const near = (px, want, tol) => px.every((v, i) => Math.abs(v - want[i]) <= tol);

try {
  // ---- (a) jpg-to-pdf ------------------------------------------------
  {
    const { page, errors, failed } = await openPage(BASE + '/jpg-to-pdf/');
    const input = await page.$('#jp-file');
    await input.uploadFile(path.join(M14, 'img-red.jpg'), path.join(M14, 'img-green.png'), path.join(M14, 'img-blue.webp'));
    await page.waitForFunction(() => document.querySelectorAll('#jp-list > li').length === 3 && !document.getElementById('jp-run').disabled, { timeout: 60000 });
    const before = await page.$$eval('#jp-list > li > span:first-child', (els) => els.map((e) => e.textContent));
    // Move the third picture (blue) to the front: Up twice.
    await page.click('#jp-list button[data-act="up"][data-pos="2"]');
    await page.click('#jp-list button[data-act="up"][data-pos="1"]');
    const after = await page.$$eval('#jp-list > li > span:first-child', (els) => els.map((e) => e.textContent));
    console.log('list before:', JSON.stringify(before), '| after:', JSON.stringify(after));
    await page.click('#jp-run');
    await shown(page, 'jp-result', 120000);
    const note = await page.$eval('#jp-achieved', (el) => el.textContent);
    const outPath = await saveBlob(page, '#jp-download', 'm14-jpg-to-pdf.pdf');
    const doc = await PDFDocument.load(fs.readFileSync(outPath));
    const sizes = doc.getPages().map((p) => { const s = p.getSize(); return [Math.round(s.width), Math.round(s.height)]; });
    const res = await extractPdfImages(doc, { encodePng });
    const byPage = new Map(res.files.map((f) => [f.page, f]));
    const dims = [1, 2, 3].map((n) => { const f = byPage.get(n); return f ? [f.width, f.height] : null; });
    const px = {};
    for (const n of [1, 2, 3]) { const f = byPage.get(n); if (f) px[n] = await centerPixel(Buffer.from(f.data)); }
    const redBytesOk = byPage.get(2) && Buffer.from(byPage.get(2).data).equals(fs.readFileSync(path.join(M14, 'img-red.jpg')));
    const orderOk = JSON.stringify(after.map((s) => s.replace(/^\d+\. /, ''))) === JSON.stringify(['img-blue.webp', 'img-red.jpg', 'img-green.png']);
    const sizesOk = JSON.stringify(sizes) === JSON.stringify([[400, 400], [300, 200], [200, 300]]);
    const dimsOk = JSON.stringify(dims) === JSON.stringify([[400, 400], [300, 200], [200, 300]]);
    const colorsOk = near(px[1] || [], [40, 80, 200], 10) && near(px[2] || [], [200, 40, 30], 12) && near(px[3] || [], [30, 160, 60], 10);
    console.log('TOOL m14 jpg-to-pdf:', note);
    console.log('  sizes', JSON.stringify(sizes), '| image dims', JSON.stringify(dims), '| centers', JSON.stringify(px), '| red JPEG byte-identical:', redBytesOk, '| errors', errors.length, failed.length);
    if (!orderOk || !sizesOk || !dimsOk || !colorsOk || !redBytesOk || errors.length) throw new Error('m14 jpg-to-pdf gate failed');
    await page.setViewport({ width: 1280, height: 900 });
    await page.screenshot({ path: path.join(SHOTS, 'm14-jpg-to-pdf-desktop.png'), fullPage: true });
    await page.setViewport({ width: 390, height: 844 });
    await new Promise((r) => setTimeout(r, 300));
    await page.screenshot({ path: path.join(SHOTS, 'm14-jpg-to-pdf-mobile.png'), fullPage: true });
    await page.close();

    // A4 fit: one picture, page is A4, picture placed untouched.
    const a4 = await openPage(BASE + '/jpg-to-pdf/');
    const input2 = await a4.page.$('#jp-file');
    await input2.uploadFile(path.join(M14, 'img-red.jpg'));
    await a4.page.waitForFunction(() => !document.getElementById('jp-run').disabled, { timeout: 60000 });
    await a4.page.$eval('input[name="jp-fit"][value="a4"]', (el) => { el.checked = true; el.dispatchEvent(new Event('change')); });
    await a4.page.click('#jp-run');
    await shown(a4.page, 'jp-result', 120000);
    const a4Path = await saveBlob(a4.page, '#jp-download', 'm14-jpg-to-pdf-a4.pdf');
    const a4Doc = await PDFDocument.load(fs.readFileSync(a4Path));
    const a4Size = a4Doc.getPage(0).getSize();
    const a4Ok = a4Doc.getPageCount() === 1 && Math.abs(a4Size.width - 595.28) < 0.5 && Math.abs(a4Size.height - 841.89) < 0.5;
    console.log('TOOL m14 jpg-to-pdf A4: page', a4Size.width, 'x', a4Size.height, '| ok:', a4Ok, '| errors', a4.errors.length);
    if (!a4Ok || a4.errors.length) throw new Error('m14 jpg-to-pdf A4 gate failed');
    await a4.page.close();
  }

  // ---- (b) pdf-to-jpg -------------------------------------------------
  const BANDS = [[200, 40, 30], [30, 160, 60], [40, 80, 200], [230, 140, 20], [130, 60, 180]];
  async function bandCheck(zipPath, scale, tol) {
    const zip = await JSZip.loadAsync(fs.readFileSync(zipPath));
    const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir).sort();
    const checks = [];
    for (let i = 0; i < names.length; i++) {
      const buf = Buffer.from(await zip.file(names[i]).async('uint8array'));
      const meta = await sharp(buf).metadata();
      const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      // Fixture geometry, in points: the colour band spans x 72..540,
      // y-from-bottom 600..680, so its centre is (306, 152 from top).
      const bi = (Math.round(152 * scale) * info.width + Math.round(306 * scale)) * 4;
      const band = [data[bi], data[bi + 1], data[bi + 2]];
      // The marker text sits at y-from-bottom 500..536, x 72..300:
      // from top that is y 256..292. Count its dark pixels.
      let dark = 0;
      const y0 = Math.round(256 * scale), y1 = Math.round(292 * scale);
      const x0 = Math.round(72 * scale), x1 = Math.round(300 * scale);
      for (let y = y0; y < y1; y += 3) for (let x = x0; x < x1; x += 3) {
        const j = (y * info.width + x) * 4;
        if (data[j] < 100 && data[j + 1] < 100 && data[j + 2] < 100) dark++;
      }
      checks.push({ name: names[i], format: meta.format, w: info.width, h: info.height, band, bandOk: near(band, BANDS[i], tol), dark });
    }
    return checks;
  }
  {
    // Print size, JPG.
    const { page, errors, failed } = await openPage(BASE + '/pdf-to-jpg/');
    const input = await page.$('#pj-file');
    await input.uploadFile(path.join(M14, 'pages5.pdf'));
    await page.waitForFunction(() => !document.getElementById('pj-run').disabled, { timeout: 30000 });
    await page.$eval('input[name="pj-dpi"][value="200"]', (el) => { el.checked = true; el.dispatchEvent(new Event('change')); });
    await page.click('#pj-run');
    await shown(page, 'pj-result', 300000);
    const note = await page.$eval('#pj-achieved', (el) => el.textContent);
    const zipPath = await saveBlob(page, '#pj-download', 'm14-pages5-print.zip');
    const entries = await zipEntries(zipPath);
    const checks = await bandCheck(zipPath, 200 / 72, 16);
    const dimsOk = checks.every((c) => c.format === 'jpeg' && c.w === 1700 && c.h === 2200);
    const contentOk = checks.every((c) => c.bandOk && c.dark > 100);
    console.log('TOOL m14 pdf-to-jpg print:', note);
    console.log('  entries', entries.length, '| checks', JSON.stringify(checks.map((c) => [c.format, c.w, c.h, c.bandOk, c.dark])), '| errors', errors.length, failed.length);
    if (entries.length !== 5 || !dimsOk || !contentOk || errors.length) throw new Error('m14 pdf-to-jpg print gate failed');
    await page.setViewport({ width: 1280, height: 900 });
    await page.screenshot({ path: path.join(SHOTS, 'm14-pdf-to-jpg-desktop.png'), fullPage: true });
    await page.setViewport({ width: 390, height: 844 });
    await new Promise((r) => setTimeout(r, 300));
    await page.screenshot({ path: path.join(SHOTS, 'm14-pdf-to-jpg-mobile.png'), fullPage: true });
    await page.close();

    // Screen size, PNG.
    const s2 = await openPage(BASE + '/pdf-to-jpg/');
    const input2 = await s2.page.$('#pj-file');
    await input2.uploadFile(path.join(M14, 'pages5.pdf'));
    await s2.page.waitForFunction(() => !document.getElementById('pj-run').disabled, { timeout: 30000 });
    await s2.page.$eval('input[name="pj-format"][value="png"]', (el) => { el.checked = true; el.dispatchEvent(new Event('change')); });
    await s2.page.$eval('input[name="pj-dpi"][value="96"]', (el) => { el.checked = true; el.dispatchEvent(new Event('change')); });
    await s2.page.click('#pj-run');
    await shown(s2.page, 'pj-result', 300000);
    const zipPath2 = await saveBlob(s2.page, '#pj-download', 'm14-pages5-screen.zip');
    const entries2 = await zipEntries(zipPath2);
    const checks2 = await bandCheck(zipPath2, 96 / 72, 6);
    const dimsOk2 = checks2.every((c) => c.format === 'png' && c.w === 816 && c.h === 1056);
    const contentOk2 = checks2.every((c) => c.bandOk && c.dark > 50);
    console.log('TOOL m14 pdf-to-jpg screen PNG: entries', entries2.length, '| checks', JSON.stringify(checks2.map((c) => [c.format, c.w, c.h, c.bandOk, c.dark])), '| errors', s2.errors.length);
    if (entries2.length !== 5 || !dimsOk2 || !contentOk2 || s2.errors.length) throw new Error('m14 pdf-to-jpg screen gate failed');
    await s2.page.close();

    // Single page: the picture itself, not a ZIP.
    const s3 = await openPage(BASE + '/pdf-to-jpg/');
    const input3 = await s3.page.$('#pj-file');
    await input3.uploadFile(path.join(M14, 'pages1.pdf'));
    await s3.page.waitForFunction(() => !document.getElementById('pj-run').disabled, { timeout: 30000 });
    await s3.page.$eval('input[name="pj-format"][value="png"]', (el) => { el.checked = true; el.dispatchEvent(new Event('change')); });
    await s3.page.$eval('input[name="pj-dpi"][value="96"]', (el) => { el.checked = true; el.dispatchEvent(new Event('change')); });
    await s3.page.click('#pj-run');
    await shown(s3.page, 'pj-result', 120000);
    const dlName = await s3.page.$eval('#pj-download', (el) => el.download);
    const imgPath = await saveBlob(s3.page, '#pj-download', 'm14-pages1.png');
    const meta3 = await sharp(fs.readFileSync(imgPath)).metadata();
    const singleOk = dlName.endsWith('.png') && meta3.format === 'png' && meta3.width === 816 && meta3.height === 1056;
    console.log('TOOL m14 pdf-to-jpg single: download name', dlName, '| meta', meta3.format, meta3.width, 'x', meta3.height, '| ok:', singleOk, '| errors', s3.errors.length);
    if (!singleOk || s3.errors.length) throw new Error('m14 pdf-to-jpg single gate failed');
    await s3.page.close();

    // Stress: 50 pages at screen size, JPG.
    const s4 = await openPage(BASE + '/pdf-to-jpg/');
    const input4 = await s4.page.$('#pj-file');
    await input4.uploadFile(path.join(M14, 'pages50.pdf'));
    await s4.page.waitForFunction(() => !document.getElementById('pj-run').disabled, { timeout: 30000 });
    await s4.page.$eval('input[name="pj-format"][value="jpg"]', (el) => { el.checked = true; el.dispatchEvent(new Event('change')); });
    await s4.page.$eval('input[name="pj-dpi"][value="96"]', (el) => { el.checked = true; el.dispatchEvent(new Event('change')); });
    const t0 = Date.now();
    await s4.page.click('#pj-run');
    await shown(s4.page, 'pj-result', 600000);
    const stressMs = Date.now() - t0;
    const zipPath4 = await saveBlob(s4.page, '#pj-download', 'm14-pages50.zip');
    const entries4 = await zipEntries(zipPath4);
    console.log('TOOL m14 pdf-to-jpg stress: 50-page document rendered in', stressMs, 'ms | zip entries', entries4.length, '| errors', s4.errors.length);
    if (entries4.length !== 50 || s4.errors.length) throw new Error('m14 pdf-to-jpg stress gate failed');
    await s4.page.close();
  }

  // ---- (c) the 50 KB door ----------------------------------------------
  {
    const { page, errors, failed } = await openPage(BASE + '/compress-pdf-to-50kb/');
    const specText = await page.$eval('#cp-tool', (el) => el.dataset.presetKb + '/' + el.dataset.lockTarget);
    const input = await page.$('#cp-file');
    await input.uploadFile(PHOTO_PDF);
    await page.waitForFunction(() => !document.getElementById('cp-run').disabled, { timeout: 30000 });
    await page.click('#cp-run');
    await page.waitForFunction(() => !document.getElementById('cp-result').classList.contains('hidden'), { timeout: 420000 });
    const note = await page.$eval('#cp-achieved', (el) => el.textContent);
    const outPath = await saveBlob(page, '#cp-download', 'm14-preset-50k.pdf');
    const size = fs.statSync(outPath).size;
    const landed = size <= 50 * 1024 && note.includes('under your 50 KB target');
    const honest = note.includes('Smallest we could reach') && note.includes('50 KB');
    console.log('TOOL m14 preset-50k: dataset', specText, '|', note, '| bytes', size, '| landed:', landed, '| honest fallback:', honest, '| errors', errors.length);
    if (!(landed || honest) || errors.length) throw new Error('m14 preset 50k gate failed');
    await page.close();
  }
  console.log('M14 PROBE DONE');
} finally {
  await browser.close();
  server.close();
}
