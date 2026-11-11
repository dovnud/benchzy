// Benchzy milestone-1 verification.
// Serves dist/ locally, drives headless Chrome (puppeteer-core from the
// file-toolkit webtest bench, same Chrome as the earlier benches), checks
// every page for console errors and failed requests, then runs the image
// and PDF tools end to end on corpus files and the background tool on the
// bench target photo. Writes verify/results.json and screenshots.
//
// Milestone 19 (GA4): every page now carries the Google tag. The sandbox
// browser cannot reach Google at all (probed 2026-11-09: the default
// launch fails with ERR_TUNNEL_CONNECTION_FAILED, an explicit
// --proxy-server with the egress credentials fails with
// ERR_NO_SUPPORTED_PROXIES, and a direct connection fails with
// ERR_SSL_PROTOCOL_ERROR), so the harness deliberately intercepts the
// two Google hosts in openPage: it RECORDS every request the page fires
// to them (host + full URL, asserted by the gates) and answers with a
// stand-in — a minimal gtag.js that mirrors the one behaviour this
// site's own code controls (a 'config' call fires one page_view collect
// carrying the measurement ID) and a 204/GIF for collects. On the live
// site the real Google library answers instead. This is a recorded
// harness stand-in for a third-party endpoint, not a weakened gate:
// before milestone 19 the gates asserted no cross-origin requests at
// all; they now assert the only cross-origin requests are the counter's,
// to its two hosts, with the right ID, and that no job sends anything.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from '../../file-toolkit/bench/webtest/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
import JSZip from 'jszip';
import { BIG_TEXT, ES_TEXT, PT_TEXT, charAccuracy } from './m10-texts.mjs';
import { PDFDocument, PDFName, PDFRawStream } from '@cantoo/pdf-lib';
import { extractPdfImages } from '../src/scripts/lib/pdf-images-core.js';
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
// Milestone 8 cancel gates: while chunkDelayMs > 0, model chunks are
// served slowly, so a load is genuinely in flight when the test
// presses Cancel (the delay is at the server, so the service worker
// cannot bypass it). Reset to 0 for every other test.
let chunkDelayMs = 0;
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const fp = path.join(DIST, p);
  if (!fp.startsWith(DIST) || !fs.existsSync(fp)) { res.writeHead(404); res.end('nf'); return; }
  const send = () => {
    res.writeHead(200, { 'content-type': MIME[path.extname(fp)] || 'application/octet-stream' });
    fs.createReadStream(fp).pipe(res);
  };
  if (p.startsWith('/models/chunks/') && chunkDelayMs > 0) setTimeout(send, chunkDelayMs);
  else send();
});
await new Promise((r) => server.listen(8977, r));
const BASE = 'http://127.0.0.1:8977';

