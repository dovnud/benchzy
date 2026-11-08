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
import JSZip from 'jszip';
import { PDFDocument, PDFName } from '@cantoo/pdf-lib';
import { execFileSync } from 'node:child_process';

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
    protocolTimeout: 900000,
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
  const BG_CLUSTER = ['/remove-background/', '/remove-background-full-resolution/',
    '/es/quitar-fondo-de-imagen-gratis/', '/es/quitar-fondo-resolucion-completa/',
    '/pt-br/remover-fundo-de-imagem-gratis/', '/pt-br/alternativa-gratis-ao-remove-bg/'];
  for (const route of ['/', '/remove-background/', '/compress-pdf/', '/compress-image/', '/credits/',
    '/ocr-pdf/', '/merge-pdf/', '/split-pdf/', '/compress-pdf-to-200kb/', '/compress-image-to-50kb/', '/size-checker/',
    '/remove-background-full-resolution/', '/background-removal/', '/vs-remove-bg/', '/remove-bg-alternatives/',
    '/remove-bg-december-1/', '/remove-bg-api/', '/check-it-yourself/', '/what-free-means/',
    '/tools/', '/pdf-tools/', '/image-tools/',
    '/es/quitar-fondo-de-imagen-gratis/', '/es/quitar-fondo-resolucion-completa/',
    '/pt-br/remover-fundo-de-imagem-gratis/', '/pt-br/alternativa-gratis-ao-remove-bg/',
    '/batch-compress-pdf/', '/batch-merge-pdf/', '/batch-split-pdf/',
    '/batch-compress-images/', '/batch-convert-images/', '/batch-remove-background/',
    '/workflows/', '/presets/', '/sign-pdf/', '/flatten-pdf/', '/interleave-pdf/',
    '/compress-pdf-strong/']) {
    const { page, errors, failed } = await openPage(BASE + route);
    results.pages[route] = { consoleErrors: errors, failedRequests: failed };
    console.log('PAGE', route, 'errors:', errors.length, 'failed:', failed.length, JSON.stringify([...errors, ...failed]).slice(0, 300));
    if (BG_CLUSTER.includes(route)) {
      // i18n wiring: html lang, hreflang alternates, island locale.
      const i18n = await page.evaluate(() => ({
        htmlLang: document.documentElement.lang,
        islandLocale: (document.getElementById('bg-tool') || { dataset: {} }).dataset.locale || null,
        alternates: [...document.querySelectorAll('link[rel="alternate"]')].map((l) => l.hreflang + '=' + l.getAttribute('href')),
        statusText: (document.getElementById('bg-status') || {}).textContent || null,
      }));
      results.pages[route].i18n = i18n;
      console.log('I18N', route, JSON.stringify(i18n));
    }
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
    if (route === '/es/quitar-fondo-de-imagen-gratis/') {
      await page.screenshot({ path: path.join(SHOTS, 'es-quitar-fondo-desktop.png'), fullPage: true });
      await page.setViewport({ width: 390, height: 844 });
      await page.screenshot({ path: path.join(SHOTS, 'es-quitar-fondo-mobile.png'), fullPage: true });
      await page.setViewport({ width: 1280, height: 900 });
    }
    if (route === '/pt-br/remover-fundo-de-imagem-gratis/') {
      await page.screenshot({ path: path.join(SHOTS, 'pt-remover-fundo-desktop.png'), fullPage: true });
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

  // 4. Background tool: full run on the bench target photo, once per
  // locale (EN gate as before, plus one ES and one PT-BR page to prove
  // the extracted strings drive a complete, correct job).
  async function runBg(route, key, expect) {
    const { page, errors, failed } = await openPage(BASE + route);
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
      const status = await page.$eval('#bg-status', (el) => el.textContent).catch(() => '');
      const dlName = await page.$eval('#bg-download', (el) => el.download).catch(() => '');
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
      results.tools[key] = {
        ran: true, times, status, dlName, noSubjectShown: noSubject, modelCache,
        fullSizeInTimes: times.includes('1200 x 900'),
        doneStatusOk: status === expect.doneStatus,
        dlSuffixOk: dlName.endsWith(expect.dlSuffix),
        consoleErrors: errors, failedRequests: failed,
      };
      console.log('TOOL', key + ':', times, '| status:', status, '| dl:', dlName, 'noSubject:', noSubject);
      if (key === 'removeBackground') await page.screenshot({ path: path.join(SHOTS, 'remove-bg-result.png'), fullPage: true });
    } catch (e) {
      const st = await page.$eval('#bg-status', (el) => el.textContent).catch(() => '?');
      results.tools[key] = { ran: false, lastStatus: st, consoleErrors: errors, failedRequests: failed };
      console.log('TOOL', key + ': did not finish. status:', st);
    }
    await page.close();
  }
  await runBg('/remove-background/', 'removeBackground', { doneStatus: 'Done.', dlSuffix: '-no-background.png' });
  await runBg('/es/quitar-fondo-de-imagen-gratis/', 'removeBackgroundEs', { doneStatus: 'Listo.', dlSuffix: '-sin-fondo.png' });
  await runBg('/pt-br/remover-fundo-de-imagem-gratis/', 'removeBackgroundPtBr', { doneStatus: 'Pronto.', dlSuffix: '-sem-fundo.png' });

  // Fresh browser for the milestone-6 block: the earlier sections leave
  // WASM instances, model sessions and blob URLs behind, and the batch
  // tests push large bitmaps. A clean process keeps the gates honest
  // (in the shared browser the big photo's cutout and the workflow
  // chain's CDP waits died of accumulated memory, not of page faults;
  // both pass in a fresh browser, see verify/debug-m6.mjs).
  await browser.close();
  browser = await puppeteer.launch({
    executablePath: EXE,
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
    protocolTimeout: 900000,
  });

  // 5. Milestone 6: the BUILD NEXT batch. Every in-page result is
  // checked against the numbers the benches measured (NUMBERS.md).
  async function relaunch() {
    await browser.close();
    browser = await puppeteer.launch({
      executablePath: EXE,
      headless: 'new',
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
      protocolTimeout: 900000,
    });
  }
  const PHOTO3_PDF = '/home/hatch/workspace/file-toolkit/bench/pdfnums/out/photo-3page.pdf';
  const FORM_FIXTURE = path.join(HERE, 'fixtures', 'form-fixture.pdf');
  async function zipEntries(file) {
    const zip = await JSZip.loadAsync(fs.readFileSync(file));
    const out = [];
    for (const [name, f] of Object.entries(zip.files)) {
      if (!f.dir) out.push({ name, size: (await f.async('uint8array')).length });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }
  async function shown(page, id, timeout = 600000) {
    await page.waitForFunction((i) => !document.getElementById(i).classList.contains('hidden'), { timeout }, id);
  }

  // 5a. Batch compress PDF: photo PDF x2 + text PDF at the 500 KB default.
  {
    const { page, errors, failed } = await openPage(BASE + '/batch-compress-pdf/');
    const input = await page.$('#bp-file');
    await input.uploadFile(PHOTO_PDF, PHOTO_PDF, path.join(CORPUS, 'test-10page.pdf'));
    await page.waitForFunction(() => !document.getElementById('bp-run').disabled, { timeout: 30000 });
    await page.click('#bp-run');
    await shown(page, 'bp-result', 900000);
    const rows = await page.$$eval('#bp-rows > div', (ds) => ds.map((d) => d.textContent.replace(/\s+/g, ' ').trim()));
    const outPath = await saveBlob(page, '#bp-zip', 'm6-batch-compress.zip');
    const entries = await zipEntries(outPath);
    const photos = entries.filter((e) => e.name.startsWith('photo-1page'));
    results.tools.m6BatchCompress = {
      rows, entries,
      photoOutputsUnder500k: photos.length === 2 && photos.every((e) => e.size <= 500 * 1024),
      consoleErrors: errors, failedRequests: failed,
    };
    console.log('TOOL m6 batch-compress:', JSON.stringify(entries), '| rows:', rows.length);
    await page.close();
  }

  // 5b. Batch merge PDF: the whole batch25 folder, bench number 6,673 B.
  {
    const { page, errors, failed } = await openPage(BASE + '/batch-merge-pdf/');
    const files = fs.readdirSync(path.join(CORPUS, 'batch25')).sort().map((f) => path.join(CORPUS, 'batch25', f));
    const input = await page.$('#bp-file');
    await input.uploadFile(...files);
    await page.waitForFunction(() => !document.getElementById('bp-run').disabled, { timeout: 30000 });
    await page.click('#bp-run');
    await shown(page, 'bp-result', 120000);
    const note = await page.$eval('#bp-rows', (el) => el.textContent.replace(/\s+/g, ' ').trim());
    const outPath = await saveBlob(page, '#bp-rows a', 'm6-batch-merged.pdf');
    const bytes = fs.statSync(outPath).size;
    // Bench output was 6,673 B. pdf-lib embeds save-time metadata, so
    // the container jitters by a byte between runs (observed 6,673 and
    // 6,674 from this same path); the gate is the bench size within
    // that jitter, with page content checked by the island merge test.
    results.tools.m6BatchMerge = { note, bytes, benchBytes: 6673, matchesBench: Math.abs(bytes - 6673) <= 2, consoleErrors: errors, failedRequests: failed };
    console.log('TOOL m6 batch-merge:', note, '| bytes', bytes);
    await page.close();
  }

  // 5c. Batch split PDF: pages 1-2 from two files, ZIP of two 2-page PDFs.
  {
    const { page, errors, failed } = await openPage(BASE + '/batch-split-pdf/');
    const input = await page.$('#bp-file');
    await input.uploadFile(path.join(CORPUS, 'test-10page.pdf'), path.join(CORPUS, 'test-3page-second.pdf'));
    await page.waitForFunction(() => !document.getElementById('bp-run').disabled, { timeout: 30000 });
    await page.$eval('#bp-from', (el) => { el.value = '1'; });
    await page.$eval('#bp-to', (el) => { el.value = '2'; });
    await page.click('#bp-run');
    await shown(page, 'bp-result', 120000);
    const outPath = await saveBlob(page, '#bp-zip', 'm6-batch-split.zip');
    const zip = await JSZip.loadAsync(fs.readFileSync(outPath));
    const pageCounts = [];
    for (const [name, f] of Object.entries(zip.files)) {
      if (f.dir) continue;
      const doc = await PDFDocument.load(await f.async('uint8array'));
      pageCounts.push({ name, pages: doc.getPageCount() });
    }
    results.tools.m6BatchSplit = { pageCounts, twoFilesTwoPages: pageCounts.length === 2 && pageCounts.every((p) => p.pages === 2), consoleErrors: errors, failedRequests: failed };
    console.log('TOOL m6 batch-split:', JSON.stringify(pageCounts));
    await page.close();
  }

  // 5d. Batch compress images: corpus photo at 200 KB must reproduce
  // the bench landing byte for byte: 199,856 B.
  {
    const { page, errors, failed } = await openPage(BASE + '/batch-compress-images/');
    const input = await page.$('#bi-file');
    await input.uploadFile(path.join(CORPUS, 'test-large-photo.jpg'));
    await page.waitForFunction(() => !document.getElementById('bi-run').disabled, { timeout: 30000 });
    await page.evaluate(() => {
      const chip = [...document.querySelectorAll('#bi-targets button')].find((b) => b.textContent.trim().startsWith('200'));
      chip.click();
    });
    await page.click('#bi-run');
    await shown(page, 'bi-result', 600000);
    const rows = await page.$$eval('#bi-rows > div', (ds) => ds.map((d) => d.textContent.replace(/\s+/g, ' ').trim()));
    const outPath = await saveBlob(page, '#bi-zip', 'm6-batch-images.zip');
    const entries = await zipEntries(outPath);
    results.tools.m6BatchImages = {
      rows, entries,
      benchLanding: entries.length === 1 ? entries[0].size : -1,
      matchesBench199856: entries.length === 1 && entries[0].size === 199856,
      consoleErrors: errors, failedRequests: failed,
    };
    console.log('TOOL m6 batch-images:', JSON.stringify(entries), '| rows:', rows.join(' '));
    await page.close();
  }

  // 5e. Batch convert images: corpus photo to WebP q80, bench 251,730 B.
  {
    const { page, errors, failed } = await openPage(BASE + '/batch-convert-images/');
    const input = await page.$('#bi-file');
    await input.uploadFile(path.join(CORPUS, 'test-large-photo.jpg'));
    await page.waitForFunction(() => !document.getElementById('bi-run').disabled, { timeout: 30000 });
    await page.click('#bi-run');
    await shown(page, 'bi-result', 600000);
    const rows = await page.$$eval('#bi-rows > div', (ds) => ds.map((d) => d.textContent.replace(/\s+/g, ' ').trim()));
    const outPath = await saveBlob(page, '#bi-zip', 'm6-batch-convert.zip');
    const zip = await JSZip.loadAsync(fs.readFileSync(outPath));
    const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
    const buf = await zip.files[names[0]].async('nodebuffer');
    const magic = buf.subarray(0, 4).toString('latin1') + '/' + buf.subarray(8, 12).toString('latin1');
    results.tools.m6BatchConvert = {
      rows, entry: names[0], bytes: buf.length, magic,
      within2pctOfBench: Math.abs(buf.length - 251730) / 251730 <= 0.02,
      consoleErrors: errors, failedRequests: failed,
    };
    console.log('TOOL m6 batch-convert:', names[0], buf.length, magic);
    await page.close();
  }

  // 5f. Batch remove background: hard photo + one more, model once.
  await relaunch();
  {
    const { page, errors, failed } = await openPage(BASE + '/batch-remove-background/');
    const input = await page.$('#bb-file');
    await input.uploadFile(path.join(CORPUS, 'test-bg-hard.png'), path.join(CORPUS, 'test-photo-realistic-large.jpg'));
    await page.waitForFunction(() => !document.getElementById('bb-run').disabled, { timeout: 30000 });
    await page.click('#bb-run');
    await shown(page, 'bb-result', 900000);
    const rows = await page.$$eval('#bb-rows > div', (ds) => ds.map((d) => d.textContent.replace(/\s+/g, ' ').trim()));
    const outPath = await saveBlob(page, '#bb-zip', 'm6-batch-bg.zip');
    const entries = await zipEntries(outPath);
    const hard = entries.find((e) => e.name.startsWith('test-bg-hard'));
    results.tools.m6BatchBg = {
      rows, entries,
      hardCutoutBytes: hard ? hard.size : -1,
      hardNearBench915k: !!hard && hard.size >= 880000 && hard.size <= 990000,
      consoleErrors: errors, failedRequests: failed,
    };
    console.log('TOOL m6 batch-bg:', JSON.stringify(entries));
    await page.close();
  }

  // 5g. Workflows (T7): save the Invoice pack starter, run it end to
  // end on real files, reload, and find the chain still saved.
  await relaunch();
  {
    const { page, errors, failed } = await openPage(BASE + '/workflows/');
    await page.click('[data-starter="starter-invoice-pack"]');
    await page.waitForFunction(() => document.querySelectorAll('#wf-steps > div').length === 2, { timeout: 15000 });
    const stored = await page.evaluate(() => localStorage.getItem('benchzy-chains') || '');
    const input = await page.$('#wf-file');
    const three = ['batch-01.pdf', 'batch-02.pdf', 'batch-03.pdf'].map((f) => path.join(CORPUS, 'batch25', f));
    await input.uploadFile(...three, PHOTO_PDF);
    await page.waitForFunction(() => !document.getElementById('wf-run').disabled, { timeout: 30000 });
    await page.click('#wf-run');
    await page.waitForFunction(() => document.querySelectorAll('#wf-outputs a').length >= 1, { timeout: 900000 });
    const log = await page.$eval('#wf-log', (el) => el.textContent);
    const outSize = await page.evaluate(async () => {
      const a = document.querySelector('#wf-outputs a');
      const b = await (await fetch(a.href)).blob();
      return { name: a.download, size: b.size };
    });
    await page.goto(BASE + '/workflows/', { waitUntil: 'networkidle0', timeout: 60000 });
    const savedAfterReload = await page.$eval('#wf-saved', (el) => el.textContent);
    results.tools.m6Workflows = {
      storedHasInvoicePack: stored.includes('starter-invoice-pack'),
      log: log.slice(0, 400), output: outSize,
      outputUnder500k: outSize.size <= 500 * 1024,
      persistsAfterReload: savedAfterReload.includes('Invoice pack'),
      consoleErrors: errors, failedRequests: failed,
    };
    console.log('TOOL m6 workflows:', JSON.stringify(outSize), '| persisted:', savedAfterReload.includes('Invoice pack'));
    await page.close();
  }

  // 5h. Sign PDF: typed signature on the last page of the 10-page corpus PDF.
  {
    const { page, errors, failed } = await openPage(BASE + '/sign-pdf/');
    const input = await page.$('#sg-file');
    await input.uploadFile(path.join(CORPUS, 'test-10page.pdf'));
    await page.waitForFunction(() => !document.getElementById('sg-run').disabled, { timeout: 30000 });
    await page.$eval('input[name="sg-source"][value="type"]', (el) => el.click());
    await page.type('#sg-typed', 'Ada Lovelace');
    await page.click('#sg-run');
    await shown(page, 'sg-result', 120000);
    const note = await page.$eval('#sg-achieved', (el) => el.textContent);
    const outPath = await saveBlob(page, '#sg-download', 'm6-signed.pdf');
    const doc = await PDFDocument.load(fs.readFileSync(outPath));
    const lastPage = doc.getPage(doc.getPageCount() - 1);
    const res = lastPage.node.Resources();
    const xo = res ? res.lookup(PDFName.of('XObject')) : null;
    let images = 0;
    if (xo) for (const k of xo.keys()) { const o = xo.lookup(k); if (o && o.dict && o.dict.get(PDFName.of('Subtype')) && o.dict.get(PDFName.of('Subtype')).toString() === '/Image') images++; }
    results.tools.m6Sign = { note, pages: doc.getPageCount(), imagesOnLastPage: images, consoleErrors: errors, failedRequests: failed };
    console.log('TOOL m6 sign:', note, '| pages', doc.getPageCount(), '| images on last page', images);
    await page.close();
  }

  // 5i. Strong compression: photo PDF well under the 200 KB preset
  // landing (195,029 B); text PDF returned unchanged with the reason.
  await relaunch();
  {
    const { page, errors, failed } = await openPage(BASE + '/compress-pdf-strong/');
    const input = await page.$('#cp-file');
    await input.uploadFile(PHOTO_PDF);
    await page.waitForFunction(() => !document.getElementById('cp-run').disabled, { timeout: 30000 });
    await page.click('#cp-run');
    await shown(page, 'cp-result', 900000);
    const note = await page.$eval('#cp-achieved', (el) => el.textContent);
    const outPath = await saveBlob(page, '#cp-download', 'm6-strong.pdf');
    const strongBytes = fs.statSync(outPath).size;
    const p2 = await openPage(BASE + '/compress-pdf-strong/');
    const input2 = await p2.page.$('#cp-file');
    await input2.uploadFile(path.join(CORPUS, 'test-10page.pdf'));
    await p2.page.waitForFunction(() => !document.getElementById('cp-run').disabled, { timeout: 30000 });
    await p2.page.click('#cp-run');
    await shown(p2.page, 'cp-result', 120000);
    const note2 = await p2.page.$eval('#cp-achieved', (el) => el.textContent);
    const textBytes = await p2.page.evaluate(async () => {
      const b = await (await fetch(document.getElementById('cp-download').href)).blob();
      return b.size;
    });
    results.tools.m6Strong = {
      note, strongBytes, underPresetLanding: strongBytes > 0 && strongBytes < 195029,
      textNote: note2, textBytes, textUnchanged: textBytes === fs.statSync(path.join(CORPUS, 'test-10page.pdf')).size,
      consoleErrors: [...errors, ...p2.errors], failedRequests: [...failed, ...p2.failed],
    };
    console.log('TOOL m6 strong:', note, '| bytes', strongBytes, '| text:', note2, textBytes);
    await page.close();
    await p2.page.close();
  }

  // 5j. Interleave: 10-page A + 3-page B -> A1 B1 A2 B2 A3 B3 A4..A10.
  {
    const { page, errors, failed } = await openPage(BASE + '/interleave-pdf/');
    await (await page.$('#il-file-a')).uploadFile(path.join(CORPUS, 'test-10page.pdf'));
    await (await page.$('#il-file-b')).uploadFile(path.join(CORPUS, 'test-3page-second.pdf'));
    await page.waitForFunction(() => !document.getElementById('il-run').disabled, { timeout: 30000 });
    await page.click('#il-run');
    await shown(page, 'il-result', 120000);
    const note = await page.$eval('#il-achieved', (el) => el.textContent);
    const outPath = await saveBlob(page, '#il-download', 'm6-interleaved.pdf');
    const doc = await PDFDocument.load(fs.readFileSync(outPath));
    const text = execFileSync('pdftotext', [outPath, '-'], { encoding: 'utf8' });
    const markers = text.split('\f').map((s) => (s.match(/(PAGE-\d+|SECOND-\d+)/) || [])[1]).filter(Boolean);
    const expect = ['PAGE-01', 'SECOND-01', 'PAGE-02', 'SECOND-02', 'PAGE-03', 'SECOND-03', 'PAGE-04', 'PAGE-05', 'PAGE-06', 'PAGE-07', 'PAGE-08', 'PAGE-09', 'PAGE-10'];
    results.tools.m6Interleave = { note, pages: doc.getPageCount(), markers, orderOk: JSON.stringify(markers) === JSON.stringify(expect), consoleErrors: errors, failedRequests: failed };
    console.log('TOOL m6 interleave:', note, '| order ok:', JSON.stringify(markers) === JSON.stringify(expect));
    await page.close();
  }

  // 5k. Split by size: the 3-page photo PDF (11.65 MB) under 5,000 KB parts.
  {
    const { page, errors, failed } = await openPage(BASE + '/split-pdf/');
    const input = await page.$('#sp-file');
    await input.uploadFile(PHOTO3_PDF);
    await page.waitForFunction(() => !document.getElementById('sp-run').disabled, { timeout: 30000 });
    await page.$eval('input[name="sp-mode"][value="size"]', (el) => el.click());
    await page.$eval('#sp-size-kb', (el) => { el.value = '5000'; el.dispatchEvent(new Event('change')); });
    await page.click('#sp-run');
    await shown(page, 'sp-result', 900000);
    const parts = await page.evaluate(async () => {
      const out = [];
      for (const a of document.querySelectorAll('#sp-links a')) {
        if (a.download.includes('.zip')) continue;
        const buf = await (await fetch(a.href)).arrayBuffer();
        const bytes = new Uint8Array(buf);
        let bin = '';
        for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
        out.push({ name: a.download, size: bytes.length, b64: btoa(bin) });
      }
      return out;
    });
    let totalPages = 0;
    for (const p of parts) {
      const doc = await PDFDocument.load(Buffer.from(p.b64, 'base64'));
      totalPages += doc.getPageCount();
      delete p.b64;
    }
    const linksText = await page.$eval('#sp-links', (el) => el.textContent);
    // The fixture's three pages share one 11.65 MB image through the
    // page tree, so each page alone outweighs the 5,000 KB limit: the
    // honest outcome is 3 parts, each carrying the shared image whole
    // (the gate is size >= 11 MB, where a copy-based extraction
    // silently produced 1.3 KB empty shells for pages 2 and 3), each
    // flagged over the limit on its download line.
    results.tools.m6SplitSize = {
      parts, partCount: parts.length, totalPages,
      everyPartCarriesTheImage: parts.every((p) => p.size >= 11000000),
      overLimitFlagged: (linksText.match(/over the limit/g) || []).length === parts.length,
      consoleErrors: errors, failedRequests: failed,
    };
    console.log('TOOL m6 split-size:', JSON.stringify(parts));
    await page.close();
  }

  // 5l. Flatten: fixture form -> zero fields left, value baked in.
  {
    const { page, errors, failed } = await openPage(BASE + '/flatten-pdf/');
    const input = await page.$('#fl-file');
    await input.uploadFile(FORM_FIXTURE);
    try {
      await page.waitForFunction(() => (document.getElementById('fl-status') || {}).textContent.includes('3 form fields will be baked'), { timeout: 120000 });
    } catch (e) {
      const st = await page.$eval('#fl-status', (el) => el.textContent).catch(() => '?');
      throw new Error('flatten spec never showed 3 fields; page status: ' + st);
    }
    await page.click('#fl-run');
    await shown(page, 'fl-result', 120000);
    const note = await page.$eval('#fl-achieved', (el) => el.textContent);
    const outPath = await saveBlob(page, '#fl-download', 'm6-flattened.pdf');
    const doc = await PDFDocument.load(fs.readFileSync(outPath));
    const fieldsLeft = doc.getForm().getFields().length;
    const text = execFileSync('pdftotext', [outPath, '-'], { encoding: 'utf8' });
    results.tools.m6Flatten = {
      note, fieldsLeft,
      valueBakedIn: text.includes('Ada Lovelace'),
      consoleErrors: errors, failedRequests: failed,
    };
    console.log('TOOL m6 flatten:', note, '| fields left', fieldsLeft, '| value in text:', text.includes('Ada Lovelace'));
    await page.close();
  }
} finally {
  if (browser) await browser.close();
  server.close();
}
fs.writeFileSync(path.join(HERE, 'results.json'), JSON.stringify(results, null, 2));
console.log('VERIFY DONE');
