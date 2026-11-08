// Benchzy milestone-1 verification.
// Serves dist/ locally, drives headless Chrome (puppeteer-core from the
// file-toolkit webtest bench, same Chrome as the earlier benches), checks
// every page for console errors and failed requests, then runs the image
// and PDF tools end to end on corpus files and the background tool on the
// bench target photo. Writes verify/results.json and screenshots.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from '../../file-toolkit/bench/webtest/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(HERE, '..', 'dist');
const SHOTS = path.join(HERE, 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const EXE = '/home/hatch/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome';
const CORPUS = '/home/hatch/workspace/file-toolkit/corpus';
const PHOTO_PDF = '/home/hatch/workspace/file-toolkit/bench/pdfnums/out/photo-1page.pdf';

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.wasm': 'application/wasm', '.onnx': 'application/octet-stream',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.traineddata': 'application/octet-stream',
};
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const fp = path.join(DIST, p);
  if (!fp.startsWith(DIST) || !fs.existsSync(fp)) { res.writeHead(404); res.end('nf'); return; }
  res.writeHead(200, { 'content-type': MIME[path.extname(fp)] || 'application/octet-stream' });
  fs.createReadStream(fp).pipe(res);
});
await new Promise((r) => server.listen(8977, r));
const BASE = 'http://127.0.0.1:8977';