const results = { pages: {}, tools: {} };
// Milestone 19: the measurement ID the site ships, and the stand-in
// script the harness serves in place of the real gtag.js (see the
// header note). The stand-in processes the page's own dataLayer queue
// exactly where this site's code ends and Google's begins: our inline
// snippet pushes 'js' and 'config' calls; the library's job is to
// turn the config into one page_view collect carrying the ID.
const GA_ID = 'G-PSWNWPP7PY';
const GA_STUB = `(function () {
  var dl = window.dataLayer = window.dataLayer || [];
  var fired = {};
  function process(entry) {
    var args = Array.prototype.slice.call(entry || []);
    if (args[0] === 'config' && typeof args[1] === 'string' && !fired[args[1]]) {
      fired[args[1]] = 1;
      var img = new Image();
      img.src = 'https://www.google-analytics.com/g/collect?v=2&tid=' + encodeURIComponent(args[1]) + '&en=page_view';
    }
  }
  for (var i = 0; i < dl.length; i++) process(dl[i]);
  var origPush = dl.push;
  dl.push = function () {
    for (var i = 0; i < arguments.length; i++) process(arguments[i]);
    return origPush.apply(dl, arguments);
  };
})();`;
const GA_GIF = Buffer.from('R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==', 'base64');
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
    // Milestone 19: per-page record of the counter's requests, filled
    // by the interception below and returned as `ga`.
    const ga = { js: [], collects: [] };
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('requestfailed', (r) => failed.push(r.url() + ' :: ' + (r.failure() || {}).errorText));
    page.on('response', (r) => { if (r.status() >= 400) failed.push(r.url() + ' :: HTTP ' + r.status()); });
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const u = req.url();
      let host = '';
      try { host = new URL(u).hostname; } catch { /* data:/blob: */ }
      if (host === 'www.googletagmanager.com') {
        ga.js.push(u);
        req.respond({ status: 200, contentType: 'text/javascript; charset=utf-8', body: GA_STUB }).catch(() => {});
      } else if (host === 'www.google-analytics.com' || host.endsWith('.google-analytics.com')) {
        ga.collects.push(u);
        if (req.resourceType() === 'image') req.respond({ status: 200, contentType: 'image/gif', body: GA_GIF }).catch(() => {});
        else req.respond({ status: 204, body: '' }).catch(() => {});
      } else {
        req.continue().catch(() => {});
      }
    });
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });
    return { page, errors, failed, ga };
  }

  // 1. Every page loads clean.
  const gaMissing = [];
  const BG_CLUSTER = ['/remove-background/', '/remove-background-full-resolution/',
    '/es/quitar-fondo-de-imagen-gratis/', '/es/quitar-fondo-resolucion-completa/',
    '/pt-br/remover-fundo-de-imagem-gratis/', '/pt-br/alternativa-gratis-ao-remove-bg/'];
  // Milestone 8: the trust cluster (promise page + proof page in
  // three languages) gets the same language-wiring check as the BG
  // cluster, minus the island locale.
  const TRUST_CLUSTER = ['/what-free-means/', '/check-it-yourself/',
    '/es/que-significa-gratis-aqui/', '/es/compruebalo-tu-mismo/',
    '/pt-br/o-que-significa-gratis/', '/pt-br/confira-voce-mesmo/'];
  for (const route of ['/', '/remove-background/', '/compress-pdf/', '/compress-image/', '/credits/',
    '/ocr-pdf/', '/ocr-image/', '/merge-pdf/', '/split-pdf/', '/compress-pdf-to-200kb/', '/compress-image-to-50kb/', '/size-checker/',
    '/remove-background-full-resolution/', '/remove-background/quality/', '/background-removal/', '/vs-remove-bg/', '/remove-bg-alternatives/',
    '/remove-bg-december-1/', '/remove-bg-api/', '/check-it-yourself/', '/what-free-means/',
    '/tools/', '/pdf-tools/', '/image-tools/',
    '/es/quitar-fondo-de-imagen-gratis/', '/es/quitar-fondo-resolucion-completa/',
    '/pt-br/remover-fundo-de-imagem-gratis/', '/pt-br/alternativa-gratis-ao-remove-bg/',
    '/batch-compress-pdf/', '/batch-merge-pdf/', '/batch-split-pdf/',
    '/batch-compress-images/', '/batch-convert-images/', '/batch-remove-background/',
    '/workflows/', '/presets/', '/sign-pdf/', '/flatten-pdf/', '/interleave-pdf/',
    '/protect-pdf/', '/unlock-pdf/',
    '/rotate-pdf/', '/pdf-page-numbers/', '/watermark-pdf/', '/extract-images-pdf/',
    '/organize-pdf/', '/pdf-metadata/', '/jpg-to-pdf/', '/pdf-to-jpg/',
    '/compress-pdf-to-50kb/', '/compress-pdf-to-100kb/', '/compress-pdf-to-500kb/', '/compress-pdf-to-1mb/',
    '/compress-pdf-strong/', '/privacy/',
    '/resize-image/', '/batch-resize-images/',
    '/png-to-jpg/', '/jpg-to-png/', '/webp-to-jpg/', '/jpg-to-webp/', '/png-to-webp/', '/webp-to-png/', '/heic-to-jpg/',
    '/es/que-significa-gratis-aqui/', '/es/compruebalo-tu-mismo/',
    '/pt-br/o-que-significa-gratis/', '/pt-br/confira-voce-mesmo/']) {
    const { page, errors, failed, ga } = await openPage(BASE + route);
    results.pages[route] = { consoleErrors: errors, failedRequests: failed, ga };
    // Milestone 19 gate, every route: the Google tag fired exactly
    // once (the library request, carrying the measurement ID) and the
    // page_view collect fired exactly once, to the analytics host,
    // carrying the same ID. Routes that miss are collected and thrown
    // on after the loop.
    const collectTid = ga.collects.length === 1 ? new URL(ga.collects[0]).searchParams.get('tid') : null;
    const gaOk = ga.js.length === 1 && ga.js[0].includes('id=' + GA_ID) && ga.collects.length === 1 && collectTid === GA_ID;
    results.pages[route].gaOk = gaOk;
    if (!gaOk) { gaMissing.push(route + ' :: ' + JSON.stringify(ga)); console.log('GA GATE FAIL on', route, JSON.stringify(ga)); }
    // Milestone 8 gates on every page: the footer links the privacy
    // page, and the killed aggregate sentence appears nowhere.
    const m8 = await page.evaluate(() => ({
      privacyLinked: !!document.querySelector('a[href="/privacy/"]'),
      aggregateGone: !document.body.innerText.includes('may be kept in aggregate'),
    }));
    results.pages[route].m8 = m8;
    if (!m8.privacyLinked || !m8.aggregateGone) console.log('M8 GATE FAIL on', route, JSON.stringify(m8));
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
    if (TRUST_CLUSTER.includes(route)) {
      const i18n = await page.evaluate(() => ({
        htmlLang: document.documentElement.lang,
        alternates: [...document.querySelectorAll('link[rel="alternate"]')].map((l) => l.hreflang + '=' + l.getAttribute('href')),
      }));
      results.pages[route].trustI18n = i18n;
      console.log('TRUST-I18N', route, JSON.stringify(i18n));
    }
    if (route === '/privacy/') {
      await page.setViewport({ width: 1280, height: 900 });
      await page.screenshot({ path: path.join(SHOTS, 'm8-privacy-desktop.png'), fullPage: true });
      await page.setViewport({ width: 390, height: 844 });
      await page.screenshot({ path: path.join(SHOTS, 'm8-privacy-mobile.png'), fullPage: true });
      await page.setViewport({ width: 1280, height: 900 });
    }
    if (route === '/remove-background/') {
      await page.setViewport({ width: 1280, height: 900 });
      await page.screenshot({ path: path.join(SHOTS, 'm8-bg-block-desktop.png') });
    }
    if (route === '/es/que-significa-gratis-aqui/') {
      await page.setViewport({ width: 1280, height: 900 });
      await page.screenshot({ path: path.join(SHOTS, 'm8-es-gratis-desktop.png'), fullPage: true });
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

  // Milestone 19: the per-route tag assertion from the loop above.
  if (gaMissing.length) throw new Error('GA tag gate failed on ' + gaMissing.length + ' route(s): ' + gaMissing.join(' | '));
  console.log('GA GATE: tag + one collect with', GA_ID, 'on every route in the loop');

  // 1b. Check-it-yourself witness: run the witnessed job on a corpus PDF and
  // confirm the page reports zero network requests during the job.
  // Milestone 19 updated form: since the visit counter exists, the
  // witness counts its lines in their own bucket. The assertion is now
  // the printed truth: requests during the job minus the counter's own
  // == 0, requests with anything attached == 0, and the counter's
  // lines are present and labelled in the "loaded when this page
  // opened" list (the gtag program + the collect), so a visitor can
  // tell them apart. The old form asserted a bare "during the job: 0"
  // from a page with no counter on it.
  {
    const { page, errors, failed } = await openPage(BASE + '/check-it-yourself/');
    const input = await page.$('#w-file');
    await input.uploadFile(path.join(CORPUS, 'test-10page.pdf'));
    await page.waitForFunction(() => document.getElementById('w-job-status').textContent.includes('Job done'), { timeout: 60000 });
    const status = await page.$eval('#w-job-status', (el) => el.textContent);
    const verdict = await page.$eval('#w-verdict', (el) => el.textContent);
    const spec = await page.$eval('#w-spec', (el) => el.textContent.replace(/\s+/g, ' '));
    const liveRows = await page.$$eval('#w-live > li', (els) => els.length);
    const beforeCount = await page.$eval('#w-before-count', (el) => el.textContent);
    const beforeRows = await page.$$eval('#w-before > li', (els) => els.map((e) => e.textContent));
    const liveRowTexts = await page.$$eval('#w-live > li', (els) => els.map((e) => e.textContent));
    // The counter's two lines (its program, then its collect) are
    // listed and labelled; which of the two lists each lands in
    // depends on load timing, so they are counted across both.
    const counterRowsLabelled = [...beforeRows, ...liveRowTexts].filter((t) => t.includes('visit counter'));
    const mDuring = /Network requests during the job: (\d+) \(the visit counter's own among them: (\d+)\)/.exec(status);
    const mAttached = /Requests with anything attached to them: (\d+)/.exec(verdict);
    const duringTotal = mDuring ? parseInt(mDuring[1], 10) : -1;
    const duringCounter = mDuring ? parseInt(mDuring[2], 10) : -1;
    const withBody = mAttached ? parseInt(mAttached[1], 10) : -1;
    const witnessOk = !!mDuring && duringTotal - duringCounter === 0 && withBody === 0
      && counterRowsLabelled.length >= 2 && beforeCount.includes('visit counter');
    results.tools.witness = {
      status, verdict, spec, liveRows, beforeCount,
      duringTotal, duringCounter, withBody, counterRowsLabelled: counterRowsLabelled.length,
      zeroNonCounterDuringJob: duringTotal - duringCounter === 0, witnessOk,
      consoleErrors: errors, failedRequests: failed,
    };
    console.log('TOOL witness:', status.slice(0, 160), '| live rows', liveRows, '| counter rows labelled:', counterRowsLabelled.length);
    if (!witnessOk || errors.length) throw new Error('witness gate (m19 form) failed: ' + JSON.stringify(results.tools.witness));
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

  // 3e2. Milestone 8 gate: every-page split of a 12-page PDF delivers
  // ONE ZIP holding all 12 pages (plus the per-page rows underneath).
  {
    const { page, errors, failed } = await openPage(BASE + '/split-pdf/');
    const input = await page.$('#sp-file');
    await input.uploadFile(path.join(HERE, 'fixtures', 'split12.pdf'));
    await page.waitForFunction(() => !document.getElementById('sp-run').disabled, { timeout: 30000 });
    await page.$eval('input[name="sp-mode"][value="each"]', (el) => { el.checked = true; el.dispatchEvent(new Event('change')); });
    await page.click('#sp-run');
    await page.waitForFunction(() => {
      const z = document.getElementById('sp-zip');
      return z && !z.classList.contains('hidden') || (z && z.offsetParent !== null);
    }, { timeout: 60000 });
    const rows = await page.$$eval('#sp-links .spec-row', (els) => els.length);
    const zipPath = await saveBlob(page, '#sp-zip', 'm8-split12.zip');
    const entries = await zipEntries(zipPath);
    results.tools.m8SplitZip = {
      rows, zipPath, entryCount: entries.length,
      allPdfs: entries.every((e) => e.name.endsWith('.pdf')),
      consoleErrors: errors, failedRequests: failed,
    };
    console.log('TOOL m8 split-zip: rows', rows, '| zip entries', entries.length);
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

  // 6. Milestone 8 gates: cancel mid-load (single tool and batch),
  // then the batch scale runs whose counts the batch pages print.
  await relaunch();
  chunkDelayMs = 700;
  // 6a. Cancel mid-load on the single background tool, then resume.
  {
    const { page, errors, failed } = await openPage(BASE + '/remove-background/');
    const input = await page.$('#bg-file');
    await input.uploadFile(path.join(CORPUS, 'test-bg-hard.png'));
    await page.waitForFunction(() => !document.getElementById('bg-run').disabled, { timeout: 30000 });
    await page.click('#bg-run');
    await page.waitForFunction(() => {
      const b = document.getElementById('bg-cancel');
      return b && !b.classList.contains('hidden') && b.offsetParent !== null;
    }, { timeout: 30000 });
    await new Promise((r) => setTimeout(r, 2500));
    await page.click('#bg-cancel');
    await page.waitForFunction(() => document.getElementById('bg-status').textContent.startsWith('Loading stopped.'), { timeout: 30000 });
    const midStatus = await page.$eval('#bg-status', (el) => el.textContent);
    const keptMatch = midStatus.match(/(\d+) of (\d+) pieces/);
    const usable = await page.evaluate(() => !document.getElementById('bg-run').disabled
      && document.getElementById('bg-cancel').classList.contains('hidden')
      && getComputedStyle(document.getElementById('bg-cancel')).display === 'none');
    chunkDelayMs = 0;
    await page.click('#bg-run');
    await page.waitForFunction(() => {
      const r = document.getElementById('bg-result');
      return r && !r.classList.contains('hidden');
    }, { timeout: 420000 });
    results.tools.m8CancelSingle = {
      midStatus, keptPieces: keptMatch ? Number(keptMatch[1]) : -1, totalPieces: keptMatch ? Number(keptMatch[2]) : -1,
      usableAfterCancel: usable, resumedToResult: true,
      expectedAborts: 'the cancelled chunk requests appear in failedRequests as ERR_ABORTED, by design',
      consoleErrors: errors, failedRequests: failed,
    };
    console.log('TOOL m8 cancel-single:', midStatus, '| usable:', usable, '| resumed to a result');
    await page.close();
  }

  // 6b. Cancel mid-load on the batch background tool, then resume.
  await relaunch();
  chunkDelayMs = 700;
  {
    const { page, errors, failed } = await openPage(BASE + '/batch-remove-background/');
    const input = await page.$('#bb-file');
    await input.uploadFile(path.join(CORPUS, 'test-bg-hard.png'), path.join(CORPUS, 'test-photo-realistic-large.jpg'));
    await page.waitForFunction(() => !document.getElementById('bb-run').disabled, { timeout: 30000 });
    await page.click('#bb-run');
    await page.waitForFunction(() => {
      const b = document.getElementById('bb-cancel');
      return b && !b.classList.contains('hidden') && b.offsetParent !== null;
    }, { timeout: 30000 });
    await new Promise((r) => setTimeout(r, 2500));
    await page.click('#bb-cancel');
    await page.waitForFunction(() => document.getElementById('bb-status').textContent.startsWith('Loading stopped.'), { timeout: 30000 });
    const midStatus = await page.$eval('#bb-status', (el) => el.textContent);
    const usable = await page.evaluate(() => !document.getElementById('bb-run').disabled
      && document.getElementById('bb-cancel').classList.contains('hidden')
      && getComputedStyle(document.getElementById('bb-cancel')).display === 'none');
    chunkDelayMs = 0;
    await page.click('#bb-run');
    await shown(page, 'bb-result', 900000);
    const entries = await zipEntries(await saveBlob(page, '#bb-zip', 'm8-batch-bg-resumed.zip'));
    const bbRows = await page.$$eval('#bb-rows > div', (ds) => ds.map((d) => d.textContent.replace(/\s+/g, ' ').trim()));
    results.tools.m8CancelBatch = {
      midStatus, usableAfterCancel: usable, resumedToResult: true, zipEntriesAfterResume: entries.length, rowsAfterResume: bbRows,
      expectedAborts: 'the cancelled chunk requests appear in failedRequests as ERR_ABORTED, by design',
      consoleErrors: errors, failedRequests: failed,
    };
    console.log('TOOL m8 cancel-batch:', midStatus, '| usable:', usable, '| resumed, zip entries:', entries.length);
    await page.close();
  }

  // 6c. Batch scale: 100 images through compress and convert, 50 PDFs
  // through merge and compress. The printed claims on the batch pages
  // must equal these run counts; both are asserted here.
  const FIX = path.join(HERE, 'fixtures');
  const img100 = fs.readdirSync(path.join(FIX, 'batch100')).filter((f) => f.endsWith('.jpg')).sort().map((f) => path.join(FIX, 'batch100', f));
  const pdf50 = fs.readdirSync(path.join(FIX, 'batch50pdf')).filter((f) => f.endsWith('.pdf')).sort().map((f) => path.join(FIX, 'batch50pdf', f));
  console.log('M8 batch fixtures:', img100.length, 'images,', pdf50.length, 'PDFs');
  await relaunch();
  {
    const { page, errors, failed } = await openPage(BASE + '/batch-compress-images/');
    const printed = await page.evaluate(() => document.body.innerText.includes('tested with 100 files'));
    const input = await page.$('#bi-file');
    await input.uploadFile(...img100);
    await page.waitForFunction(() => !document.getElementById('bi-run').disabled, { timeout: 60000 });
    await page.click('#bi-run');
    await page.waitForFunction(() => document.querySelectorAll('#bi-rows > div').length === 100, { timeout: 900000 });
    await shown(page, 'bi-result', 60000);
    await page.waitForFunction(() => { const z = document.getElementById('bi-zip'); return z && z.href.startsWith('blob:'); }, { timeout: 120000 });
    const entries = await zipEntries(await saveBlob(page, '#bi-zip', 'm8-batch100-compress.zip'));
    results.tools.m8BatchCompress100 = {
      filesRun: img100.length, rows: 100, zipEntries: entries.length, printedClaimMatches: printed,
      consoleErrors: errors, failedRequests: failed,
    };
    console.log('TOOL m8 batch-compress-100: rows 100 | zip entries', entries.length, '| printed claim:', printed);
    await page.close();
  }
  await relaunch();
  {
    const { page, errors, failed } = await openPage(BASE + '/batch-convert-images/');
    const printed = await page.evaluate(() => document.body.innerText.includes('tested with 100 files'));
    const input = await page.$('#bi-file');
    await input.uploadFile(...img100);
    await page.waitForFunction(() => !document.getElementById('bi-run').disabled, { timeout: 60000 });
    await page.click('#bi-run');
    await page.waitForFunction(() => document.querySelectorAll('#bi-rows > div').length === 100, { timeout: 900000 });
    await shown(page, 'bi-result', 60000);
    await page.waitForFunction(() => { const z = document.getElementById('bi-zip'); return z && z.href.startsWith('blob:'); }, { timeout: 120000 });
    const entries = await zipEntries(await saveBlob(page, '#bi-zip', 'm8-batch100-convert.zip'));
    results.tools.m8BatchConvert100 = {
      filesRun: img100.length, rows: 100, zipEntries: entries.length, printedClaimMatches: printed,
      consoleErrors: errors, failedRequests: failed,
    };
    console.log('TOOL m8 batch-convert-100: rows 100 | zip entries', entries.length, '| printed claim:', printed);
    await page.close();
  }
  await relaunch();
  {
    const { page, errors, failed } = await openPage(BASE + '/batch-merge-pdf/');
    const printed = await page.evaluate(() => document.body.innerText.includes('tested with 50 files'));
    const input = await page.$('#bp-file');
    await input.uploadFile(...pdf50);
    await page.waitForFunction(() => !document.getElementById('bp-run').disabled, { timeout: 60000 });
    await page.click('#bp-run');
    await page.waitForFunction(() => document.querySelectorAll('#bp-rows a').length >= 1, { timeout: 300000 });
    const outPath = await saveBlob(page, '#bp-rows a', 'm8-merged-50.pdf');
    const doc = await PDFDocument.load(fs.readFileSync(outPath));
    results.tools.m8BatchMerge50 = {
      filesRun: pdf50.length, mergedPages: doc.getPageCount(), printedClaimMatches: printed,
      consoleErrors: errors, failedRequests: failed,
    };
    console.log('TOOL m8 batch-merge-50: merged pages', doc.getPageCount(), '| printed claim:', printed);
    await page.close();
  }
  {
    const { page, errors, failed } = await openPage(BASE + '/batch-compress-pdf/');
    const printed = await page.evaluate(() => document.body.innerText.includes('tested with 50 files'));
    const input = await page.$('#bp-file');
    await input.uploadFile(...pdf50);
    await page.waitForFunction(() => !document.getElementById('bp-run').disabled, { timeout: 60000 });
    await page.click('#bp-run');
    await page.waitForFunction(() => document.querySelectorAll('#bp-rows > div').length === 50, { timeout: 900000 });
    await page.waitForFunction(() => { const z = document.getElementById('bp-zip'); return z && z.href.startsWith('blob:'); }, { timeout: 120000 });
    const entries = await zipEntries(await saveBlob(page, '#bp-zip', 'm8-batch50-compress.zip'));
    results.tools.m8BatchCompressPdf50 = {
      filesRun: pdf50.length, rows: 50, zipEntries: entries.length, printedClaimMatches: printed,
      consoleErrors: errors, failedRequests: failed,
    };
    console.log('TOOL m8 batch-compress-pdf-50: rows 50 | zip entries', entries.length, '| printed claim:', printed);
    await page.close();
  }
  // --- milestone 9: weak-crypto bundle assertion (no page needed) ---
  {
    // Our own source must never name the fork's weak-cryptography
    // flag at all; in the built bundle the only "set it true" text
    // allowed is inside the fork's own refusal error message.
    let srcMentions = 0;
    try {
      const out = execFileSync('grep', ['-rn', 'allowWeakCryptography', path.join(HERE, '..', 'src')], { encoding: 'utf8' });
      srcMentions = out.trim() ? out.trim().split('\n').length : 0;
    } catch (e) { srcMentions = 0; }
    const bad = [];
    for (const f of fs.readdirSync(path.join(DIST, '_astro')).filter((x) => x.endsWith('.js'))) {
      const code = fs.readFileSync(path.join(DIST, '_astro', f), 'utf8');
      for (const m of code.matchAll(/allowWeakCryptography\s*[:=]\s*(?:true|!0)/g)) {
        const tail = code.slice(m.index, m.index + 140);
        if (!tail.includes('if you must target a viewer')) bad.push(f + ': ' + tail.slice(0, 80));
      }
    }
    results.tools.m9WeakCrypto = { srcMentions, distEnablementsOutsideForkErrorText: bad };
    if (srcMentions !== 0 || bad.length) throw new Error('m9 weak-crypto assertion failed: ' + JSON.stringify(results.tools.m9WeakCrypto));
    console.log('TOOL m9 weak-crypto: src mentions 0 | dist enablements outside the fork error text:', bad.length);
  }
  await relaunch();
  {
    // PROTECT round trip: corpus file -> page -> AES-256 output.
    // Node side with the fork, browser side with PDF.js (an
    // independent reader): shut without the password, wrong password
    // refused, correct password opens with every page.
    const { page, errors, failed } = await openPage(BASE + '/protect-pdf/');
    const srcPath = path.join(CORPUS, 'test-10page.pdf');
    const srcPages = (await PDFDocument.load(fs.readFileSync(srcPath))).getPageCount();
    const input = await page.$('#pt-file');
    await input.uploadFile(srcPath);
    await page.waitForFunction(() => !document.getElementById('pt-run').disabled, { timeout: 30000 });
    await page.type('#pt-pw1', 'gate-pw-987654');
    await page.type('#pt-pw2', 'gate-pw-987654');
    await page.click('#pt-run');
    await shown(page, 'pt-result', 30000);
    const outPath = await saveBlob(page, '#pt-download', 'm9-protected.pdf');
    const bytes = fs.readFileSync(outPath);
    let noPwRefused = false, wrongRefused = false;
    try { await PDFDocument.load(bytes); } catch (e) { noPwRefused = true; }
    try { await PDFDocument.load(bytes, { password: 'not-the-password' }); } catch (e) { wrongRefused = true; }
    const opened = await PDFDocument.load(bytes, { password: 'gate-pw-987654' });
    const openedPages = opened.getPageCount();
    const pdfjs = await page.evaluate(async (b64) => {
      const bin = atob(b64); const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      const pdfjsLib = await import(/* @vite-ignore */ '/pdfjs/pdf.min.mjs');
      pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.min.mjs';
      const out = {};
      try { await pdfjsLib.getDocument({ data: arr.slice() }).promise; out.noPassword = 'opened'; }
      catch (e) { out.noPassword = e.name; }
      try { await pdfjsLib.getDocument({ data: arr.slice(), password: 'not-the-password' }).promise; out.wrongPassword = 'opened'; }
      catch (e) { out.wrongPassword = e.name; }
      try { const d = await pdfjsLib.getDocument({ data: arr.slice(), password: 'gate-pw-987654' }).promise; out.correctPassword = d.numPages; }
      catch (e) { out.correctPassword = e.name; }
      return out;
    }, bytes.toString('base64'));
    results.tools.m9Protect = { noPwRefused, wrongRefused, openedPages, srcPages, pdfjs, consoleErrors: errors, failedRequests: failed };
    if (!noPwRefused || !wrongRefused || openedPages !== srcPages) throw new Error('m9 protect fork round trip failed: ' + JSON.stringify(results.tools.m9Protect));
    if (pdfjs.noPassword !== 'PasswordException' || pdfjs.wrongPassword !== 'PasswordException' || pdfjs.correctPassword !== srcPages) throw new Error('m9 protect PDF.js round trip failed: ' + JSON.stringify(pdfjs));
    console.log('TOOL m9 protect: PDF.js', JSON.stringify(pdfjs), '| fork: no-pw refused', noPwRefused, '| wrong refused', wrongRefused, '| pages', openedPages);
    await page.screenshot({ path: path.join(SHOTS, 'm9-protect-pdf-desktop.png'), fullPage: true });
    await page.setViewport({ width: 390, height: 844 });
    await new Promise((r) => setTimeout(r, 300));
    await page.screenshot({ path: path.join(SHOTS, 'm9-protect-pdf-mobile.png'), fullPage: true });
    await page.close();
  }
  await relaunch();
  {
    // DECRYPT ROUND TRIP through the visitor flow itself: the file
    // the protect page just made goes through the unlock page, and
    // its text must come back identical to the original's.
    const { page, errors, failed } = await openPage(BASE + '/unlock-pdf/');
    const origText = execFileSync('pdftotext', [path.join(CORPUS, 'test-10page.pdf'), '-'], { encoding: 'utf8' });
    const input = await page.$('#un-file');
    await input.uploadFile(path.join(HERE, 'm9-protected.pdf'));
    await page.waitForFunction(() => !document.getElementById('un-run').disabled, { timeout: 30000 });
    await page.type('#un-pw', 'gate-pw-987654');
    await page.click('#un-run');
    await shown(page, 'un-result', 30000);
    const outPath = await saveBlob(page, '#un-download', 'm9-roundtrip-unlocked.pdf');
    const doc = await PDFDocument.load(fs.readFileSync(outPath));
    const outText = execFileSync('pdftotext', [outPath, '-'], { encoding: 'utf8' });
    results.tools.m9RoundTrip = { pages: doc.getPageCount(), isEncrypted: doc.isEncrypted, textIdentical: outText === origText, consoleErrors: errors, failedRequests: failed };
    if (doc.isEncrypted || outText !== origText) throw new Error('m9 decrypt round trip failed: ' + JSON.stringify(results.tools.m9RoundTrip));
    console.log('TOOL m9 round trip: pages', doc.getPageCount(), '| text identical to original:', outText === origText);
    await page.close();
  }
  await relaunch();
  {
    // UNLOCK gates on the independent bench fixtures (pikepdf-made):
    // AES-256 R6 open password (wrong password refused first, in the
    // open, with no download), then the permissions-only file with
    // the password box left empty.
    const M9C = path.join(HERE, 'fixtures', 'm9', 'corpus');
    const baseText = execFileSync('pdftotext', [path.join(HERE, 'fixtures', 'm9', 'base-text.pdf'), '-'], { encoding: 'utf8' });
    const { page, errors, failed } = await openPage(BASE + '/unlock-pdf/');
    const input = await page.$('#un-file');
    await input.uploadFile(path.join(M9C, 'text__aes-256-r6__open.pdf'));
    await page.waitForFunction(() => !document.getElementById('un-run').disabled, { timeout: 30000 });
    await page.type('#un-pw', 'definitely-wrong');
    await page.click('#un-run');
    await page.waitForFunction(() => document.getElementById('un-status').textContent.includes('did not open the file'), { timeout: 30000 });
    const noDownloadOnWrong = await page.$eval('#un-result', (el) => el.classList.contains('hidden'));
    await page.$eval('#un-pw', (el) => { el.value = ''; });
    await page.type('#un-pw', 'open-pw-123');
    await page.click('#un-run');
    await shown(page, 'un-result', 30000);
    const openOut = await saveBlob(page, '#un-download', 'm9-unlocked-open.pdf');
    const openDoc = await PDFDocument.load(fs.readFileSync(openOut));
    const openText = execFileSync('pdftotext', [openOut, '-'], { encoding: 'utf8' });
    results.tools.m9UnlockOpen = { wrongPasswordRefusedInOpen: noDownloadOnWrong, pages: openDoc.getPageCount(), isEncrypted: openDoc.isEncrypted, textEqualsBase: openText === baseText, consoleErrors: errors, failedRequests: failed };
    if (!noDownloadOnWrong || openDoc.isEncrypted || openText !== baseText) throw new Error('m9 unlock open-kind failed: ' + JSON.stringify(results.tools.m9UnlockOpen));
    console.log('TOOL m9 unlock open-kind: wrong password refused in the open | pages', openDoc.getPageCount(), '| text equals base:', openText === baseText);
    await page.screenshot({ path: path.join(SHOTS, 'm9-unlock-pdf-desktop.png'), fullPage: true });
    await page.setViewport({ width: 390, height: 844 });
    await new Promise((r) => setTimeout(r, 300));
    await page.screenshot({ path: path.join(SHOTS, 'm9-unlock-pdf-mobile.png'), fullPage: true });
    await page.close();
  }
  await relaunch();
  {
    const M9C = path.join(HERE, 'fixtures', 'm9', 'corpus');
    const baseText = execFileSync('pdftotext', [path.join(HERE, 'fixtures', 'm9', 'base-text.pdf'), '-'], { encoding: 'utf8' });
    const { page, errors, failed } = await openPage(BASE + '/unlock-pdf/');
    const input = await page.$('#un-file');
    await input.uploadFile(path.join(M9C, 'text__aes-256-r6__owner-only.pdf'));
    await page.waitForFunction(() => !document.getElementById('un-run').disabled, { timeout: 30000 });
    const specSaysPermissions = await page.$eval('#un-spec', (el) => el.textContent.includes('switches are off'));
    await page.click('#un-run');
    await shown(page, 'un-result', 30000);
    const ownOut = await saveBlob(page, '#un-download', 'm9-unlocked-owner.pdf');
    const ownDoc = await PDFDocument.load(fs.readFileSync(ownOut));
    const ownText = execFileSync('pdftotext', [ownOut, '-'], { encoding: 'utf8' });
    results.tools.m9UnlockOwnerOnly = { specSaysPermissions, pages: ownDoc.getPageCount(), isEncrypted: ownDoc.isEncrypted, textEqualsBase: ownText === baseText, consoleErrors: errors, failedRequests: failed };
    if (!specSaysPermissions || ownDoc.isEncrypted || ownText !== baseText) throw new Error('m9 unlock owner-only failed: ' + JSON.stringify(results.tools.m9UnlockOwnerOnly));
    console.log('TOOL m9 unlock owner-only: classified as permission switches | pages', ownDoc.getPageCount(), '| text equals base:', ownText === baseText);
    await page.close();
  }
  await relaunch();
  {
    // --- milestone 10: photo OCR gates ---
    // (a) the clean 300-DPI fixture reads at >= 95% character accuracy
    // against its known string; (c) after a hand edit in the box, Copy
    // and the .txt download both carry the shown text byte-for-byte;
    // (b) the rough small fixture exercises the printed small-picture
    // path (tip in the status and the spec's enlarge line, before the
    // run) and reads better than the benched as-picked score (94.3%);
    // the Spanish and Portuguese options read their fixtures. The
    // pages loop above covers (d) zero console errors on the route.
    const M10 = path.join(HERE, 'fixtures', 'm10');
    const ocrPdfHtml = fs.readFileSync(path.join(DIST, 'ocr-pdf', 'index.html'), 'utf8');
    const ocrImgHtml = fs.readFileSync(path.join(DIST, 'ocr-image', 'index.html'), 'utf8');
    const crossLinks = { pdfPointsToImage: ocrPdfHtml.includes('href="/ocr-image/"'), imagePointsToPdf: ocrImgHtml.includes('href="/ocr-pdf/"') };
    if (!crossLinks.pdfPointsToImage || !crossLinks.imagePointsToPdf) throw new Error('m10 cross-links failed: ' + JSON.stringify(crossLinks));
    try { await browser.defaultBrowserContext().overridePermissions(BASE, ['clipboard-read', 'clipboard-write', 'clipboard-sanitized-write']); } catch (e) { /* copy gate reports what it gets */ }
    const { page, errors, failed } = await openPage(BASE + '/ocr-image/');
    const input = await page.$('#oi-file');
    await input.uploadFile(path.join(M10, 'fixture-big.png'));
    await page.waitForFunction(() => !document.getElementById('oi-run').disabled, { timeout: 30000 });
    await page.click('#oi-run');
    await shown(page, 'oi-result', 420000);
    const bigText = await page.$eval('#oi-text', (el) => el.value);
    const bigAcc = charAccuracy(bigText, BIG_TEXT);
    // (c) edit the box by hand, then copy and download must match it.
    await page.$eval('#oi-text', (el) => { el.value = el.value + '\nChecked by hand: the total is confirmed.'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    const shownText = await page.$eval('#oi-text', (el) => el.value);
    await page.click('#oi-copy');
    await page.waitForFunction(() => document.getElementById('oi-status').textContent.includes('Copied'), { timeout: 30000 });
    const clipboard = await page.evaluate(async () => { try { return await navigator.clipboard.readText(); } catch (e) { return 'CLIPBOARD READ FAILED: ' + e.message; } });
    const dlDir = path.join(HERE, 'downloads', 'm10');
    fs.mkdirSync(dlDir, { recursive: true });
    for (const n of fs.readdirSync(dlDir)) fs.rmSync(path.join(dlDir, n));
    const client = await page.createCDPSession();
    await client.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dlDir });
    await page.click('#oi-download-txt');
    let dlBytes = null;
    for (let i = 0; i < 30 && !dlBytes; i++) {
      await new Promise((r) => setTimeout(r, 500));
      const names = fs.readdirSync(dlDir).filter((n) => n.endsWith('.txt') && !n.endsWith('.crdownload'));
      if (names.length) dlBytes = fs.readFileSync(path.join(dlDir, names[0]));
    }
    const copyExact = clipboard === shownText;
    const downloadExact = !!dlBytes && dlBytes.equals(Buffer.from(shownText, 'utf8'));
    results.tools.m10Big = { accuracy: Number(bigAcc.toFixed(4)), copyExact, downloadExact, crossLinks, consoleErrors: errors, failedRequests: failed };
    if (bigAcc < 0.95) throw new Error('m10 big-fixture accuracy below 95%: ' + bigAcc);
    if (!copyExact || !downloadExact) throw new Error('m10 copy/download not byte-exact: ' + JSON.stringify(results.tools.m10Big));
    console.log('TOOL m10 photo OCR (big): accuracy', bigAcc.toFixed(4), '| copy byte-exact:', copyExact, '| download byte-exact:', downloadExact);
    await page.screenshot({ path: path.join(SHOTS, 'm10-ocr-image-desktop.png'), fullPage: true });
    await page.setViewport({ width: 390, height: 844 });
    await new Promise((r) => setTimeout(r, 300));
    await page.screenshot({ path: path.join(SHOTS, 'm10-ocr-image-mobile.png'), fullPage: true });
    await page.setViewport({ width: 1280, height: 900 });
    // (b) the rough small fixture: the tip path, exercised before the run.
    await input.uploadFile(path.join(M10, 'fixture-degraded-hard.jpg'));
    await page.waitForFunction(() => !document.getElementById('oi-run').disabled, { timeout: 30000 });
    const tipStatus = await page.$eval('#oi-status', (el) => el.textContent);
    const tipSpec = await page.$eval('#oi-spec', (el) => el.textContent);
    const tipShown = tipStatus.includes('enlarged before reading') && tipSpec.includes('enlarged 3x before reading');
    await page.click('#oi-run');
    await shown(page, 'oi-result', 420000);
    const smallText = await page.$eval('#oi-text', (el) => el.value);
    const smallAcc = charAccuracy(smallText, BIG_TEXT);
    results.tools.m10Small = { tipShown, accuracy: Number(smallAcc.toFixed(4)), nativeBenchAccuracy: 0.9428, consoleErrors: errors, failedRequests: failed };
    if (!tipShown) throw new Error('m10 small-picture tip path not exercised: ' + JSON.stringify({ tipStatus, tipSpec }));
    if (smallAcc < 0.97) throw new Error('m10 small-fixture accuracy below 97%: ' + smallAcc);
    console.log('TOOL m10 photo OCR (rough small): tip shown:', tipShown, '| accuracy', smallAcc.toFixed(4), '(as-picked bench: 0.9428)');
    // Language options: the Spanish and Portuguese fixtures.
    await input.uploadFile(path.join(M10, 'fixture-es.png'));
    await page.waitForFunction(() => !document.getElementById('oi-run').disabled, { timeout: 30000 });
    await page.select('#oi-lang', 'spa');
    await page.click('#oi-run');
    await shown(page, 'oi-result', 420000);
    const esText = await page.$eval('#oi-text', (el) => el.value);
    const esOk = esText.toLowerCase().includes('factura') && esText.toLowerCase().includes('gracias');
    await input.uploadFile(path.join(M10, 'fixture-pt.png'));
    await page.waitForFunction(() => !document.getElementById('oi-run').disabled, { timeout: 30000 });
    await page.select('#oi-lang', 'por');
    await page.click('#oi-run');
    await shown(page, 'oi-result', 420000);
    const ptText = await page.$eval('#oi-text', (el) => el.value);
    const ptOk = ptText.toLowerCase().includes('fatura') && ptText.toLowerCase().includes('obrigado');
    results.tools.m10Languages = { esOk, esAccuracy: Number(charAccuracy(esText, ES_TEXT).toFixed(4)), ptOk, ptAccuracy: Number(charAccuracy(ptText, PT_TEXT).toFixed(4)), consoleErrors: errors, failedRequests: failed };
    if (!esOk || !ptOk) throw new Error('m10 language gates failed: ' + JSON.stringify(results.tools.m10Languages));
    console.log('TOOL m10 languages: ES accuracy', results.tools.m10Languages.esAccuracy, '| PT accuracy', results.tools.m10Languages.ptAccuracy);
    await page.close();
  }

  // 7. Milestone 11: resize image (exact dimensions in every mode),
  // the PNG -> JPG flatten gate (the picked background must be the
  // corner pixel of the output), the six convert pair doors (the
  // output's format signature must match the door's promise), and
  // batch resize at the printed number (50 files, ZIP count equal).
  const M11 = path.join(HERE, 'fixtures', 'm11');
  const setVal = (page, sel, v) => page.$eval(sel, (el, val) => {
    el.value = val;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, v);
  {
    const { page, errors, failed } = await openPage(BASE + '/resize-image/');
    const input = await page.$('#ri-file');
    await input.uploadFile(path.join(CORPUS, 'test-large-photo.jpg')); // 4000x3000
    await page.waitForFunction(() => !document.getElementById('ri-run').disabled, { timeout: 30000 });
    const outDims = () => page.evaluate(async () => {
      const a = document.querySelector('#ri-result a[download]');
      const blob = await (await fetch(a.href)).blob();
      const bmp = await createImageBitmap(blob);
      return { w: bmp.width, h: bmp.height, bytes: blob.size, type: blob.type };
    });
    // A finished run is a NEW blob URL on the download link (the
    // percent case lands on the same dimensions as the width-only
    // case, so the receipt text alone cannot prove freshness).
    let lastHref = '';
    const runAndWait = async () => {
      await page.click('#ri-run');
      await page.waitForFunction((h) => {
        const a = document.querySelector('#ri-result a[download]');
        return !!a && !!a.href && a.href !== h && !document.getElementById('ri-result').classList.contains('hidden');
      }, { timeout: 300000 }, lastHref);
      lastHref = await page.evaluate(() => document.querySelector('#ri-result a[download]').href);
      return outDims();
    };
    // Locked, width only: 1000 wide, height follows the shape.
    await setVal(page, '#ri-width', '1000');
    const d1 = await runAndWait();
    // Locked, height only: 600 high, width follows.
    await setVal(page, '#ri-width', '');
    await setVal(page, '#ri-height', '600');
    const d2 = await runAndWait();
    // Percent mode: 25% of 4000x3000.
    await page.click('#ri-modes [data-mode="percent"]');
    await setVal(page, '#ri-percent', '25');
    const d3 = await runAndWait();
    // Lock off, both sides typed: exact stretch to the frame.
    await page.click('#ri-modes [data-mode="pixels"]');
    await page.click('#ri-lock');
    await setVal(page, '#ri-width', '1000');
    await setVal(page, '#ri-height', '1000');
    const d4 = await runAndWait();
    const ok = d1.w === 1000 && d1.h === 750 && d2.w === 800 && d2.h === 600
      && d3.w === 1000 && d3.h === 750 && d4.w === 1000 && d4.h === 1000;
    results.tools.m11Resize = { lockedWidthOnly: d1, lockedHeightOnly: d2, percent25: d3, exactFrame: d4, exactDimsOk: ok, consoleErrors: errors, failedRequests: failed };
    console.log('TOOL m11 resize:', JSON.stringify({ d1, d2, d3, d4 }));
    if (!ok) throw new Error('m11 resize dimension gates failed');
    await page.setViewport({ width: 1280, height: 900 });
    await page.screenshot({ path: path.join(SHOTS, 'm11-resize-image-desktop.png'), fullPage: true });
    await page.setViewport({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(SHOTS, 'm11-resize-image-mobile.png'), fullPage: true });
    await page.close();
  }
  {
    // PNG -> JPG: the transparent corners of the fixture must come
    // out painted with the background colour picked at the tray.
    const { page, errors, failed } = await openPage(BASE + '/png-to-jpg/');
    const input = await page.$('#cv-file');
    await input.uploadFile(path.join(M11, 'alpha.png'));
    await page.waitForFunction(() => !document.getElementById('cv-run').disabled, { timeout: 30000 });
    await setVal(page, '#cv-bg', '#336699');
    await page.click('#cv-run');
    await shown(page, 'cv-result', 300000);
    const px = await page.evaluate(async () => {
      const a = document.querySelector('#cv-result a[download]');
      const blob = await (await fetch(a.href)).blob();
      const bmp = await createImageBitmap(blob);
      const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
      const ctx = c.getContext('2d'); ctx.drawImage(bmp, 0, 0);
      return {
        corner: Array.from(ctx.getImageData(2, 2, 1, 1).data),
        center: Array.from(ctx.getImageData(60, 45, 1, 1).data),
        w: bmp.width, h: bmp.height, type: blob.type,
      };
    });
    const near = (pxv, hex) => Math.abs(pxv[0] - hex[0]) <= 10 && Math.abs(pxv[1] - hex[1]) <= 10 && Math.abs(pxv[2] - hex[2]) <= 10;
    const flatOk = near(px.corner, [0x33, 0x66, 0x99]);
    const centerOk = near(px.center, [224, 49, 49]);
    const shapeOk = px.w === 120 && px.h === 90 && px.type === 'image/jpeg';
    results.tools.m11Flatten = { px, flatOk, centerOk, shapeOk, consoleErrors: errors, failedRequests: failed };
    console.log('TOOL m11 png-to-jpg flatten:', JSON.stringify(px), '| flat:', flatOk, '| center:', centerOk);
    if (!flatOk || !centerOk || !shapeOk) throw new Error('m11 flatten gate failed');
    await page.setViewport({ width: 1280, height: 900 });
    await page.screenshot({ path: path.join(SHOTS, 'm11-png-to-jpg-desktop.png'), fullPage: true });
    await page.setViewport({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(SHOTS, 'm11-png-to-jpg-mobile.png'), fullPage: true });
    await page.close();
  }
  {
    // The other five pair doors: convert the fixture and check the
    // output's magic bytes against the door's promise. (PNG -> JPG
    // is covered by the flatten gate above.)
    const doors = [
      { route: '/jpg-to-png/', fixture: 'photo.jpg', kind: 'png' },
      { route: '/webp-to-jpg/', fixture: 'photo.webp', kind: 'jpg' },
      { route: '/jpg-to-webp/', fixture: 'photo.jpg', kind: 'webp' },
      { route: '/png-to-webp/', fixture: 'opaque.png', kind: 'webp' },
      { route: '/webp-to-png/', fixture: 'photo.webp', kind: 'png' },
    ];
    const sigOk = (s, kind) => kind === 'jpg' ? (s[0] === 0xff && s[1] === 0xd8 && s[2] === 0xff)
      : kind === 'png' ? (s[0] === 0x89 && s[1] === 0x50 && s[2] === 0x4e && s[3] === 0x47)
      : (String.fromCharCode(...s.slice(0, 4)) === 'RIFF' && String.fromCharCode(...s.slice(8, 12)) === 'WEBP');
    results.tools.m11Doors = {};
    for (const door of doors) {
      const { page, errors, failed } = await openPage(BASE + door.route);
      const input = await page.$('#cv-file');
      await input.uploadFile(path.join(M11, door.fixture));
      await page.waitForFunction(() => !document.getElementById('cv-run').disabled, { timeout: 30000 });
      await page.click('#cv-run');
      await shown(page, 'cv-result', 300000);
      const sig = await page.evaluate(async () => {
        const a = document.querySelector('#cv-result a[download]');
        const buf = new Uint8Array(await (await fetch(a.href)).arrayBuffer());
        return Array.from(buf.slice(0, 12));
      });
      const okSig = sigOk(sig, door.kind);
      results.tools.m11Doors[door.route] = { fixture: door.fixture, sig, signatureOk: okSig, consoleErrors: errors, failedRequests: failed };
      console.log('TOOL m11 door', door.route, 'sig', sig.slice(0, 4).join(','), '| ok:', okSig, '| errors:', errors.length);
      if (!okSig) throw new Error('m11 door signature gate failed on ' + door.route);
      if (errors.length) throw new Error('m11 door console errors on ' + door.route + ': ' + errors.join(' | '));
      await page.close();
    }
  }
  await relaunch();
  {
    // Batch resize at the printed number: 50 images to a 320 px
    // width, one ZIP out, ZIP entries == rows == printed claim.
    const fifty = img100.slice(0, 50);
    const { page, errors, failed } = await openPage(BASE + '/batch-resize-images/');
    const printed = await page.evaluate(() => document.body.innerText.includes('tested with 50 files'));
    const input = await page.$('#bi-file');
    await input.uploadFile(...fifty);
    await page.waitForFunction(() => !document.getElementById('bi-run').disabled, { timeout: 60000 });
    await setVal(page, '#bi-width', '320');
    await page.click('#bi-run');
    await page.waitForFunction(() => document.querySelectorAll('#bi-rows > div').length === 50, { timeout: 900000 });
    await shown(page, 'bi-result', 60000);
    await page.waitForFunction(() => { const z = document.getElementById('bi-zip'); return z && z.href.startsWith('blob:'); }, { timeout: 120000 });
    const firstRow = await page.$eval('#bi-rows > div', (el) => el.textContent.replace(/\s+/g, ' ').trim());
    const entries = await zipEntries(await saveBlob(page, '#bi-zip', 'm11-batch50-resize.zip'));
    const widthOk = firstRow.includes('to 320x');
    results.tools.m11BatchResize50 = {
      filesRun: fifty.length, rows: 50, zipEntries: entries.length, printedClaimMatches: printed,
      firstRow, firstRowWidth320: widthOk, consoleErrors: errors, failedRequests: failed,
    };
    console.log('TOOL m11 batch-resize-50: rows 50 | zip entries', entries.length, '| printed claim:', printed, '| first row:', firstRow.slice(0, 110));
    if (entries.length !== 50 || !printed || !widthOk) throw new Error('m11 batch resize gate failed');
    await page.close();
  }
  await relaunch();
  // 8. Milestone 12: the PDF extras. Rotate asserts the finished
  // file's own rotation values AND the rendered size swap through
  // PDF.js; page numbers assert the stamped words in extraction, on
  // the stamped pages and nowhere else; watermark asserts the words
  // extract and that the strength setting changes the rendered page;
  // extract replays the bench in the browser (JPEG byte identity,
  // PNG pixel equality) plus the named-skip report on the weird
  // fixture. Fixtures: verify/fixtures/m12 (m12-make-fixtures.mjs).
  const M12 = path.join(HERE, 'fixtures', 'm12');
  const sharp = (await import('sharp')).default;
  const pageText = (pdf, n) => execFileSync('pdftotext', ['-f', String(n), '-l', String(n), pdf, '-'], { encoding: 'utf8' });
  // Diagonal text needs -raw: layout mode sorts rotated glyphs by
  // position and scrambles a rotated stamp into single letters.
  // -raw keeps stream order but still breaks the line mid-stamp, so
  // the watermark assertions squash all whitespace out first.
  const pageTextRaw = (pdf, n) => execFileSync('pdftotext', ['-raw', '-f', String(n), '-l', String(n), pdf, '-'], { encoding: 'utf8' });
  const squash = (s) => s.replace(/\s+/g, '');
  async function rawRgba(file) {
    const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return { data, width: info.width, height: info.height };
  }
  {
    // (a) rotate: all pages 90°, then a 2–3 range on a fresh copy.
    const srcPath = path.join(CORPUS, 'test-10page.pdf');
    const srcDoc = await PDFDocument.load(fs.readFileSync(srcPath));
    const srcRot = srcDoc.getPage(0).getRotation().angle;
    const { page, errors, failed } = await openPage(BASE + '/rotate-pdf/');
    const input = await page.$('#rt-file');
    await input.uploadFile(srcPath);
    await page.waitForFunction(() => !document.getElementById('rt-run').disabled, { timeout: 30000 });
    await page.click('#rt-run');
    await shown(page, 'rt-result', 60000);
    const outPath = await saveBlob(page, '#rt-download', 'm12-rotated.pdf');
    const outDoc = await PDFDocument.load(fs.readFileSync(outPath));
    const angles = outDoc.getPages().map((p) => p.getRotation().angle);
    const all90 = angles.length === 10 && angles.every((a) => a === (srcRot + 90) % 360);
    const swap = await page.evaluate(async (pair) => {
      const load = async (b64) => {
        const bin = atob(b64); const arr = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        return arr;
      };
      const pdfjsLib = await import(/* @vite-ignore */ '/pdfjs/pdf.min.mjs');
      pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.min.mjs';
      const dims = {};
      for (const [key, b64] of Object.entries(pair)) {
        const doc = await pdfjsLib.getDocument({ data: await load(b64) }).promise;
        const pg = await doc.getPage(1);
        const vp = pg.getViewport({ scale: 1 });
        dims[key] = { w: Math.round(vp.width), h: Math.round(vp.height) };
      }
      return dims;
    }, { orig: fs.readFileSync(srcPath).toString('base64'), out: fs.readFileSync(outPath).toString('base64') });
    const swapped = swap.out.w === swap.orig.h && swap.out.h === swap.orig.w && swap.orig.w !== swap.orig.h;
    results.tools.m12Rotate = { angles, all90, swap, swapped, consoleErrors: errors, failedRequests: failed };
    console.log('TOOL m12 rotate: angles', [...new Set(angles)].join(','), '| render swap', JSON.stringify(swap), '| swapped:', swapped);
    if (!all90 || !swapped || errors.length) throw new Error('m12 rotate gate failed: ' + JSON.stringify(results.tools.m12Rotate));
    await page.close();

    const r2 = await openPage(BASE + '/rotate-pdf/');
    const input2 = await r2.page.$('#rt-file');
    await input2.uploadFile(srcPath);
    await r2.page.waitForFunction(() => !document.getElementById('rt-run').disabled, { timeout: 30000 });
    await r2.page.$eval('input[name="rt-scope"][value="range"]', (el) => { el.checked = true; });
    await r2.page.$eval('#rt-from', (el) => { el.value = '2'; });
    await r2.page.$eval('#rt-to', (el) => { el.value = '3'; });
    await r2.page.click('#rt-run');
    await shown(r2.page, 'rt-result', 60000);
    const rangePath = await saveBlob(r2.page, '#rt-download', 'm12-rotated-range.pdf');
    const rangeDoc = await PDFDocument.load(fs.readFileSync(rangePath));
    const rAngles = rangeDoc.getPages().map((p) => p.getRotation().angle);
    const rangeOk = rAngles[0] === srcRot && rAngles[1] === (srcRot + 90) % 360 && rAngles[2] === (srcRot + 90) % 360 && rAngles[3] === srcRot && rAngles.every((a, i) => a === (i === 1 || i === 2 ? (srcRot + 90) % 360 : srcRot));
    results.tools.m12RotateRange = { angles: rAngles, rangeOk, consoleErrors: r2.errors, failedRequests: r2.failed };
    console.log('TOOL m12 rotate range: angles', rAngles.join(','), '| range only:', rangeOk);
    if (!rangeOk || r2.errors.length) throw new Error('m12 rotate range gate failed');
    await r2.page.close();
  }
  await relaunch();
  {
    // (b) page numbers: the fixture's pages carry no words of their
    // own, so any "Page X of Y" in extraction is the stamp's.
    const srcPath = path.join(M12, 'images.pdf');
    const { page, errors, failed } = await openPage(BASE + '/pdf-page-numbers/');
    const input = await page.$('#pn-file');
    await input.uploadFile(srcPath);
    await page.waitForFunction(() => !document.getElementById('pn-run').disabled, { timeout: 30000 });
    await page.click('#pn-run');
    await shown(page, 'pn-result', 60000);
    const outPath = await saveBlob(page, '#pn-download', 'm12-numbered.pdf');
    const texts = [1, 2, 3, 4, 5].map((n) => pageText(outPath, n));
    const allStamped = texts.every((t, i) => t.includes('Page ' + (i + 1) + ' of 5'));
    results.tools.m12PageNumbers = { allStamped, sample: texts[0].trim().slice(0, 60), consoleErrors: errors, failedRequests: failed };
    console.log('TOOL m12 page numbers: every page stamped:', allStamped, '| page 1 text:', JSON.stringify(texts[0].trim().slice(0, 60)));
    if (!allStamped || errors.length) throw new Error('m12 page numbers gate failed');
    await page.close();

    const r2 = await openPage(BASE + '/pdf-page-numbers/');
    const input2 = await r2.page.$('#pn-file');
    await input2.uploadFile(srcPath);
    await r2.page.waitForFunction(() => !document.getElementById('pn-run').disabled, { timeout: 30000 });
    await r2.page.$eval('input[name="pn-scope"][value="range"]', (el) => { el.checked = true; });
    await r2.page.$eval('#pn-from', (el) => { el.value = '2'; });
    await r2.page.$eval('#pn-to', (el) => { el.value = '3'; });
    await r2.page.$eval('#pn-start', (el) => { el.value = '5'; });
    await r2.page.click('#pn-run');
    await shown(r2.page, 'pn-result', 60000);
    const rangePath = await saveBlob(r2.page, '#pn-download', 'm12-numbered-range.pdf');
    const rt = [1, 2, 3, 4, 5].map((n) => pageText(rangePath, n));
    const rangeOk = !rt[0].includes('Page ') && rt[1].includes('Page 5 of 6') && rt[2].includes('Page 6 of 6') && !rt[3].includes('Page ') && !rt[4].includes('Page ');
    results.tools.m12PageNumbersRange = { rangeOk, stamped: [rt[1].trim().slice(0, 40), rt[2].trim().slice(0, 40)], consoleErrors: r2.errors, failedRequests: r2.failed };
    console.log('TOOL m12 page numbers range: 2–3 only, from 5:', rangeOk, '| page 2:', JSON.stringify(rt[1].trim().slice(0, 40)), '| page 4 clean:', !rt[3].includes('Page '));
    if (!rangeOk || r2.errors.length) throw new Error('m12 page numbers range gate failed');
    await r2.page.close();
  }
  await relaunch();
  {
    // (c) watermark: words extract from stamped pages only, and the
    // strength setting measurably changes the rendered page.
    const srcPath = path.join(M12, 'images.pdf');
    async function wmRun(opacityValue, scopeRange) {
      const { page, errors, failed } = await openPage(BASE + '/watermark-pdf/');
      const input = await page.$('#wm-file');
      await input.uploadFile(srcPath);
      await page.waitForFunction(() => !document.getElementById('wm-run').disabled, { timeout: 30000 });
      await page.$eval('#wm-text', (el) => { el.value = 'GATE-STAMP-7'; });
      await page.$eval('input[name="wm-opacity"][value="' + opacityValue + '"]', (el) => { el.checked = true; });
      if (scopeRange) {
        await page.$eval('input[name="wm-scope"][value="range"]', (el) => { el.checked = true; });
        await page.$eval('#wm-from', (el) => { el.value = '2'; });
        await page.$eval('#wm-to', (el) => { el.value = '3'; });
      }
      await page.click('#wm-run');
      await shown(page, 'wm-result', 60000);
      const out = await saveBlob(page, '#wm-download', 'm12-wm-' + opacityValue + (scopeRange ? '-range' : '') + '.pdf');
      return { page, errors, failed, out };
    }
    const light = await wmRun('0.15', false);
    const lt = [1, 2, 3, 4, 5].map((n) => squash(pageTextRaw(light.out, n)));
    const wordsEverywhere = lt.every((t) => t.includes('GATE-STAMP-7'));
    const strong = await wmRun('0.5', false);
    // Render-diff: page 1 of both runs through PDF.js; count the
    // pixels the strength change actually moves.
    const diff = await strong.page.evaluate(async (pair) => {
      const load = async (b64) => {
        const bin = atob(b64); const arr = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        return arr;
      };
      const pdfjsLib = await import(/* @vite-ignore */ '/pdfjs/pdf.min.mjs');
      pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.min.mjs';
      async function render(b64) {
        const doc = await pdfjsLib.getDocument({ data: await load(b64) }).promise;
        const pg = await doc.getPage(1);
        const vp = pg.getViewport({ scale: 1 });
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(vp.width); canvas.height = Math.round(vp.height);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
        await pg.render({ canvasContext: ctx, viewport: vp }).promise;
        return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      }
      const a = await render(pair.light), b = await render(pair.strong);
      let moved = 0;
      for (let i = 0; i < a.length; i += 4) {
        if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 60) moved++;
      }
      return { pixels: a.length / 4, moved };
    }, { light: fs.readFileSync(light.out).toString('base64'), strong: fs.readFileSync(strong.out).toString('base64') });
    await light.page.screenshot({ path: path.join(SHOTS, 'm12-watermark-pdf-desktop.png'), fullPage: true });
    await light.page.setViewport({ width: 390, height: 844 });
    await new Promise((r) => setTimeout(r, 300));
    await light.page.screenshot({ path: path.join(SHOTS, 'm12-watermark-pdf-mobile.png'), fullPage: true });
    await light.page.close();
    await strong.page.close();
    const ranged = await wmRun('0.3', true);
    const rt = [1, 2, 3, 4, 5].map((n) => squash(pageTextRaw(ranged.out, n)));
    const rangeOk = !rt[0].includes('GATE-STAMP-7') && rt[1].includes('GATE-STAMP-7') && rt[2].includes('GATE-STAMP-7') && !rt[3].includes('GATE-STAMP-7') && !rt[4].includes('GATE-STAMP-7');
    await ranged.page.close();
    results.tools.m12Watermark = { wordsEverywhere, renderDiff: diff, rangeOk, consoleErrors: [...light.errors, ...strong.errors, ...ranged.errors], failedRequests: [...light.failed, ...strong.failed, ...ranged.failed] };
    console.log('TOOL m12 watermark: words on all pages:', wordsEverywhere, '| strength render-diff moved pixels:', diff.moved, 'of', diff.pixels, '| range only:', rangeOk);
    if (!wordsEverywhere || diff.moved < 500 || !rangeOk || results.tools.m12Watermark.consoleErrors.length) throw new Error('m12 watermark gate failed: ' + JSON.stringify(results.tools.m12Watermark));
  }
  await relaunch();
  {
    // (d) extract: the bench replayed through the real pages.
    const M11F = path.join(HERE, 'fixtures', 'm11');
    const { page, errors, failed } = await openPage(BASE + '/extract-images-pdf/');
    const input = await page.$('#ex-file');
    await input.uploadFile(path.join(M12, 'images.pdf'));
    await page.waitForFunction(() => !document.getElementById('ex-run').disabled, { timeout: 30000 });
    await page.click('#ex-run');
    await shown(page, 'ex-result', 120000);
    const zipPath = await saveBlob(page, '#ex-download', 'm12-extract-images.zip');
    const entries = await zipEntries(zipPath);
    const zip = await JSZip.loadAsync(fs.readFileSync(zipPath));
    const jpgEntry = entries.find((e) => e.name.endsWith('.jpg'));
    const jpgBytes = await zip.file(jpgEntry.name).async('uint8array');
    const jpgIdentical = Buffer.from(jpgBytes).equals(fs.readFileSync(path.join(M11F, 'photo.jpg')));
    let alphaEqual = false, opaqueEqual = false;
    for (const [entryName, srcName, set] of [['page-2-image-2.png', 'alpha.png', 'a'], ['page-3-image-3.png', 'opaque.png', 'o']]) {
      const f = zip.file(entryName);
      if (!f) continue;
      const got = await rawRgba(Buffer.from(await f.async('uint8array')));
      const want = await rawRgba(fs.readFileSync(path.join(M11F, srcName)));
      const eq = got.width === want.width && got.height === want.height && Buffer.from(got.data).equals(Buffer.from(want.data));
      if (set === 'a') alphaEqual = eq; else opaqueEqual = eq;
    }
    const report = await page.$eval('#ex-report', (el) => el.textContent);
    const achieved = await page.$eval('#ex-achieved', (el) => el.textContent);
    const vectorLine = report.includes('Page 4 — no stored pictures on this page.');
    const specText = await page.$eval('#ex-spec', (el) => el.textContent.replace(/\s+/g, ' '));
    results.tools.m12Extract = {
      zipEntries: entries.map((e) => e.name), jpgIdentical, alphaEqual, opaqueEqual, vectorLine,
      reportSample: report.slice(0, 300), specText, consoleErrors: errors, failedRequests: failed,
    };
    console.log('TOOL m12 extract: entries', entries.map((e) => e.name).join(','), '| jpg identical:', jpgIdentical, '| alpha equal:', alphaEqual, '| opaque equal:', opaqueEqual, '| vector page line:', vectorLine, '| achieved:', achieved.slice(0, 120));
    if (entries.length !== 3 || !jpgIdentical || !alphaEqual || !opaqueEqual || !vectorLine || errors.length) throw new Error('m12 extract gate failed: ' + JSON.stringify(results.tools.m12Extract));
    await page.screenshot({ path: path.join(SHOTS, 'm12-extract-images-pdf-desktop.png'), fullPage: true });
    await page.setViewport({ width: 390, height: 844 });
    await new Promise((r) => setTimeout(r, 300));
    await page.screenshot({ path: path.join(SHOTS, 'm12-extract-images-pdf-mobile.png'), fullPage: true });
    await page.close();

    const w2 = await openPage(BASE + '/extract-images-pdf/');
    const input2 = await w2.page.$('#ex-file');
    await input2.uploadFile(path.join(M12, 'weird.pdf'));
    await w2.page.waitForFunction(() => !document.getElementById('ex-run').disabled, { timeout: 30000 });
    await w2.page.click('#ex-run');
    await shown(w2.page, 'ex-result', 120000);
    const wEntries = await zipEntries(await saveBlob(w2.page, '#ex-download', 'm12-extract-weird.zip'));
    const wReport = await w2.page.$eval('#ex-report', (el) => el.textContent);
    const named = wReport.includes('JPEG 2000') && wReport.includes('fax-encoded') && wReport.includes('NOT pulled');
    const expected = JSON.parse(fs.readFileSync(path.join(M12, 'expected.json'), 'utf8'));
    const wzip = await JSZip.loadAsync(fs.readFileSync(path.join(HERE, 'm12-extract-weird.zip')));
    const grayFile = wEntries.find((e) => e.name.includes('image-1'));
    const gray = await rawRgba(Buffer.from(await wzip.file(grayFile.name).async('uint8array')));
    const grayVals = [...gray.data].filter((_, i) => i % 4 === 0).join(',');
    const grayOk = grayVals === expected.gray.join(',');
    results.tools.m12ExtractWeird = { entries: wEntries.map((e) => e.name), namedSkips: named, grayOk, reportSample: wReport.slice(0, 400), consoleErrors: w2.errors, failedRequests: w2.failed };
    console.log('TOOL m12 extract weird: entries', wEntries.map((e) => e.name).join(','), '| skips named:', named, '| gray pixels right:', grayOk);
    if (wEntries.length !== 4 || !named || !grayOk || w2.errors.length) throw new Error('m12 extract weird gate failed: ' + JSON.stringify(results.tools.m12ExtractWeird));
    await w2.page.close();
  }
  await relaunch();
  // 9. Milestone 13: organise (the surgery engine proved in
  // m13-bench.mjs) and the metadata tool. Organise runs the task's
  // exact sequence on a fixture whose pages carry a picture AND a
  // marker each: delete page 2, move page 3 to the front, duplicate
  // page 1; the output's order is read back by marker text, its
  // pictures by an inheritance-aware walk (what a renderer sees),
  // its rendering by PDF.js. The refuse-empty rule is exercised on
  // a second load. Metadata shows the fixture's known details
  // exactly, then the strip output must read empty under a pdf-lib
  // reload AND pdfinfo, and the set output must read its new
  // title/author back. Fixtures: verify/fixtures/m13.
  const M13 = path.join(HERE, 'fixtures', 'm13');
  function effRes(doc, page) {
    let node = page.node;
    while (node && typeof node.get === 'function') {
      const raw = node.get(PDFName.of('Resources'));
      if (raw) return doc.context.lookup(raw);
      node = node.lookup(PDFName.of('Parent'));
    }
    return null;
  }
  function pageHasImage(doc, page) {
    const res = effRes(doc, page);
    if (!res) return false;
    let xo = null;
    try { xo = res.lookup(PDFName.of('XObject')); } catch (e) { xo = null; }
    if (!xo || typeof xo.entries !== 'function') return false;
    for (const [, ref] of xo.entries()) {
      const obj = doc.context.lookup(ref);
      if (obj instanceof PDFRawStream) {
        const st = obj.dict.lookup(PDFName.of('Subtype'));
        if (st && st.toString() === '/Image') return true;
      }
    }
    return false;
  }
  {
    const { page, errors, failed } = await openPage(BASE + '/organize-pdf/');
    const input = await page.$('#og-file');
    await input.uploadFile(path.join(M13, 'images-markers.pdf'));
    await page.waitForFunction(() => document.getElementById('og-status').textContent.includes('Ready'), { timeout: 120000 });
    const tiles0 = await page.evaluate(() => [...document.querySelectorAll('#og-pages article')].length);
    const thumbsOk = await page.evaluate(async () => {
      const imgs = [...document.querySelectorAll('#og-pages article img')];
      let nonBlank = 0;
      for (const img of imgs) {
        if (!img.src.startsWith('data:image')) return false;
        const bmp = await createImageBitmap(await (await fetch(img.src)).blob());
        const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
        const ctx = c.getContext('2d'); ctx.drawImage(bmp, 0, 0);
        const d = ctx.getImageData(0, 0, c.width, c.height).data;
        let diff = 0;
        for (let i = 0; i < d.length; i += 16) if (d[i] < 245 || d[i + 1] < 245 || d[i + 2] < 245) diff++;
        if (diff > 50) nonBlank++;
      }
      return nonBlank === imgs.length && imgs.length === 4;
    });
    console.log('TOOL m13 organise tiles:', tiles0, '| thumbnails rendered non-blank:', thumbsOk);
    if (tiles0 !== 4 || !thumbsOk) throw new Error('m13 organise thumbnail gate failed');
    const clickAct = (act, pos) => page.click('#og-pages button[data-act="' + act + '"][data-pos="' + pos + '"]');
    await clickAct('del', 1);   // delete page 2        -> [1,3,4]
    await clickAct('left', 1);  // page 3 to the front  -> [3,1,4]
    await clickAct('dup', 1);   // duplicate page 1     -> [3,1,1,4]
    const labels = await page.evaluate(() => [...document.querySelectorAll('#og-pages article p')].map((el) => el.textContent));
    await page.click('#og-run');
    await shown(page, 'og-result', 120000);
    const outPath = await saveBlob(page, '#og-download', 'm13-organized.pdf');
    const outDoc = await PDFDocument.load(fs.readFileSync(outPath));
    const markers = [1, 2, 3, 4].map((n) => { const m = pageText(outPath, n).match(/PAGE-[A-Z]+/); return m ? m[0] : '(none)'; });
    const orderOk = JSON.stringify(markers) === JSON.stringify(['PAGE-THREE', 'PAGE-ONE', 'PAGE-ONE', 'PAGE-FOUR']);
    const images = outDoc.getPages().map((p) => pageHasImage(outDoc, p));
    const imagesOk = JSON.stringify(images) === JSON.stringify([true, true, true, true]);
    const titleKept = outDoc.getTitle() === 'Images Fixture';
    // The output must also RENDER: page 1 through PDF.js, right
    // size, not a blank sheet.
    const render = await page.evaluate(async (b64) => {
      const bin = atob(b64); const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      const pdfjsLib = await import(/* @vite-ignore */ '/pdfjs/pdf.min.mjs');
      pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.min.mjs';
      const doc = await pdfjsLib.getDocument({ data: arr }).promise;
      const pg = await doc.getPage(1);
      const vp = pg.getViewport({ scale: 1 });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(vp.width); canvas.height = Math.round(vp.height);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      await pg.render({ canvasContext: ctx, viewport: vp }).promise;
      const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let diff = 0;
      for (let i = 0; i < d.length; i += 16) if (d[i] < 245 || d[i + 1] < 245 || d[i + 2] < 245) diff++;
      return { w: Math.round(vp.width), h: Math.round(vp.height), nonWhiteSamples: diff, pages: doc.numPages };
    }, fs.readFileSync(outPath).toString('base64'));
    const renderOk = render.w === 640 && render.h === 480 && render.nonWhiteSamples > 200 && render.pages === 4;
    results.tools.m13Organize = { tiles: tiles0, thumbsOk, labels, markers, orderOk, images, imagesOk, titleKept, render, renderOk, consoleErrors: errors, failedRequests: failed };
    console.log('TOOL m13 organise: markers', markers.join(','), '| images', images.join(','), '| title kept:', titleKept, '| render:', JSON.stringify(render));
    if (!orderOk || !imagesOk || !titleKept || !renderOk || errors.length) throw new Error('m13 organise gate failed: ' + JSON.stringify(results.tools.m13Organize));
    await page.setViewport({ width: 1280, height: 900 });
    await page.screenshot({ path: path.join(SHOTS, 'm13-organize-pdf-desktop.png'), fullPage: true });
    await page.setViewport({ width: 390, height: 844 });
    await new Promise((r) => setTimeout(r, 300));
    await page.screenshot({ path: path.join(SHOTS, 'm13-organize-pdf-mobile.png'), fullPage: true });
    await page.close();

    // Refuse-empty: delete down to one page; its Remove button is
    // disabled, the rule is printed, and the run still works.
    const r2 = await openPage(BASE + '/organize-pdf/');
    const input2 = await r2.page.$('#og-file');
    await input2.uploadFile(path.join(M13, 'images-markers.pdf'));
    await r2.page.waitForFunction(() => document.getElementById('og-status').textContent.includes('Ready'), { timeout: 120000 });
    for (let k = 0; k < 3; k++) await r2.page.click('#og-pages button[data-act="del"][data-pos="0"]');
    const lastState = await r2.page.evaluate(() => ({
      tiles: document.querySelectorAll('#og-pages article').length,
      delDisabled: document.querySelector('#og-pages button[data-act="del"]').disabled,
      noteShown: !document.getElementById('og-last-note').classList.contains('hidden'),
      noteText: document.getElementById('og-last-note').textContent.replace(/\s+/g, ' ').trim(),
    }));
    await r2.page.click('#og-run');
    await shown(r2.page, 'og-result', 120000);
    const onePath = await saveBlob(r2.page, '#og-download', 'm13-organized-one.pdf');
    const oneDoc = await PDFDocument.load(fs.readFileSync(onePath));
    const oneMarker = (pageText(onePath, 1).match(/PAGE-[A-Z]+/) || ['(none)'])[0];
    const refuseOk = lastState.tiles === 1 && lastState.delDisabled && lastState.noteShown
      && lastState.noteText.includes('At least one page has to stay') && oneDoc.getPageCount() === 1 && oneMarker === 'PAGE-FOUR';
    results.tools.m13OrganizeRefuseEmpty = { lastState, pages: oneDoc.getPageCount(), oneMarker, refuseOk, consoleErrors: r2.errors, failedRequests: r2.failed };
    console.log('TOOL m13 organise refuse-empty:', JSON.stringify(lastState), '| one-page output marker:', oneMarker);
    if (!refuseOk || r2.errors.length) throw new Error('m13 organise refuse-empty gate failed: ' + JSON.stringify(results.tools.m13OrganizeRefuseEmpty));
    await r2.page.close();
  }
  await relaunch();
  {
    // (b) metadata: the known fixture shows exactly; strip reads
    // empty under an independent reload and pdfinfo; set reads back.
    const { page, errors, failed } = await openPage(BASE + '/pdf-metadata/');
    const input = await page.$('#md-file');
    await input.uploadFile(path.join(M13, 'meta.pdf'));
    await page.waitForFunction(() => !document.getElementById('md-strip').disabled, { timeout: 30000 });
    const viewText = await page.$eval('#md-view', (el) => el.textContent.replace(/\s+/g, ' '));
    const shows = ['Quarterly Report (Final)', 'Jo Example', 'Board papers', 'alpha beta gamma',
      'Bench Creator 1.0', 'Bench Producer 2.0', 'D:20250115103000', 'D:20250620081500']
      .every((s) => viewText.includes(s));
    results.tools.m13MetaView = { viewSample: viewText.slice(0, 260), showsExactly: shows, consoleErrors: errors, failedRequests: failed };
    console.log('TOOL m13 metadata view shows the fixture exactly:', shows, '|', viewText.slice(0, 200));
    if (!shows || errors.length) throw new Error('m13 metadata view gate failed: ' + JSON.stringify(results.tools.m13MetaView));
    await page.click('#md-strip');
    await shown(page, 'md-result', 60000);
    const stripPath = await saveBlob(page, '#md-download', 'm13-meta-stripped.pdf');
    const back = await PDFDocument.load(fs.readFileSync(stripPath), { updateMetadata: false });
    const infoRef = back.context.trailerInfo.Info;
    const backKeys = infoRef ? [...back.context.lookup(infoRef).keys()].map((k) => k.toString()) : [];
    const gettersEmpty = ['getTitle', 'getAuthor', 'getSubject', 'getKeywords', 'getCreator', 'getProducer', 'getCreationDate', 'getModificationDate']
      .every((g) => back[g]() === undefined);
    const pdfinfo = execFileSync('pdfinfo', [stripPath], { encoding: 'utf8' });
    const pdfinfoClean = !/Quarterly|Jo Example|Bench (Creator|Producer)|Board papers/.test(pdfinfo);
    const viewBlank = await page.$eval('#md-view', (el) => el.textContent).then((t) => t.includes('not set') && !t.includes('Quarterly'));
    results.tools.m13MetaStrip = { backKeys, gettersEmpty, pdfinfoClean, viewBlank, pages: back.getPageCount(), consoleErrors: errors, failedRequests: failed };
    console.log('TOOL m13 metadata strip: info keys after:', backKeys.join(',') || '(none)', '| getters empty:', gettersEmpty, '| pdfinfo clean:', pdfinfoClean, '| view blank:', viewBlank);
    if (backKeys.length || !gettersEmpty || !pdfinfoClean || !viewBlank || back.getPageCount() !== 2 || errors.length) throw new Error('m13 metadata strip gate failed: ' + JSON.stringify(results.tools.m13MetaStrip));
    await page.close();

    const s2 = await openPage(BASE + '/pdf-metadata/');
    const input2 = await s2.page.$('#md-file');
    await input2.uploadFile(path.join(M13, 'meta.pdf'));
    await s2.page.waitForFunction(() => !document.getElementById('md-save').disabled, { timeout: 30000 });
    await s2.page.$eval('#md-title', (el) => { el.value = 'Gate Title 13'; });
    await s2.page.$eval('#md-author', (el) => { el.value = 'Gate Author 13'; });
    await s2.page.click('#md-save');
    await shown(s2.page, 'md-result', 60000);
    const setPath = await saveBlob(s2.page, '#md-download', 'm13-meta-set.pdf');
    const back2 = await PDFDocument.load(fs.readFileSync(setPath), { updateMetadata: false });
    const setOk = back2.getTitle() === 'Gate Title 13' && back2.getAuthor() === 'Gate Author 13' && back2.getSubject() === 'Board papers';
    results.tools.m13MetaSet = { title: back2.getTitle(), author: back2.getAuthor(), subjectKept: back2.getSubject(), setOk, consoleErrors: s2.errors, failedRequests: s2.failed };
    console.log('TOOL m13 metadata set:', JSON.stringify(results.tools.m13MetaSet));
    if (!setOk || s2.errors.length) throw new Error('m13 metadata set gate failed: ' + JSON.stringify(results.tools.m13MetaSet));
    await s2.page.close();
  }
  await relaunch();
  // 10. Milestone 14: JPG to PDF (pictures in list order, one per
  // page, JPEG/PNG stored untouched), PDF to JPG (every page drawn
  // as a picture at the picked format and DPI), and the 50 KB preset
  // door on the shipped compress island. Order in the built PDF is
  // proved three ways: page sizes, the stored pictures' own
  // dimensions and centre pixels (through the m12 extract path),
  // and the red JPEG coming back byte-identical to the file that
  // went in. Fixtures: verify/fixtures/m14 (m14-make-fixtures.mjs).
  const M14 = path.join(HERE, 'fixtures', 'm14');
  const encodePng14 = async ({ data, width, height }) =>
    sharp(Buffer.from(data.buffer, data.byteOffset, data.byteLength), { raw: { width, height, channels: 4 } }).png().toBuffer();
  const centerPixel = async (buf) => {
    const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const i = (Math.floor(info.height / 2) * info.width + Math.floor(info.width / 2)) * 4;
    return [data[i], data[i + 1], data[i + 2]];
  };
  const nearPx = (px, want, tol) => px.every((v, i) => Math.abs(v - want[i]) <= tol);
  {
    const { page, errors, failed } = await openPage(BASE + '/jpg-to-pdf/');
    const input = await page.$('#jp-file');
    await input.uploadFile(path.join(M14, 'img-red.jpg'), path.join(M14, 'img-green.png'), path.join(M14, 'img-blue.webp'));
    await page.waitForFunction(() => document.querySelectorAll('#jp-list > li').length === 3 && !document.getElementById('jp-run').disabled, { timeout: 60000 });
    await page.click('#jp-list button[data-act="up"][data-pos="2"]');
    await page.click('#jp-list button[data-act="up"][data-pos="1"]');
    const after = await page.$$eval('#jp-list > li > span:first-child', (els) => els.map((e) => e.textContent.replace(/^\d+\. /, '')));
    const orderOk = JSON.stringify(after) === JSON.stringify(['img-blue.webp', 'img-red.jpg', 'img-green.png']);
    await page.click('#jp-run');
    await shown(page, 'jp-result', 120000);
    const note = await page.$eval('#jp-achieved', (el) => el.textContent);
    const outPath = await saveBlob(page, '#jp-download', 'm14-jpg-to-pdf.pdf');
    const doc = await PDFDocument.load(fs.readFileSync(outPath));
    const sizes = doc.getPages().map((p) => { const s = p.getSize(); return [Math.round(s.width), Math.round(s.height)]; });
    const res = await extractPdfImages(doc, { encodePng: encodePng14 });
    const byPage = new Map(res.files.map((f) => [f.page, f]));
    const dims = [1, 2, 3].map((n) => { const f = byPage.get(n); return f ? [f.width, f.height] : null; });
    const px = {};
    for (const n of [1, 2, 3]) { const f = byPage.get(n); if (f) px[n] = await centerPixel(Buffer.from(f.data)); }
    const redBytesOk = !!byPage.get(2) && Buffer.from(byPage.get(2).data).equals(fs.readFileSync(path.join(M14, 'img-red.jpg')));
    const sizesOk = JSON.stringify(sizes) === JSON.stringify([[400, 400], [300, 200], [200, 300]]);
    const dimsOk = JSON.stringify(dims) === JSON.stringify([[400, 400], [300, 200], [200, 300]]);
    const colorsOk = nearPx(px[1] || [], [40, 80, 200], 10) && nearPx(px[2] || [], [200, 40, 30], 12) && nearPx(px[3] || [], [30, 160, 60], 10);
    results.tools.m14JpgToPdf = { note, order: after, orderOk, sizes, dims, centers: px, redBytesOk, consoleErrors: errors, failedRequests: failed };
    console.log('TOOL m14 jpg-to-pdf:', note, '| sizes', JSON.stringify(sizes), '| red JPEG byte-identical:', redBytesOk);
    if (!orderOk || !sizesOk || !dimsOk || !colorsOk || !redBytesOk || errors.length) throw new Error('m14 jpg-to-pdf gate failed: ' + JSON.stringify(results.tools.m14JpgToPdf));
    await page.setViewport({ width: 1280, height: 900 });
    await page.screenshot({ path: path.join(SHOTS, 'm14-jpg-to-pdf-desktop.png'), fullPage: true });
    await page.setViewport({ width: 390, height: 844 });
    await new Promise((r) => setTimeout(r, 300));
    await page.screenshot({ path: path.join(SHOTS, 'm14-jpg-to-pdf-mobile.png'), fullPage: true });
    await page.close();

    // A4 fit: one picture; the page is A4 and the picture is placed.
    const a4 = await openPage(BASE + '/jpg-to-pdf/');
    const a4input = await a4.page.$('#jp-file');
    await a4input.uploadFile(path.join(M14, 'img-red.jpg'));
    await a4.page.waitForFunction(() => !document.getElementById('jp-run').disabled, { timeout: 60000 });
    await a4.page.$eval('input[name="jp-fit"][value="a4"]', (el) => { el.checked = true; el.dispatchEvent(new Event('change')); });
    await a4.page.click('#jp-run');
    await shown(a4.page, 'jp-result', 120000);
    const a4Path = await saveBlob(a4.page, '#jp-download', 'm14-jpg-to-pdf-a4.pdf');
    const a4Doc = await PDFDocument.load(fs.readFileSync(a4Path));
    const a4Size = a4Doc.getPage(0).getSize();
    const a4Ok = a4Doc.getPageCount() === 1 && Math.abs(a4Size.width - 595.28) < 0.5 && Math.abs(a4Size.height - 841.89) < 0.5;
    results.tools.m14JpgToPdfA4 = { page: [a4Size.width, a4Size.height], a4Ok, consoleErrors: a4.errors, failedRequests: a4.failed };
    console.log('TOOL m14 jpg-to-pdf A4: page', a4Size.width, 'x', a4Size.height, '| ok:', a4Ok);
    if (!a4Ok || a4.errors.length) throw new Error('m14 jpg-to-pdf A4 gate failed: ' + JSON.stringify(results.tools.m14JpgToPdfA4));
    await a4.page.close();
  }
  await relaunch();
  {
    const BANDS = [[200, 40, 30], [30, 160, 60], [40, 80, 200], [230, 140, 20], [130, 60, 180]];
    // Fixture geometry, in points: the colour band spans x 72..540,
    // y-from-bottom 600..680 (centre 306, 152 from top); the marker
    // text sits y-from-bottom 500..536, x 72..300 (from top 256..292).
    async function bandCheck(zipPath, scale, tol) {
      const zip = await JSZip.loadAsync(fs.readFileSync(zipPath));
      const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir).sort();
      const checks = [];
      for (let i = 0; i < names.length; i++) {
        const buf = Buffer.from(await zip.file(names[i]).async('uint8array'));
        const meta = await sharp(buf).metadata();
        const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        const bi = (Math.round(152 * scale) * info.width + Math.round(306 * scale)) * 4;
        const band = [data[bi], data[bi + 1], data[bi + 2]];
        let dark = 0;
        const y0 = Math.round(256 * scale), y1 = Math.round(292 * scale);
        const x0 = Math.round(72 * scale), x1 = Math.round(300 * scale);
        for (let y = y0; y < y1; y += 3) for (let x = x0; x < x1; x += 3) {
          const j = (y * info.width + x) * 4;
          if (data[j] < 100 && data[j + 1] < 100 && data[j + 2] < 100) dark++;
        }
        checks.push({ name: names[i], format: meta.format, w: info.width, h: info.height, band, bandOk: nearPx(band, BANDS[i], tol), dark });
      }
      return checks;
    }
    // Print size, JPG: 1700 x 2200 per page, ZIP of 5.
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
    results.tools.m14PdfToJpgPrint = { note, entries: entries.length, checks, consoleErrors: errors, failedRequests: failed };
    console.log('TOOL m14 pdf-to-jpg print:', note, '| entries', entries.length, '| dims ok:', dimsOk, '| content ok:', contentOk);
    if (entries.length !== 5 || !dimsOk || !contentOk || errors.length) throw new Error('m14 pdf-to-jpg print gate failed: ' + JSON.stringify(results.tools.m14PdfToJpgPrint));
    await page.setViewport({ width: 1280, height: 900 });
    await page.screenshot({ path: path.join(SHOTS, 'm14-pdf-to-jpg-desktop.png'), fullPage: true });
    await page.setViewport({ width: 390, height: 844 });
    await new Promise((r) => setTimeout(r, 300));
    await page.screenshot({ path: path.join(SHOTS, 'm14-pdf-to-jpg-mobile.png'), fullPage: true });
    await page.close();

    // Screen size, PNG: 816 x 1056 per page, ZIP of 5. Both radios
    // are set explicitly: the island keeps the visitor's last
    // settings, and an earlier gate in this run chose print size.
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
    results.tools.m14PdfToJpgScreen = { entries: entries2.length, checks: checks2, consoleErrors: s2.errors, failedRequests: s2.failed };
    console.log('TOOL m14 pdf-to-jpg screen PNG: entries', entries2.length, '| dims ok:', dimsOk2, '| content ok:', contentOk2);
    if (entries2.length !== 5 || !dimsOk2 || !contentOk2 || s2.errors.length) throw new Error('m14 pdf-to-jpg screen gate failed: ' + JSON.stringify(results.tools.m14PdfToJpgScreen));
    await s2.page.close();

    // One page: the download is the picture itself, not a ZIP.
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
    results.tools.m14PdfToJpgSingle = { dlName, format: meta3.format, w: meta3.width, h: meta3.height, singleOk, consoleErrors: s3.errors, failedRequests: s3.failed };
    console.log('TOOL m14 pdf-to-jpg single: download name', dlName, '| meta', meta3.format, meta3.width, 'x', meta3.height, '| ok:', singleOk);
    if (!singleOk || s3.errors.length) throw new Error('m14 pdf-to-jpg single gate failed: ' + JSON.stringify(results.tools.m14PdfToJpgSingle));
    await s3.page.close();

    // Stress: the 50-page document at screen size, JPG — the run
    // the page copy's tested number comes from.
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
    results.tools.m14PdfToJpgStress = { stressMs, entries: entries4.length, consoleErrors: s4.errors, failedRequests: s4.failed };
    console.log('TOOL m14 pdf-to-jpg stress: 50-page document rendered in', stressMs, 'ms | zip entries', entries4.length);
    if (entries4.length !== 50 || s4.errors.length) throw new Error('m14 pdf-to-jpg stress gate failed: ' + JSON.stringify(results.tools.m14PdfToJpgStress));
    await s4.page.close();
  }
  await relaunch();
  {
    // The 50 KB door on the standard corpus photo PDF: it lands
    // under the target, or the result line honestly reports the
    // smallest size reached, in the 200 KB door's own wording.
    const { page, errors, failed } = await openPage(BASE + '/compress-pdf-to-50kb/');
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
    results.tools.m14Preset50k = { note, outputBytes: size, landed, honest, consoleErrors: errors, failedRequests: failed };
    console.log('TOOL m14 preset-50k:', note, '| bytes', size, '| landed:', landed, '| honest fallback:', honest);
    if (!(landed || honest) || errors.length) throw new Error('m14 preset 50k gate failed: ' + JSON.stringify(results.tools.m14Preset50k));
    await page.close();
  }

  // 11. Milestone 15: HEIC. The pixel-level truth (all seven EXIF
  // orientations upright, the container-transform fixtures, the
  // 10-bit conversion) is proven against the production decoder in
  // Node by verify/m15-unit.mjs. These gates prove the shipped
  // pages: a real HEIC converts to a real JPG with the right
  // dimensions and centre colours; an EXIF-turned photo comes out
  // upright through the page; a 10-bit photo converts with the
  // standard-range line printed; and HEIC is accepted on the doors
  // the decoder plugs into (resize exact, batch convert ZIP,
  // compress result, OCR reads the line). Fixtures:
  // verify/fixtures/m15 (verify/m15-make-fixtures.py).
  const M15 = path.join(HERE, 'fixtures', 'm15');
  const M15M = JSON.parse(fs.readFileSync(path.join(M15, 'fixtures.json'), 'utf8'));
  const sampleImg = (page, sel) => page.$eval(sel, async (a) => {
    const res = await fetch(a.href);
    const blob = await res.blob();
    const bmp = await createImageBitmap(blob);
    const c = document.createElement('canvas');
    c.width = bmp.width; c.height = bmp.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(bmp, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    const px = (x, y) => { const i = (y * c.width + x) * 4; return [d[i], d[i + 1], d[i + 2]]; };
    let sr = 0, sg = 0, sb = 0, n = 0;
    const x0 = Math.floor(c.width / 2) - 100, y0 = Math.floor(c.height / 2) - 100;
    for (let y = y0; y < y0 + 200; y += 2) for (let x = x0; x < x0 + 200; x += 2) { const i = (y * c.width + x) * 4; sr += d[i]; sg += d[i + 1]; sb += d[i + 2]; n++; }
    return {
      w: c.width, h: c.height, type: blob.type, bytes: blob.size,
      corners: { TL: px(30, 30), TR: px(c.width - 31, 30), BL: px(30, c.height - 31), BR: px(c.width - 31, c.height - 31) },
      centreMean: [Math.round(sr / n), Math.round(sg / n), Math.round(sb / n)],
    };
  });
  await relaunch();
  {
    const { page, errors, failed } = await openPage(BASE + '/heic-to-jpg/');
    const input = await page.$('#hc-file');
    await input.uploadFile(path.join(M15, 'photo.heic'));
    await page.waitForFunction(() => !document.getElementById('hc-run').disabled, { timeout: 30000 });
    await page.click('#hc-run');
    await shown(page, 'hc-result', 180000);
    const note = await page.$eval('#hc-achieved', (el) => el.textContent);
    const meta = await sampleImg(page, '#hc-download');
    const outPath = await saveBlob(page, '#hc-download', 'm15-photo.jpg');
    const head = fs.readFileSync(outPath);
    const wasmServed = await page.evaluate(() => performance.getEntriesByType('resource').some((e) => e.name.includes('/heif/libheif.wasm')));
    const ok = meta.w === 1200 && meta.h === 900 && meta.type === 'image/jpeg'
      && head[0] === 0xff && head[1] === 0xd8
      && nearPx(meta.centreMean, M15M.photo.heicCentreMean, 10)
      && note.includes('1200 x 900') && wasmServed;
    results.tools.m15HeicToJpg = { note, meta, jpegMagic: head[0] === 0xff && head[1] === 0xd8, wasmServed, consoleErrors: errors, failedRequests: failed };
    console.log('TOOL m15 heic-to-jpg photo:', note, '| meta', meta.w + 'x' + meta.h, meta.type, '| centre', meta.centreMean.join(','), 'vs', M15M.photo.heicCentreMean.join(','), '| wasm served:', wasmServed);
    if (!ok || errors.length) throw new Error('m15 heic-to-jpg gate failed: ' + JSON.stringify(results.tools.m15HeicToJpg));
    await page.screenshot({ path: path.join(SHOTS, 'm15-heic-to-jpg-desktop.png'), fullPage: true });
    await page.setViewport({ width: 390, height: 844 });
    await new Promise((r) => setTimeout(r, 300));
    await page.screenshot({ path: path.join(SHOTS, 'm15-heic-to-jpg-mobile.png'), fullPage: true });
    await page.setViewport({ width: 1280, height: 900 });
    await page.close();
  }
  await relaunch();
  {
    // The EXIF-turned photo comes out upright through the page, and
    // the 10-bit photo converts with its range line printed.
    const { page, errors, failed } = await openPage(BASE + '/heic-to-jpg/');
    const input = await page.$('#hc-file');
    await input.uploadFile(path.join(M15, 'orient-6.heic'));
    await page.waitForFunction(() => !document.getElementById('hc-run').disabled, { timeout: 30000 });
    await page.click('#hc-run');
    await shown(page, 'hc-result', 180000);
    const note6 = await page.$eval('#hc-achieved', (el) => el.textContent);
    const meta6 = await sampleImg(page, '#hc-download');
    const want = M15M.pattern.corners;
    const upright = meta6.w === 400 && meta6.h === 300
      && ['TL', 'TR', 'BL', 'BR'].every((k) => nearPx(meta6.corners[k], want[k], 18))
      && note6.includes('upright');
    results.tools.m15HeicUpright = { note: note6, meta: meta6, upright, consoleErrors: errors, failedRequests: failed };
    console.log('TOOL m15 heic upright (EXIF 6):', note6, '| corners', JSON.stringify(meta6.corners));
    if (!upright || errors.length) throw new Error('m15 upright gate failed: ' + JSON.stringify(results.tools.m15HeicUpright));
    await input.uploadFile(path.join(M15, 'tenbit.heic'));
    await page.waitForFunction(() => !document.getElementById('hc-run').disabled, { timeout: 30000 });
    await page.click('#hc-run');
    await shown(page, 'hc-result', 180000);
    const note10 = await page.$eval('#hc-achieved', (el) => el.textContent);
    const meta10 = await sampleImg(page, '#hc-download');
    const tenOk = meta10.w === 256 && meta10.h === 64 && note10.includes('10-bit') && note10.includes('standard range');
    results.tools.m15HeicTenBit = { note: note10, meta: meta10, tenOk, consoleErrors: errors, failedRequests: failed };
    console.log('TOOL m15 heic 10-bit:', note10);
    if (!tenOk || errors.length) throw new Error('m15 10-bit gate failed: ' + JSON.stringify(results.tools.m15HeicTenBit));
    await page.close();
  }
  await relaunch();
  {
    // HEIC accepted on the doors the decoder plugs into.
    const rs = await openPage(BASE + '/resize-image/');
    const ri = await rs.page.$('#ri-file');
    await ri.uploadFile(path.join(M15, 'photo.heic'));
    await rs.page.waitForFunction(() => !document.getElementById('ri-run').disabled, { timeout: 30000 });
    await rs.page.$eval('#ri-width', (el) => { el.value = '600'; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); });
    await rs.page.click('#ri-run');
    await rs.page.waitForFunction(() => { const a = document.querySelector('#ri-result a[download]'); return !!a && a.href.startsWith('blob:') && !document.getElementById('ri-result').classList.contains('hidden'); }, { timeout: 180000 });
    const rsMeta = await sampleImg(rs.page, '#ri-result a[download]');
    const rsOk = rsMeta.w === 600 && rsMeta.h === 450;
    results.tools.m15HeicResizeDoor = { meta: rsMeta, rsOk, consoleErrors: rs.errors, failedRequests: rs.failed };
    console.log('TOOL m15 HEIC on resize door:', rsMeta.w + 'x' + rsMeta.h);
    if (!rsOk || rs.errors.length) throw new Error('m15 resize door gate failed: ' + JSON.stringify(results.tools.m15HeicResizeDoor));
    await rs.page.close();

    const bc = await openPage(BASE + '/batch-convert-images/');
    const bi = await bc.page.$('#bi-file');
    await bi.uploadFile(path.join(M15, 'photo.heic'));
    await bc.page.waitForFunction(() => !document.getElementById('bi-run').disabled, { timeout: 30000 });
    await bc.page.click('#bi-run');
    await bc.page.waitForFunction(() => { const z = document.getElementById('bi-zip'); return z && z.href.startsWith('blob:'); }, { timeout: 180000 });
    const bcEntries = await zipEntries(await saveBlob(bc.page, '#bi-zip', 'm15-batch-convert.zip'));
    const bcOk = bcEntries.length === 1 && /\.webp$/i.test(bcEntries[0].name);
    results.tools.m15HeicBatchDoor = { entries: bcEntries, bcOk, consoleErrors: bc.errors, failedRequests: bc.failed };
    console.log('TOOL m15 HEIC on batch convert door: entries', JSON.stringify(bcEntries));
    if (!bcOk || bc.errors.length) throw new Error('m15 batch door gate failed: ' + JSON.stringify(results.tools.m15HeicBatchDoor));
    await bc.page.close();

    const ci = await openPage(BASE + '/compress-image/');
    const ciIn = await ci.page.$('#ci-file');
    await ciIn.uploadFile(path.join(M15, 'photo.heic'));
    await ci.page.waitForFunction(() => !document.getElementById('ci-run').disabled, { timeout: 30000 });
    await ci.page.click('#ci-run');
    await ci.page.waitForFunction(() => !document.getElementById('ci-result').classList.contains('hidden'), { timeout: 420000 });
    const ciSpec = await ci.page.$eval('#ci-spec', (el) => el.textContent);
    const ciStatus = await ci.page.$eval('#ci-status', (el) => el.textContent);
    const ciOk = ciSpec.includes('1200 x 900') && !ciStatus.includes('went wrong');
    results.tools.m15HeicCompressDoor = { spec: ciSpec, status: ciStatus, ciOk, consoleErrors: ci.errors, failedRequests: ci.failed };
    console.log('TOOL m15 HEIC on compress door: spec has dims:', ciSpec.includes('1200 x 900'));
    if (!ciOk || ci.errors.length) throw new Error('m15 compress door gate failed: ' + JSON.stringify(results.tools.m15HeicCompressDoor));
    await ci.page.close();

    const oc = await openPage(BASE + '/ocr-image/');
    const oi = await oc.page.$('#oi-file');
    await oi.uploadFile(path.join(M15, 'text.heic'));
    await oc.page.waitForFunction(() => !document.getElementById('oi-run').disabled, { timeout: 60000 });
    await oc.page.click('#oi-run');
    await shown(oc.page, 'oi-result', 420000);
    const ocText = await oc.page.$eval('#oi-text', (el) => el.value);
    const ocAcc = charAccuracy(ocText, M15M.ocrLine);
    const ocOk = ocText.toLowerCase().includes('quick brown fox') && ocAcc >= 0.9;
    results.tools.m15HeicOcrDoor = { text: ocText, accuracy: Number(ocAcc.toFixed(4)), ocOk, consoleErrors: oc.errors, failedRequests: oc.failed };
    console.log('TOOL m15 HEIC on OCR door: accuracy', ocAcc.toFixed(4), '| text:', JSON.stringify(ocText));
    if (!ocOk || oc.errors.length) throw new Error('m15 OCR door gate failed: ' + JSON.stringify(results.tools.m15HeicOcrDoor));
    await oc.page.close();
  }

  // 12. Milestone 16: workflows chain steps (background removal + OCR).
  // Picker rules: the builder only offers steps that fit the chain's
  // current lane, says why in its own words, and refuses an OCR step
  // anywhere but last.
  {
    const { page, errors, failed } = await openPage(BASE + '/workflows/');
    const optState = () => page.evaluate(() => {
      const o = {};
      for (const opt of document.querySelectorAll('#wf-tool option')) o[opt.value] = opt.disabled;
      return o;
    });
    const note = () => page.$eval('#wf-picker-note', (el) => el.textContent);
    const initial = await optState();
    const initialNote = await note();
    await page.select('#wf-tool', 'compress-image');
    await page.click('#wf-add');
    await page.waitForFunction(() => document.querySelectorAll('#wf-steps > div').length === 1, { timeout: 15000 });
    const afterImage = await optState();
    const imageNote = await note();
    const imageOk = afterImage.merge && afterImage['compress-pdf'] && afterImage.split && afterImage.stamp
      && !afterImage['compress-image'] && !afterImage['remove-bg'] && !afterImage.ocr
      && imageNote.includes('works on photos');
    await page.evaluate(() => { document.querySelector('#wf-steps > div button:last-child').click(); });
    await page.waitForFunction(() => document.querySelectorAll('#wf-steps > div').length === 0, { timeout: 15000 });
    await page.select('#wf-tool', 'merge');
    await page.click('#wf-add');
    await page.waitForFunction(() => document.querySelectorAll('#wf-steps > div').length === 1, { timeout: 15000 });
    const afterPdf = await optState();
    const pdfNote = await note();
    const pdfOk = !afterPdf.merge && !afterPdf['compress-pdf'] && !afterPdf.split && !afterPdf.stamp
      && afterPdf['compress-image'] && afterPdf['remove-bg'] && !afterPdf.ocr
      && pdfNote.includes('works on PDFs');
    await page.evaluate(() => { document.querySelector('#wf-steps > div button:last-child').click(); });
    await page.waitForFunction(() => document.querySelectorAll('#wf-steps > div').length === 0, { timeout: 15000 });
    // OCR mis-position: steps [compress-image, ocr], then move OCR up.
    const input = await page.$('#wf-file');
    await input.uploadFile(path.join(CORPUS, 'test-bg-hard.png'));
    await page.select('#wf-tool', 'compress-image');
    await page.click('#wf-add');
    await page.select('#wf-tool', 'ocr');
    await page.click('#wf-add');
    await page.waitForFunction(() => document.querySelectorAll('#wf-steps > div').length === 2, { timeout: 15000 });
    const runEnabledOk = await page.evaluate(() => !document.getElementById('wf-run').disabled);
    const ocrAllDisabled = await optState();
    const ocrNote = await note();
    const ocrDisabledOk = Object.values(ocrAllDisabled).every(Boolean) && ocrNote.includes('no step can be added after it');
    await page.evaluate(() => {
      const rows = document.querySelectorAll('#wf-steps > div');
      rows[1].querySelectorAll('button')[0].click(); // OCR row's Up button
    });
    await new Promise((r) => setTimeout(r, 300));
    const runBlocked = await page.evaluate(() => document.getElementById('wf-run').disabled);
    const stepsText = await page.$eval('#wf-steps', (el) => el.textContent);
    const warningShown = stepsText.includes('has to be the last step');
    const pickerOk = initialNote.includes('one kind of file') && imageOk && pdfOk && runEnabledOk && ocrDisabledOk && runBlocked && warningShown;
    results.tools.m16Picker = { initial, initialNote, afterImage, imageNote, afterPdf, pdfNote, runEnabledOk, ocrAllDisabled, ocrNote, runBlockedAfterMove: runBlocked, warningShown, pickerOk, consoleErrors: errors, failedRequests: failed };
    console.log('TOOL m16 picker rules ok:', pickerOk);
    if (!pickerOk || errors.length || failed.length) throw new Error('m16 picker gate failed: ' + JSON.stringify(results.tools.m16Picker));
    await page.close();
  }

  // OCR chain: the same fixture, the same accuracy as the standalone
  // page (standalone = 0.9921), then the scanned-PDF fixture.
  {
    const M10D = path.join(HERE, 'fixtures', 'm10');
    const { page, errors, failed } = await openPage(BASE + '/workflows/');
    await page.select('#wf-tool', 'ocr');
    await page.click('#wf-add');
    const input = await page.$('#wf-file');
    await input.uploadFile(path.join(M10D, 'fixture-big.png'));
    await page.waitForFunction(() => !document.getElementById('wf-run').disabled, { timeout: 30000 });
    await page.click('#wf-run');
    await page.waitForFunction(() => !!document.querySelector('#wf-outputs textarea'), { timeout: 420000 });
    const text = await page.$eval('#wf-outputs textarea', (el) => el.value);
    const acc = charAccuracy(text, BIG_TEXT);
    const noteShown = await page.evaluate(() => !document.getElementById('wf-ocr-note').classList.contains('hidden'));
    const log = await page.$eval('#wf-log', (el) => el.textContent);
    const ocrOk = acc >= 0.98 && noteShown;
    results.tools.m16OcrChainImage = { accuracy: Number(acc.toFixed(4)), noteShown, log: log.slice(0, 300), ocrOk, consoleErrors: errors, failedRequests: failed };
    console.log('TOOL m16 OCR chain image accuracy:', acc.toFixed(4), '| note shown:', noteShown);
    if (!ocrOk || errors.length || failed.length) throw new Error('m16 OCR chain image gate failed: ' + JSON.stringify(results.tools.m16OcrChainImage));
    await page.close();

    const p2 = await openPage(BASE + '/workflows/');
    await p2.page.select('#wf-tool', 'ocr');
    await p2.page.click('#wf-add');
    const input2 = await p2.page.$('#wf-file');
    await input2.uploadFile(path.join(CORPUS, 'test-scanned-ocr.pdf'));
    await p2.page.waitForFunction(() => !document.getElementById('wf-run').disabled, { timeout: 30000 });
    await p2.page.click('#wf-run');
    await p2.page.waitForFunction(() => !!document.querySelector('#wf-outputs textarea'), { timeout: 420000 });
    const pdfText = await p2.page.$eval('#wf-outputs textarea', (el) => el.value);
    const pdfOk = pdfText.includes('INVOICE') && pdfText.includes('2026-TEST-0042');
    results.tools.m16OcrChainPdf = { hasInvoice: pdfText.includes('INVOICE'), hasNumber: pdfText.includes('2026-TEST-0042'), chars: pdfText.length, pdfOk, consoleErrors: p2.errors, failedRequests: p2.failed };
    console.log('TOOL m16 OCR chain pdf:', JSON.stringify(results.tools.m16OcrChainPdf));
    if (!pdfOk || p2.errors.length || p2.failed.length) throw new Error('m16 OCR chain PDF gate failed: ' + JSON.stringify(results.tools.m16OcrChainPdf));
    await p2.page.close();
  }

  // Seller chain: remove the background alone (full-size cutout,
  // alpha-sampled like the standalone gate), then the one-click
  // starter (cut out -> 50 KB see-through PNG), one file pick.
  {
    await relaunch();
    const samplePng = async (href) => {
      const blob = await (await fetch(href)).blob();
      const bmp = await createImageBitmap(blob);
      const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
      const ctx = c.getContext('2d'); ctx.drawImage(bmp, 0, 0);
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      const px = (x, y) => d[(y * c.width + x) * 4 + 3];
      let trans = 0, opaque = 0;
      for (let i = 3; i < d.length; i += 4) { if (d[i] < 16) trans++; else if (d[i] > 240) opaque++; }
      const n = c.width * c.height;
      return { type: blob.type, size: blob.size, w: c.width, h: c.height,
        corners: [px(8, 8), px(c.width - 9, 8), px(8, c.height - 9), px(c.width - 9, c.height - 9)],
        transFrac: +(trans / n).toFixed(3), opaqueFrac: +(opaque / n).toFixed(3) };
    };
    const { page, errors, failed } = await openPage(BASE + '/workflows/');
    await page.select('#wf-tool', 'remove-bg');
    await page.click('#wf-add');
    const input = await page.$('#wf-file');
    await input.uploadFile(path.join(CORPUS, 'test-bg-hard.png'));
    await page.waitForFunction(() => !document.getElementById('wf-run').disabled, { timeout: 30000 });
    await page.click('#wf-run');
    await page.waitForFunction(() => !!document.querySelector('#wf-outputs a'), { timeout: 900000 });
    const href1 = await page.evaluate(() => document.querySelector('#wf-outputs a').href);
    const cut = await page.evaluate(samplePng, href1);
    const log1 = await page.$eval('#wf-log', (el) => el.textContent);
    const cutOk = cut.type === 'image/png' && cut.w === 1200 && cut.h === 900
      && cut.corners.every((a) => a < 16) && cut.transFrac > 0.05 && cut.opaqueFrac > 0.05;
    console.log('TOOL m16 seller cutout alone:', JSON.stringify(cut));
    await page.click('[data-starter="starter-seller-cutouts"]');
    await page.waitForFunction(() => document.querySelectorAll('#wf-steps > div').length === 2, { timeout: 15000 });
    await page.waitForFunction(() => !document.getElementById('wf-run').disabled, { timeout: 30000 });
    await page.click('#wf-run');
    await page.waitForFunction((h) => {
      const a = document.querySelector('#wf-outputs a');
      return !!a && a.href !== h && !document.getElementById('wf-result').classList.contains('hidden');
    }, { timeout: 900000 }, href1);
    const href2 = await page.evaluate(() => document.querySelector('#wf-outputs a').href);
    const seller = await page.evaluate(samplePng, href2);
    const log2 = await page.$eval('#wf-log', (el) => el.textContent);
    const sellerOk = seller.type === 'image/png' && seller.size <= 50 * 1024 && seller.w < 1200
      && seller.corners.every((a) => a < 16) && seller.transFrac > 0.05;
    results.tools.m16SellerChain = { cutoutOnly: cut, cutOk, seller, sellerOk, logTail: log2.slice(-400), consoleErrors: errors, failedRequests: failed };
    console.log('TOOL m16 seller chain final:', JSON.stringify(seller));
    if (!cutOk || !sellerOk || errors.length || failed.length) throw new Error('m16 seller chain gate failed: ' + JSON.stringify(results.tools.m16SellerChain));
    await page.screenshot({ path: path.join(SHOTS, 'm16-workflows-desktop.png'), fullPage: true });
    await page.setViewport({ width: 390, height: 844 });
    await new Promise((r) => setTimeout(r, 300));
    await page.screenshot({ path: path.join(SHOTS, 'm16-workflows-mobile.png'), fullPage: true });
    await page.setViewport({ width: 1280, height: 900 });
    await page.close();
  }

  // 13. Milestone 17: the quality-proof page. The gallery itself was
  // produced by driving the shipped tool page (verify/
  // m17-make-gallery.mjs) and finished by verify/m17-finish-gallery.py;
  // verify/m17-check.py re-derives every claim from the files in dist
  // (byte-identity back to the sources and the tool's own blobs,
  // dimension equality, crop pixels matching the recorded box in the
  // ground image). Here the page itself is loaded clean and shot.
  {
    const checkOut = execFileSync('python3', [path.join(HERE, 'm17-check.py')], { encoding: 'utf8' });
    console.log(checkOut.trim().split('\n').pop());
    results.tools.m17ProofCheck = { passed: checkOut.includes('M17 CHECK: ALL PASSED') };
    const { page, errors, failed } = await openPage(BASE + '/remove-background/quality/');
    const linked = await page.evaluate(() => ({
      fromTool: !!document.querySelector('a[href="/remove-background/"]'),
      imgs: document.querySelectorAll('img[src^="/proof/"]').length,
    }));
    results.tools.m17ProofPage = { ...linked, consoleErrors: errors, failedRequests: failed };
    console.log('TOOL m17 proof page:', JSON.stringify(results.tools.m17ProofPage));
    if (!results.tools.m17ProofCheck.passed || linked.imgs !== 18 || errors.length || failed.length) {
      throw new Error('m17 proof gate failed: ' + JSON.stringify(results.tools.m17ProofPage));
    }
    await page.screenshot({ path: path.join(SHOTS, 'm17-quality-desktop.png'), fullPage: true });
    await page.setViewport({ width: 390, height: 844 });
    await new Promise((r) => setTimeout(r, 300));
    await page.screenshot({ path: path.join(SHOTS, 'm17-quality-mobile.png'), fullPage: true });
    await page.setViewport({ width: 1280, height: 900 });
    await page.close();
  }

  // 14. Milestone 18: the round-2 fix round. New gates for A (HEIC
  // through the remover: single, batch, chain), C (corrected text in
  // the searchable PDF, end to end), F (the printed landings are this
  // harness's own outputs), G (fast-lane doors), H (true redirects),
  // I (metadata human-readable dates), J (the 12-character floor).
  const M18 = path.join(HERE, 'fixtures', 'm18');
  const fmtB = (n) => {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1).replace(/\.0$/, '') + ' KB';
    return (n / (1024 * 1024)).toFixed(2) + ' MB';
  };
  const samplePng18 = async (href) => {
    const blob = await (await fetch(href)).blob();
    const bmp = await createImageBitmap(blob);
    const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
    const ctx = c.getContext('2d'); ctx.drawImage(bmp, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    const px = (x, y) => d[(y * c.width + x) * 4 + 3];
    let trans = 0, opaque = 0;
    for (let i = 3; i < d.length; i += 4) { if (d[i] < 16) trans++; else if (d[i] > 240) opaque++; }
    const n = c.width * c.height;
    return { type: blob.type, size: blob.size, w: c.width, h: c.height,
      corners: [px(8, 8), px(c.width - 9, 8), px(8, c.height - 9), px(c.width - 9, c.height - 9)],
      transFrac: +(trans / n).toFixed(3), opaqueFrac: +(opaque / n).toFixed(3) };
  };
  {
    // A1: a HEIC fixture through the single-photo remover, then its
    // JPG twin on the same page (the model session is reused). The
    // two cutouts must be the same alpha profile class.
    await relaunch();
    const { page, errors, failed } = await openPage(BASE + '/remove-background/');
    await page.setViewport({ width: 1280, height: 900 });
    const input = await page.$('#bg-file');
    await input.uploadFile(path.join(M18, 'bg-twin.heic'));
    await page.waitForFunction(() => !document.getElementById('bg-run').disabled, { timeout: 120000 });
    const specText = await page.$eval('#bg-spec', (el) => el.textContent);
    await page.screenshot({ path: path.join(SHOTS, 'm18-remove-background-heic-desktop.png'), fullPage: true });
    await page.setViewport({ width: 390, height: 844 });
    await new Promise((r) => setTimeout(r, 300));
    await page.screenshot({ path: path.join(SHOTS, 'm18-remove-background-heic-mobile.png'), fullPage: true });
    await page.setViewport({ width: 1280, height: 900 });
    await page.click('#bg-run');
    await shown(page, 'bg-result', 900000);
    const hrefH = await page.evaluate(() => document.getElementById('bg-after-img').src);
    const cutHeic = await page.evaluate(samplePng18, hrefH);
    await input.uploadFile(path.join(M18, 'bg-twin.jpg'));
    await page.waitForFunction(() => !document.getElementById('bg-run').disabled, { timeout: 30000 });
    await page.click('#bg-run');
    await page.waitForFunction((h) => {
      const img = document.getElementById('bg-after-img');
      return !!img && img.src !== h && !document.getElementById('bg-result').classList.contains('hidden');
    }, { timeout: 900000 }, hrefH);
    const hrefJ = await page.evaluate(() => document.getElementById('bg-after-img').src);
    const cutJpg = await page.evaluate(samplePng18, hrefJ);
    const sameClass = cutHeic.w === cutJpg.w && cutHeic.h === cutJpg.h
      && cutHeic.corners.every((a) => a < 16) && cutJpg.corners.every((a) => a < 16)
      && cutHeic.opaqueFrac > 0.05 && cutJpg.opaqueFrac > 0.05
      && Math.abs(cutHeic.transFrac - cutJpg.transFrac) <= 0.06;
    results.tools.m18HeicRemover = { specShowsHeic: specText.includes('HEIC'), cutHeic, cutJpg, sameClass, consoleErrors: errors, failedRequests: failed };
    console.log('TOOL m18 HEIC remover:', JSON.stringify({ specShowsHeic: specText.includes('HEIC'), cutHeic, cutJpg, sameClass }));
    if (!specText.includes('HEIC') || !sameClass || errors.length || failed.length) throw new Error('m18 HEIC remover gate failed: ' + JSON.stringify(results.tools.m18HeicRemover));
    await page.close();
  }
  {
    // A2: the batch remover takes the HEIC fixture and cuts it out.
    const { page, errors, failed } = await openPage(BASE + '/batch-remove-background/');
    const input = await page.$('#bb-file');
    await input.uploadFile(path.join(M18, 'bg-twin.heic'));
    await page.waitForFunction(() => !document.getElementById('bb-run').disabled, { timeout: 120000 });
    const listText = await page.$eval('#bb-list', (el) => el.textContent.replace(/\s+/g, ' '));
    await page.click('#bb-run');
    await shown(page, 'bb-result', 900000);
    const rowsText = await page.$eval('#bb-rows', (el) => el.textContent.replace(/\s+/g, ' '));
    const ok = listText.includes('1200 x 900') && rowsText.includes('cut out at full size 1200x900');
    results.tools.m18HeicBatch = { listText, rowsText: rowsText.slice(0, 200), ok, consoleErrors: errors, failedRequests: failed };
    console.log('TOOL m18 HEIC batch:', JSON.stringify(results.tools.m18HeicBatch));
    if (!ok || errors.length || failed.length) throw new Error('m18 HEIC batch gate failed: ' + JSON.stringify(results.tools.m18HeicBatch));
    await page.close();
  }
  {
    // A3: the workflows remove-bg step takes the HEIC fixture.
    const { page, errors, failed } = await openPage(BASE + '/workflows/');
    await page.select('#wf-tool', 'remove-bg');
    await page.click('#wf-add');
    const input = await page.$('#wf-file');
    await input.uploadFile(path.join(M18, 'bg-twin.heic'));
    await page.waitForFunction(() => !document.getElementById('wf-run').disabled, { timeout: 30000 });
    await page.click('#wf-run');
    await page.waitForFunction(() => !!document.querySelector('#wf-outputs a'), { timeout: 900000 });
    const href = await page.evaluate(() => document.querySelector('#wf-outputs a').href);
    const cut = await page.evaluate(samplePng18, href);
    const ok = cut.type === 'image/png' && cut.w === 1200 && cut.h === 900
      && cut.corners.every((a) => a < 16) && cut.transFrac > 0.05 && cut.opaqueFrac > 0.05;
    results.tools.m18HeicChain = { cut, ok, consoleErrors: errors, failedRequests: failed };
    console.log('TOOL m18 HEIC chain:', JSON.stringify(cut));
    if (!ok || errors.length || failed.length) throw new Error('m18 HEIC chain gate failed: ' + JSON.stringify(results.tools.m18HeicChain));
    await page.close();
  }
  {
    // C: OCR the corpus invoice, correct the decimal in the box,
    // download the searchable PDF, and read its text layer back with
    // PDF.js: the correction must be there, the flawed read must not.
    const { page, errors, failed } = await openPage(BASE + '/ocr-pdf/');
    const input = await page.$('#oc-file');
    await input.uploadFile(path.join(CORPUS, 'test-scanned-ocr.pdf'));
    await page.waitForFunction(() => !document.getElementById('oc-run').disabled, { timeout: 60000 });
    await page.click('#oc-run');
    await shown(page, 'oc-result', 420000);
    const rawText = await page.$eval('#oc-text', (el) => el.value);
    let from = null, to = null;
    if (rawText.includes('12450')) { from = '12450'; to = '124.50'; }
    else if (rawText.includes('124.50')) { from = '124.50'; to = '124.75'; }
    if (!from) throw new Error('m18 OCR gate: the fixture read carries neither 12450 nor 124.50: ' + rawText.slice(0, 200));
    await page.$eval('#oc-text', (el, [f, t]) => { el.value = el.value.replace(f, t); }, [from, to]);
    const dlDir = path.join(HERE, 'downloads-m18');
    fs.rmSync(dlDir, { recursive: true, force: true });
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
    if (!dlFile) throw new Error('m18 OCR gate: the searchable PDF download never arrived');
    const statusText = await page.$eval('#oc-status', (el) => el.textContent);
    const b64 = fs.readFileSync(dlFile).toString('base64');
    const layerText = await page.evaluate(async (b) => {
      const bin = atob(b);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      const pdfjsLib = await import(/* @vite-ignore */ '/pdfjs/pdf.min.mjs');
      pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.min.mjs';
      const doc = await pdfjsLib.getDocument({ data: arr }).promise;
      let out = '';
      for (let p = 1; p <= doc.numPages; p++) {
        const pg = await doc.getPage(p);
        const tc = await pg.getTextContent();
        out += tc.items.map((it) => it.str).join(' ') + '\n';
      }
      return out;
    }, b64);
    const carriesFix = layerText.includes(to);
    const flawGone = !layerText.replace(/\s+/g, ' ').includes(from === '12450' ? '12450' : '124.50');
    // When from is 124.50 and to is 124.75, the layer must not carry
    // the uncorrected 124.50 either; the check above uses `from`.
    const ok = carriesFix && flawGone && statusText.includes('carries your corrected text');
    results.tools.m18OcrCorrectedPdf = { from, to, carriesFix, flawGone, statusText, layerSample: layerText.slice(0, 200), consoleErrors: errors, failedRequests: failed };
    console.log('TOOL m18 OCR corrected PDF:', JSON.stringify({ from, to, carriesFix, flawGone, statusText }));
    if (!ok || errors.length || failed.length) throw new Error('m18 OCR corrected-PDF gate failed: ' + JSON.stringify(results.tools.m18OcrCorrectedPdf));
    await page.close();
  }
  {
    // F: the two landings printed on the 100 KB and 50 KB doors are
    // this harness's own outputs on the standard corpus photo PDF.
    const landings = {};
    for (const [door, target] of [['compress-pdf-to-100kb', '100 KB'], ['compress-pdf-to-50kb', '50 KB']]) {
      const { page, errors, failed } = await openPage(BASE + '/' + door + '/');
      const input = await page.$('#cp-file');
      await input.uploadFile(PHOTO_PDF);
      await page.waitForFunction(() => !document.getElementById('cp-run').disabled, { timeout: 30000 });
      await page.click('#cp-run');
      await shown(page, 'cp-result', 420000);
      const size = await page.evaluate(async () => {
        const href = document.getElementById('cp-download').href;
        const buf = await (await fetch(href)).arrayBuffer();
        return buf.byteLength;
      });
      const bodyText = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
      const printed = 'landed at ' + fmtB(size);
      const printedOk = bodyText.includes(printed);
      const pointersOk = bodyText.includes('Compress PDF, strong') && bodyText.includes('Split PDF');
      landings[door] = { target, outputBytes: size, printed, printedOk, pointersOk, consoleErrors: errors, failedRequests: failed };
      console.log('TOOL m18 landing', door, ':', size, 'bytes | printed claim:', printed, '| on page:', printedOk, '| pointers:', pointersOk);
      if (!printedOk || !pointersOk || errors.length || failed.length) throw new Error('m18 landing gate failed for ' + door + ': ' + JSON.stringify(landings[door]));
      await page.close();
    }
    results.tools.m18Landings = landings;
  }
  {
    // G: the homepage fast lanes carry the four problem-worded doors,
    // and each one lands on the tool it promises.
    const { page, errors, failed } = await openPage(BASE + '/');
    await page.setViewport({ width: 1280, height: 900 });
    const lanes = await page.evaluate(() => [...document.querySelectorAll('.fast-lane a')].map((a) => ({ href: a.getAttribute('href'), text: a.textContent.trim() })));
    const want = [
      ['/compress-image/', 'Shrink a photo for a form', 'Compress image'],
      ['/heic-to-jpg/', 'iPhone photo will not upload', 'HEIC'],
      ['/compress-pdf-to-50kb/', 'visa or portal limit', '50 KB'],
      ['/remove-background/', 'Cut out a product photo', 'Remove background'],
    ];
    const lanesOk = want.every(([href, words]) => lanes.some((l) => l.href === href && l.text.includes(words)));
    await page.screenshot({ path: path.join(SHOTS, 'm18-home-fastlanes-desktop.png') });
    await page.setViewport({ width: 390, height: 844 });
    await new Promise((r) => setTimeout(r, 300));
    await page.screenshot({ path: path.join(SHOTS, 'm18-home-fastlanes-mobile.png') });
    await page.setViewport({ width: 1280, height: 900 });
    const landingsOk = [];
    for (const [href, , h1part] of want) {
      const p2 = await openPage(BASE + href);
      const h1 = await p2.page.$eval('h1', (el) => el.textContent);
      landingsOk.push({ href, h1, ok: h1.includes(h1part), errors: p2.errors, failed: p2.failed });
      await p2.page.close();
    }
    const allLand = landingsOk.every((l) => l.ok && !l.errors.length && !l.failed.length);
    results.tools.m18FastLanes = { lanes, lanesOk, landingsOk, allLand, consoleErrors: errors, failedRequests: failed };
    console.log('TOOL m18 fast lanes:', JSON.stringify({ lanes, lanesOk, allLand }));
    if (!lanesOk || !allLand || errors.length || failed.length) throw new Error('m18 fast-lane gate failed: ' + JSON.stringify(results.tools.m18FastLanes));
    await page.close();
  }
  {
    // H: the short language URLs are true redirects now: the rules
    // file ships, and no stub page shadows them.
    const redirects = fs.readFileSync(path.join(DIST, '_redirects'), 'utf8');
    const hOk = redirects.includes('/es/quitar-fondo/ /es/quitar-fondo-de-imagen-gratis/ 301')
      && redirects.includes('/pt/remover-fundo/ /pt-br/remover-fundo-de-imagem-gratis/ 301')
      && !fs.existsSync(path.join(DIST, 'es', 'quitar-fondo'))
      && !fs.existsSync(path.join(DIST, 'pt', 'remover-fundo'));
    results.tools.m18Redirects = { hOk };
    console.log('TOOL m18 redirects:', hOk);
    if (!hOk) throw new Error('m18 redirect gate failed');
  }
  {
    // I: the metadata table reads the stored dates out in plain
    // words beside the raw stored form (the m13 fixture's own dates).
    const { page, errors, failed } = await openPage(BASE + '/pdf-metadata/');
    const input = await page.$('#md-file');
    await input.uploadFile(path.join(HERE, 'fixtures', 'm13', 'meta.pdf'));
    await page.waitForFunction(() => !document.getElementById('md-strip').disabled, { timeout: 30000 });
    const viewText = await page.$eval('#md-view', (el) => el.textContent.replace(/\s+/g, ' '));
    const datesOk = viewText.includes('D:20250115103000') && viewText.includes('read as: 15 January 2025, 10:30:00')
      && viewText.includes('D:20250620081500') && viewText.includes('read as: 20 June 2025, 08:15:00');
    results.tools.m18MetaDates = { datesOk, viewSample: viewText.slice(0, 300), consoleErrors: errors, failedRequests: failed };
    console.log('TOOL m18 metadata dates:', datesOk, '|', viewText.slice(0, 240));
    if (!datesOk || errors.length) throw new Error('m18 metadata dates gate failed: ' + JSON.stringify(results.tools.m18MetaDates));
    await page.close();
  }
  {
    // J: the protect floor is enforced: a 10-character password is
    // refused before anything runs, with the reason stated.
    const { page, errors, failed } = await openPage(BASE + '/protect-pdf/');
    const input = await page.$('#pt-file');
    await input.uploadFile(path.join(CORPUS, 'test-3page-second.pdf'));
    await page.waitForFunction(() => !document.getElementById('pt-run').disabled, { timeout: 30000 });
    await page.type('#pt-pw1', 'short-pw-1');
    await page.type('#pt-pw2', 'short-pw-1');
    await page.click('#pt-run');
    await new Promise((r) => setTimeout(r, 800));
    const statusText = await page.$eval('#pt-status', (el) => el.textContent);
    const stillHidden = await page.evaluate(() => document.getElementById('pt-result').classList.contains('hidden'));
    const floorOk = statusText.includes('minimum here is 12') && stillHidden;
    results.tools.m18ProtectFloor = { statusText, stillHidden, floorOk, consoleErrors: errors, failedRequests: failed };
    console.log('TOOL m18 protect floor:', JSON.stringify({ statusText, floorOk }));
    if (!floorOk || errors.length) throw new Error('m18 protect floor gate failed: ' + JSON.stringify(results.tools.m18ProtectFloor));
    await page.close();
  }
  {
    // 15. Milestone 19: GA4.
    // (a) The homepage fires exactly the GA collect for the shipped
    // measurement ID: one library request to googletagmanager.com
    // carrying the ID, then exactly one collect to
    // www.google-analytics.com carrying tid=<ID> and en=page_view
    // (recorded by the harness interception; see the header note for
    // why the endpoint is a recorded stand-in in this sandbox).
    // (b) The privacy page names the counter and the opt-out.
    // (c) A background-removal run still sends no file anywhere, in
    // the witness's updated form: while the job runs, no request
    // carries a body, and the only cross-origin requests are the
    // counter's own (which fire at page load, before the run).
    const { page, errors, failed, ga } = await openPage(BASE + '/');
    const collectUrl = ga.collects.length === 1 ? new URL(ga.collects[0]) : null;
    const gaHomeOk = ga.js.length === 1 && ga.js[0].startsWith('https://www.googletagmanager.com/gtag/js?id=' + GA_ID)
      && !!collectUrl && collectUrl.hostname === 'www.google-analytics.com'
      && collectUrl.searchParams.get('tid') === GA_ID && collectUrl.searchParams.get('en') === 'page_view';
    results.tools.m19GaHome = { ga, gaHomeOk, consoleErrors: errors, failedRequests: failed };
    console.log('TOOL m19 GA homepage:', JSON.stringify({ js: ga.js.length, collects: ga.collects.length, gaHomeOk }));
    if (!gaHomeOk || errors.length) throw new Error('m19 GA homepage gate failed: ' + JSON.stringify(results.tools.m19GaHome));
    await page.close();

    const priv = await openPage(BASE + '/privacy/');
    const privText = await priv.page.$eval('body', (el) => el.innerText);
    const privOk = privText.includes('Google Analytics') && privText.includes('opt-out')
      && !privText.includes('no analytics script') && !privText.includes('no analytics or ad script');
    await priv.page.setViewport({ width: 1280, height: 900 });
    await priv.page.screenshot({ path: path.join(SHOTS, 'm19-privacy-desktop.png'), fullPage: true });
    results.tools.m19Privacy = { privOk, consoleErrors: priv.errors, failedRequests: priv.failed };
    console.log('TOOL m19 privacy wording:', privOk);
    if (!privOk || priv.errors.length) throw new Error('m19 privacy gate failed: ' + JSON.stringify(results.tools.m19Privacy));
    await priv.page.close();

    const bg = await openPage(BASE + '/remove-background/');
    const duringRun = [];
    bg.page.on('request', (r) => {
      let body = null;
      try { body = r.postData(); } catch { /* not readable for every type */ }
      duringRun.push({ method: r.method(), url: r.url(), hasBody: !!body });
    });
    const input = await bg.page.$('#bg-file');
    await input.uploadFile(path.join(CORPUS, 'test-bg-hard.png'));
    await bg.page.waitForFunction(() => !document.getElementById('bg-run').disabled, { timeout: 15000 });
    duringRun.length = 0; // the run window starts at the Run click; page-load traffic (incl. the counter) is before it
    await bg.page.click('#bg-run');
    await bg.page.waitForFunction(() => {
      const r = document.getElementById('bg-result');
      const n = document.getElementById('bg-nosubject');
      return (r && !r.classList.contains('hidden')) || (n && !n.classList.contains('hidden'));
    }, { timeout: 420000 });
    const isCounterHost = (u) => { try { const h = new URL(u).hostname; return h === 'www.googletagmanager.com' || h === 'www.google-analytics.com' || h.endsWith('.google-analytics.com'); } catch { return false; } };
    const withBodyReqs = duringRun.filter((r) => r.hasBody);
    // Only http(s) requests can leave the machine. data: and blob:
    // URLs are generated inside the page (the design's grain texture
    // is a data: SVG; tool results are blob: URLs) and their URL
    // origin reads "null", which an earlier form of this filter
    // counted as cross-origin and failed a clean run on the grain
    // texture alone; the classification is restricted to http(s)
    // here for exactly that reason, and offending URLs are recorded
    // with the result so a failure explains itself.
    const crossOriginReqs = duringRun.filter((r) => { if (!/^https?:\/\//.test(r.url)) return false; try { return new URL(r.url).origin !== new URL(BASE).origin; } catch { return true; } });
    const strayCrossOrigin = crossOriginReqs.filter((r) => !isCounterHost(r.url));
    const bgSendOk = withBodyReqs.length === 0 && strayCrossOrigin.length === 0;
    results.tools.m19BgSendsNothing = {
      requestsDuringRun: duringRun.length, withBody: withBodyReqs.length,
      crossOrigin: crossOriginReqs.map((r) => r.url.slice(0, 110)), strayCrossOrigin: strayCrossOrigin.map((r) => r.url.slice(0, 110)),
      bgSendOk, consoleErrors: bg.errors, failedRequests: bg.failed,
    };
    console.log('TOOL m19 BG run sends:', JSON.stringify({ total: duringRun.length, withBody: withBodyReqs.length, crossOrigin: crossOriginReqs.length, bgSendOk }));
    if (!bgSendOk || bg.errors.length) throw new Error('m19 BG sends-nothing gate failed: ' + JSON.stringify(results.tools.m19BgSendsNothing));
    await bg.page.close();
  }
  {
    // 16. Milestone 22: tool first on every tool page + the 404
    // page's build-side facts.
    // (a) Static order gate over the built HTML of all 49 reordered
    // tool pages: the tool block (its section id, the bg-tool section,
    // or the convert door's tray) must appear BEFORE the steps strip
    // in document order, and the steps strip must still be present
    // (nothing was deleted, only reordered). This gate asserts the NEW
    // order deliberately: before milestone 22 the milestone-8 order
    // (steps above the tool) was the design; the owner reversed it.
    // (b) Browser evidence on a sample (EN section tool, ES flagship,
    // convert door): the tray's rendered top sits above the steps
    // strip's rendered top. Screenshots for EN compress-pdf on
    // desktop and mobile are written as m22-* evidence.
    // (c) 404 build facts: dist/404.html exists, carries the noindex
    // robots meta and the branded title, and the sitemap still lists
    // exactly the 68 content routes with no /404/ entry. (The live
    // 404 STATUS is a hosting behaviour, verified separately under
    // wrangler pages dev: unknown paths and missing assets returned
    // 404 with this page; routes and the two 301s unchanged.)
    const M22_ROUTES = ['/batch-compress-images/', '/batch-compress-pdf/', '/batch-convert-images/',
      '/batch-merge-pdf/', '/batch-remove-background/', '/batch-resize-images/', '/batch-split-pdf/',
      '/compress-image-to-50kb/', '/compress-image/', '/compress-pdf-strong/', '/compress-pdf-to-100kb/',
      '/compress-pdf-to-1mb/', '/compress-pdf-to-200kb/', '/compress-pdf-to-500kb/', '/compress-pdf-to-50kb/',
      '/compress-pdf/', '/extract-images-pdf/', '/flatten-pdf/', '/heic-to-jpg/', '/interleave-pdf/',
      '/jpg-to-pdf/', '/merge-pdf/', '/ocr-image/', '/ocr-pdf/', '/organize-pdf/', '/pdf-metadata/',
      '/pdf-page-numbers/', '/pdf-to-jpg/', '/protect-pdf/', '/resize-image/', '/rotate-pdf/',
      '/sign-pdf/', '/size-checker/', '/split-pdf/', '/unlock-pdf/', '/watermark-pdf/', '/workflows/',
      '/remove-background/', '/remove-background-full-resolution/',
      '/es/quitar-fondo-de-imagen-gratis/', '/es/quitar-fondo-resolucion-completa/',
      '/pt-br/remover-fundo-de-imagem-gratis/', '/pt-br/alternativa-gratis-ao-remove-bg/',
      '/jpg-to-png/', '/jpg-to-webp/', '/png-to-jpg/', '/png-to-webp/', '/webp-to-jpg/', '/webp-to-png/'];
    const orderFails = [];
    for (const r of M22_ROUTES) {
      const h = fs.readFileSync(path.join(DIST, r.slice(1) + 'index.html'), 'utf8');
      const stepsAt = h.indexOf('steps-strip');
      let toolAt = h.indexOf('id="bg-tool"');
      if (toolAt < 0) toolAt = h.indexOf('id="cv-tray"');
      if (toolAt < 0) { const m = h.match(/id="[a-z]+-(tool|panel)"/); toolAt = m ? m.index : -1; }
      if (stepsAt < 0 || toolAt < 0 || toolAt > stepsAt) orderFails.push(`${r} :: tool@${toolAt} steps@${stepsAt}`);
    }
    results.tools.m22Order = { routes: M22_ROUTES.length, orderFails };
    console.log('TOOL m22 tool-first order:', M22_ROUTES.length, 'routes | fails:', orderFails.length);
    if (orderFails.length) throw new Error('m22 order gate failed: ' + orderFails.join(' | '));

    const sample = [['/compress-pdf/', '#cp-tray'], ['/es/quitar-fondo-de-imagen-gratis/', '#bg-tray'], ['/jpg-to-png/', '#cv-tray']];
    const tops = {};
    for (const [route, traySel] of sample) {
      const s = await openPage(BASE + route);
      const t = await s.page.evaluate((sel) => {
        const tray = document.querySelector(sel);
        const strip = document.querySelector('.steps-strip');
        return { trayTop: tray ? tray.getBoundingClientRect().top + window.scrollY : null,
                 stepsTop: strip ? strip.getBoundingClientRect().top + window.scrollY : null };
      }, traySel);
      tops[route] = t;
      if (!(t.trayTop !== null && t.stepsTop !== null && t.trayTop < t.stepsTop)) {
        throw new Error('m22 rendered-order gate failed on ' + route + ': ' + JSON.stringify(t));
      }
      if (route === '/compress-pdf/') {
        await s.page.setViewport({ width: 1280, height: 900 });
        await new Promise((r) => setTimeout(r, 400));
        await s.page.screenshot({ path: path.join(SHOTS, 'm22-compress-pdf-desktop.png') });
        await s.page.setViewport({ width: 390, height: 844 });
        await new Promise((r) => setTimeout(r, 400));
        await s.page.screenshot({ path: path.join(SHOTS, 'm22-compress-pdf-mobile.png') });
      }
      await s.page.close();
    }
    results.tools.m22RenderedTops = tops;
    console.log('TOOL m22 rendered tops:', JSON.stringify(tops));

    const nf = fs.existsSync(path.join(DIST, '404.html')) ? fs.readFileSync(path.join(DIST, '404.html'), 'utf8') : '';
    const sm22 = fs.readFileSync(path.join(DIST, 'sitemap.xml'), 'utf8');
    const nfOk = nf.includes('name="robots" content="noindex"') && nf.includes('Page not found')
      && (sm22.match(/<loc>/g) || []).length === 68 && !sm22.includes('404');
    results.tools.m22NotFound = { nfOk, sitemapLocs: (sm22.match(/<loc>/g) || []).length };
    console.log('TOOL m22 404 build facts:', JSON.stringify(results.tools.m22NotFound));
    if (!nfOk) throw new Error('m22 404 gate failed: ' + JSON.stringify(results.tools.m22NotFound));
  }
} finally {
  if (browser) await browser.close();
  server.close();
}
fs.writeFileSync(path.join(HERE, 'results.json'), JSON.stringify(results, null, 2));
console.log('VERIFY DONE');