const results = { pages: {}, tools: {} };
let browser;
try {
  browser = await puppeteer.launch({
    executablePath: EXE,
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });

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

  // 1. Every page loads clean.
  for (const route of ['/', '/remove-background/', '/compress-pdf/', '/compress-image/', '/credits/',
    '/ocr-pdf/', '/merge-pdf/', '/split-pdf/', '/compress-pdf-to-200kb/', '/compress-image-to-50kb/', '/size-checker/',
    '/remove-background-full-resolution/', '/background-removal/', '/vs-remove-bg/', '/remove-bg-alternatives/',
    '/remove-bg-december-1/', '/remove-bg-api/', '/check-it-yourself/', '/what-free-means/',
    '/tools/', '/pdf-tools/', '/image-tools/']) {
    const { page, errors, failed } = await openPage(BASE + route);
    results.pages[route] = { consoleErrors: errors, failedRequests: failed };
    console.log('PAGE', route, 'errors:', errors.length, 'failed:', failed.length, JSON.stringify([...errors, ...failed]).slice(0, 300));
    if (route === '/') {
      await page.setViewport({ width: 1280, height: 900 });
      await page.screenshot({ path: path.join(SHOTS, 'home-desktop.png'), fullPage: true });
      await page.setViewport({ width: 390, height: 844 });
      await page.screenshot({ path: path.join(SHOTS, 'home-mobile.png'), fullPage: true });
      await page.setViewport({ width: 1280, height: 900 });
    }
    if (route === '/compress-image/') {
      await page.screenshot({ path: path.join(SHOTS, 'compress-image-desktop.png'), fullPage: true });
      await page.setViewport({ width: 390, height: 844 });
      await page.screenshot({ path: path.join(SHOTS, 'compress-image-mobile.png'), fullPage: true });
    }
    if (route === '/ocr-pdf/') {
      await page.screenshot({ path: path.join(SHOTS, 'ocr-pdf-desktop.png'), fullPage: true });
      await page.setViewport({ width: 390, height: 844 });
      await page.screenshot({ path: path.join(SHOTS, 'ocr-pdf-mobile.png'), fullPage: true });
      await page.setViewport({ width: 1280, height: 900 });
    }
    if (route === '/merge-pdf/') {
      await page.screenshot({ path: path.join(SHOTS, 'merge-pdf-desktop.png'), fullPage: true });
    }
    if (route === '/vs-remove-bg/') {
      await page.screenshot({ path: path.join(SHOTS, 'vs-remove-bg-desktop.png'), fullPage: true });
    }
    if (route === '/check-it-yourself/') {
      await page.screenshot({ path: path.join(SHOTS, 'check-it-yourself-desktop.png'), fullPage: true });
      await page.setViewport({ width: 390, height: 844 });
      await page.screenshot({ path: path.join(SHOTS, 'check-it-yourself-mobile.png'), fullPage: true });
      await page.setViewport({ width: 1280, height: 900 });
    }
    await page.close();
  }

  // 1b. Check-it-yourself witness: run the witnessed job on a corpus PDF and
  // confirm the page reports zero network requests during the job.
  {
    const { page, errors, failed } = await openPage(BASE + '/check-it-yourself/');
    const input = await page.$('#w-file');
    await input.uploadFile(path.join(CORPUS, 'test-10page.pdf'));
    await page.waitForFunction(() => document.getElementById('w-job-status').textContent.includes('Job done'), { timeout: 60000 });
    const status = await page.$eval('#w-job-status', (el) => el.textContent);
    const verdict = await page.$eval('#w-verdict', (el) => el.textContent);
    const spec = await page.$eval('#w-spec', (el) => el.textContent.replace(/\s+/g, ' '));
    const liveRows = await page.$$eval('#w-live > li', (els) => els.length);
    results.tools.witness = { status, verdict, spec, liveRows, zeroDuringJob: status.includes('Network requests during the job: 0'), consoleErrors: errors, failedRequests: failed };
    console.log('TOOL witness:', status.slice(0, 160), '| live rows', liveRows);
    await page.close();
  }

  // 1c. Service worker: registers, caches loaded assets, and a page visited
  // before going offline still opens offline.
  {
    const { page, errors, failed } = await openPage(BASE + '/');
    await page.waitForFunction(async () => {
      if (!('serviceWorker' in navigator)) return false;
      const reg = await navigator.serviceWorker.getRegistration('/');
      return !!(reg && reg.active);
    }, { timeout: 30000 });
    await page.reload({ waitUntil: 'networkidle0' });
    const cacheInfo = await page.evaluate(async () => {
      const keys = await caches.keys();
      let entries = 0; const sample = [];
      for (const k of keys) { const c = await caches.open(k); const reqs = await c.keys(); entries += reqs.length; for (const r of reqs.slice(0, 6)) sample.push(new URL(r.url).pathname); }
      return { keys, entries, sample };
    });
    let offlineOk = false, offlineTitle = '';
    try {
      if (page.setOfflineMode) await page.setOfflineMode(true);
      else { const c = await page.createCDPSession(); await c.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 }); }
      await page.reload({ waitUntil: 'load', timeout: 30000 });
      offlineTitle = await page.title();
      offlineOk = offlineTitle.toLowerCase().includes('benchzy');
      if (page.setOfflineMode) await page.setOfflineMode(false);
      else { const c = await page.createCDPSession(); await c.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }); }
    } catch (e) {
      offlineOk = false; offlineTitle = 'offline reload threw: ' + e.message;
      try { if (page.setOfflineMode) await page.setOfflineMode(false); } catch { /* ignore */ }
    }
    results.tools.serviceWorker = { registered: true, cacheInfo, offlineOk, offlineTitle, consoleErrors: errors, failedRequests: failed };
    console.log('TOOL service-worker: caches', JSON.stringify(cacheInfo.keys), 'entries', cacheInfo.entries, '| offline reopen ok:', offlineOk);
    await page.close();
  }

  // 2. Image tool end to end: corpus photo to the 200 KB default target.
  {
    const { page, errors, failed } = await openPage(BASE + '/compress-image/');
    const input = await page.$('#ci-file');
    await input.uploadFile(path.join(CORPUS, 'test-large-photo.jpg'));
    await page.waitForFunction(() => !document.getElementById('ci-run').disabled, { timeout: 15000 });
    await page.click('#ci-run');
    await page.waitForFunction(() => !document.getElementById('ci-result').classList.contains('hidden'), { timeout: 300000 });
    const note = await page.$eval('#ci-achieved', (el) => el.textContent);
    const blobSize = await page.evaluate(async () => {
      const href = document.getElementById('ci-download').href;
      const b = await (await fetch(href)).blob();
      return b.size;
    });
    results.tools.compressImage = { note, blobSize, targetBytes: 200 * 1024, within5pct: Math.abs(blobSize - 200 * 1024) / (200 * 1024) <= 0.05, consoleErrors: errors, failedRequests: failed };
    console.log('TOOL compress-image:', note, '| blob', blobSize);
    await page.close();
  }

  // 3a. PDF tool: corpus text PDF (already under target path).
  {
    const { page, errors } = await openPage(BASE + '/compress-pdf/');
    const input = await page.$('#cp-file');
    await input.uploadFile(path.join(CORPUS, 'test-10page.pdf'));
    await page.waitForFunction(() => !document.getElementById('cp-run').disabled, { timeout: 15000 });
    await page.click('#cp-run');
    await page.waitForFunction(() => !document.getElementById('cp-result').classList.contains('hidden'), { timeout: 60000 });
    const note = await page.$eval('#cp-achieved', (el) => el.textContent);
    results.tools.compressPdfText = { note, consoleErrors: errors };
    console.log('TOOL compress-pdf (text):', note);
    await page.close();
  }

  // 3b. PDF tool: bench photo PDF (11.65 MB of corpus photo) to 500 KB.
  {
    const { page, errors, failed } = await openPage(BASE + '/compress-pdf/');
    const input = await page.$('#cp-file');
    await input.uploadFile(PHOTO_PDF);
    await page.waitForFunction(() => !document.getElementById('cp-run').disabled, { timeout: 30000 });
    await page.$eval('#cp-custom', (el) => { el.value = '500'; el.dispatchEvent(new Event('change')); });
    await page.click('#cp-run');
    await page.waitForFunction(() => !document.getElementById('cp-result').classList.contains('hidden'), { timeout: 420000 });
    const note = await page.$eval('#cp-achieved', (el) => el.textContent);
    const b64 = await page.evaluate(async () => {
      const href = document.getElementById('cp-download').href;
      const buf = await (await fetch(href)).arrayBuffer();
      const bytes = new Uint8Array(buf);
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      return btoa(bin);
    });
    const outPath = path.join(HERE, 'out-compressed-500k.pdf');
    fs.writeFileSync(outPath, Buffer.from(b64, 'base64'));
    const size = fs.statSync(outPath).size;
    results.tools.compressPdfPhoto = { note, outputBytes: size, underTarget: size <= 500 * 1024, savedTo: outPath, consoleErrors: errors, failedRequests: failed };
    console.log('TOOL compress-pdf (photo):', note, '| bytes', size);
    await page.close();
  }

  // Helper: pull a blob: download link's bytes out of the page and save them.
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

  // 3c. OCR tool: corpus scanned invoice, key strings must be read.
  {
    const { page, errors, failed } = await openPage(BASE + '/ocr-pdf/');
    const input = await page.$('#oc-file');
    await input.uploadFile(path.join(CORPUS, 'test-scanned-ocr.pdf'));
    await page.waitForFunction(() => !document.getElementById('oc-run').disabled, { timeout: 60000 });
    await page.click('#oc-run');
    await page.waitForFunction(() => !document.getElementById('oc-result').classList.contains('hidden'), { timeout: 420000 });
    const text = await page.$eval('#oc-text', (el) => el.value);
    const note = await page.$eval('#oc-achieved', (el) => el.textContent);
    const checks = {
      hasInvoice: text.includes('INVOICE'), hasNumber: text.includes('2026-TEST-0042') || text.includes('2026') && text.includes('0042'),
      hasWidget: text.includes('Widget'), hasTotalDue: text.includes('Total due'),
      decimalKept: text.includes('124.50'), decimalDropped: text.includes('12450'),
    };
    // Searchable PDF: capture the real download via CDP and check it locally.
    const dlDir = path.join(HERE, 'downloads');
    fs.mkdirSync(dlDir, { recursive: true });
    const client = await page.createCDPSession();
    await client.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dlDir });
    await page.click('#oc-download-pdf');
    let dlFile = null;
    for (let i = 0; i < 60 && !dlFile; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const names = fs.readdirSync(dlDir).filter((n) => n.endsWith('.pdf') && !n.endsWith('.crdownload'));
      if (names.length) dlFile = path.join(dlDir, names[0]);
    }
    results.tools.ocr = { note, checks, textSample: text.slice(0, 300), searchablePdf: dlFile, consoleErrors: errors, failedRequests: failed };
    console.log('TOOL ocr:', JSON.stringify(checks), '| pdf:', dlFile);
    await page.close();
  }

  // 3d. Merge tool: the whole 25-file corpus batch, order verified outside.
  {
    const { page, errors, failed } = await openPage(BASE + '/merge-pdf/');
    const batch = fs.readdirSync(path.join(CORPUS, 'batch25')).filter((n) => n.endsWith('.pdf')).sort()
      .map((n) => path.join(CORPUS, 'batch25', n));
    const input = await page.$('#mg-file');
    await input.uploadFile(...batch);
    await page.waitForFunction(() => !document.getElementById('mg-run').disabled, { timeout: 60000 });
    const rows = await page.$$eval('#mg-list > li', (els) => els.length);
    await page.click('#mg-run');
    await page.waitForFunction(() => !document.getElementById('mg-result').classList.contains('hidden'), { timeout: 120000 });
    const note = await page.$eval('#mg-achieved', (el) => el.textContent);
    const outPath = await saveBlob(page, '#mg-download', 'out-merged-25.pdf');
    results.tools.merge = { note, listRows: rows, savedTo: outPath, bytes: fs.statSync(outPath).size, consoleErrors: errors, failedRequests: failed };
    console.log('TOOL merge:', note, '| rows', rows, '| bytes', fs.statSync(outPath).size);
    await page.close();
  }

  // 3e. Split tool: range 1-5, then every-page mode.
  {
    const { page, errors, failed } = await openPage(BASE + '/split-pdf/');
    const input = await page.$('#sp-file');
    await input.uploadFile(path.join(CORPUS, 'test-10page.pdf'));
    await page.waitForFunction(() => !document.getElementById('sp-run').disabled, { timeout: 30000 });
    await page.$eval('#sp-to', (el) => { el.value = '5'; });
    await page.click('#sp-run');
    await page.waitForFunction(() => !document.getElementById('sp-result').classList.contains('hidden'), { timeout: 60000 });
    const outPath = await saveBlob(page, '#sp-links a', 'out-split-1-5.pdf');
    await page.$eval('input[name="sp-mode"][value="each"]', (el) => { el.checked = true; });
    await page.click('#sp-run');
    await page.waitForFunction(() => document.querySelectorAll('#sp-links .spec-row').length === 10, { timeout: 60000 });
    const eachLinks = await page.$$eval('#sp-links .spec-row', (els) => els.length);
    results.tools.split = { rangeSavedTo: outPath, rangeBytes: fs.statSync(outPath).size, eachPageLinks: eachLinks, consoleErrors: errors, failedRequests: failed };
    console.log('TOOL split: range bytes', fs.statSync(outPath).size, '| each-page links', eachLinks);
    await page.close();
  }

  // 3f. Preset page: photo PDF to the locked 200 KB target.
  {
    const { page, errors, failed } = await openPage(BASE + '/compress-pdf-to-200kb/');
    const input = await page.$('#cp-file');
    await input.uploadFile(PHOTO_PDF);
    await page.waitForFunction(() => !document.getElementById('cp-run').disabled, { timeout: 30000 });
    await page.click('#cp-run');
    await page.waitForFunction(() => !document.getElementById('cp-result').classList.contains('hidden'), { timeout: 420000 });
    const note = await page.$eval('#cp-achieved', (el) => el.textContent);
    const outPath = await saveBlob(page, '#cp-download', 'out-preset-200k.pdf');
    const size = fs.statSync(outPath).size;
    results.tools.presetPdf200 = { note, outputBytes: size, underTarget: size <= 200 * 1024, savedTo: outPath, consoleErrors: errors, failedRequests: failed };
    console.log('TOOL preset-pdf-200k:', note, '| bytes', size);
    await page.close();
  }

  // 3g. Preset page: corpus photo to the locked 50 KB target.
  {
    const { page, errors, failed } = await openPage(BASE + '/compress-image-to-50kb/');
    const input = await page.$('#ci-file');
    await input.uploadFile(path.join(CORPUS, 'test-large-photo.jpg'));
    await page.waitForFunction(() => !document.getElementById('ci-run').disabled, { timeout: 15000 });
    await page.click('#ci-run');
    await page.waitForFunction(() => !document.getElementById('ci-result').classList.contains('hidden'), { timeout: 420000 });
    const note = await page.$eval('#ci-achieved', (el) => el.textContent);
    const blobSize = await page.evaluate(async () => {
      const href = document.getElementById('ci-download').href;
      return (await (await fetch(href)).blob()).size;
    });
    results.tools.presetImage50 = { note, blobSize, within5pct: Math.abs(blobSize - 50 * 1024) / (50 * 1024) <= 0.05, consoleErrors: errors, failedRequests: failed };
    console.log('TOOL preset-image-50k:', note, '| blob', blobSize);
    await page.close();
  }

  // 3h. Size checker: image spec, then PDF spec.
  {
    const { page, errors, failed } = await openPage(BASE + '/size-checker/');
    const input = await page.$('#sc-file');
    await input.uploadFile(path.join(CORPUS, 'test-large-photo.jpg'));
    await page.waitForFunction(() => document.getElementById('sc-spec').textContent.includes('4000 x 3000'), { timeout: 30000 });
    const imgSpec = await page.$eval('#sc-spec', (el) => el.textContent.replace(/\s+/g, ' '));
    const doors = await page.$eval('#sc-doors', (el) => el.textContent.replace(/\s+/g, ' ').slice(0, 200));
    results.tools.sizeCheckerImage = { spec: imgSpec, doors, consoleErrors: errors, failedRequests: failed };
    console.log('TOOL size-checker (image):', imgSpec.slice(0, 220));
    await page.close();
    const p2 = await openPage(BASE + '/size-checker/');
    const input2 = await p2.page.$('#sc-file');
    await input2.uploadFile(path.join(CORPUS, 'test-10page.pdf'));
    await p2.page.waitForFunction(() => document.getElementById('sc-spec').textContent.includes('pages'), { timeout: 30000 });
    const pdfSpec = await p2.page.$eval('#sc-spec', (el) => el.textContent.replace(/\s+/g, ' '));
    results.tools.sizeCheckerPdf = { spec: pdfSpec, consoleErrors: p2.errors, failedRequests: p2.failed };
    console.log('TOOL size-checker (pdf):', pdfSpec.slice(0, 220));
    await p2.page.close();
  }

  // 4. Background tool: full run on the bench target photo (best effort with
  // a long allowance; the load check above is the required gate).
  {
    const { page, errors, failed } = await openPage(BASE + '/remove-background/');
    const input = await page.$('#bg-file');
    await input.uploadFile(path.join(CORPUS, 'test-bg-hard.png'));
    await page.waitForFunction(() => !document.getElementById('bg-run').disabled, { timeout: 15000 });
    await page.click('#bg-run');
    try {
      await page.waitForFunction(() => {
        const r = document.getElementById('bg-result');
        const n = document.getElementById('bg-nosubject');
        return (r && !r.classList.contains('hidden')) || (n && !n.classList.contains('hidden'));
      }, { timeout: 420000 });
      const times = await page.$eval('#bg-times', (el) => el.textContent).catch(() => '');
      const noSubject = await page.$eval('#bg-nosubject', (el) => !el.classList.contains('hidden'));
      const modelCache = await page.evaluate(async () => {
        let chunks = 0, manifest = 0;
        for (const k of await caches.keys()) {
          const c = await caches.open(k);
          for (const r of await c.keys()) {
            const p = new URL(r.url).pathname;
            if (p.startsWith('/models/chunks/')) chunks++;
            if (p === '/models/model-manifest.json') manifest++;
          }
        }
        return { chunksCached: chunks, manifestCached: manifest };
      }).catch(() => ({ chunksCached: -1, manifestCached: -1 }));
      results.tools.removeBackground = { ran: true, times, noSubjectShown: noSubject, modelCache, consoleErrors: errors, failedRequests: failed };
      console.log('TOOL remove-bg:', times, 'noSubject:', noSubject);
      await page.screenshot({ path: path.join(SHOTS, 'remove-bg-result.png'), fullPage: true });
    } catch (e) {
      const st = await page.$eval('#bg-status', (el) => el.textContent).catch(() => '?');
      results.tools.removeBackground = { ran: false, lastStatus: st, consoleErrors: errors, failedRequests: failed };
      console.log('TOOL remove-bg: did not finish. status:', st);
    }
    await page.close();
  }
} finally {
  if (browser) await browser.close();
  server.close();
}
fs.writeFileSync(path.join(HERE, 'results.json'), JSON.stringify(results, null, 2));
console.log('VERIFY DONE');
