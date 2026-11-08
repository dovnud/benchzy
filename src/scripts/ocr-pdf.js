// OCR PDF: read a scanned PDF and give back its text.
// Engines, exactly as measured in bench/BENCH-RESULTS.md (round 2):
// PDF.js renders every page at 300 DPI (at 200 DPI the same page fell to
// 61.5% character accuracy; at 300 DPI it reads 96.1%), then Tesseract.js
// recognises the render. The bench's honesty rule ships with it: this
// WASM build dropped the decimal points in money amounts on a clean test
// invoice (124.50 read as 12450), so the text is shown in an editable box
// for checking before it is downloaded, never silently trusted.
// Output: the checked text as .txt, plus a searchable PDF (the page image
// with the recognised text laid invisibly over it, word by word).
import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import { fmtBytes, recordJob, wireTray } from './workbench.js';

const $ = (id) => document.getElementById(id);
const tray = $('oc-tray'), input = $('oc-file'), spec = $('oc-spec');
const runBtn = $('oc-run'), status = $('oc-status'), result = $('oc-result');
const textBox = $('oc-text');
const DPI = 300, SCALE = DPI / 72, MAX_PAGES = 50;
let file = null, fileBytes = null, pageCount = 0, running = false;
let worker = null, pagesData = []; // { text, words:[{text,x0,y0,x1,y1}], png:Uint8Array, wPx, hPx }

function setStatus(msg) { status.textContent = msg; }
function setSpec(rows) {
  spec.innerHTML = rows.map(([k, v]) => `<div class="spec-row"><dt>${k}</dt><dd>${v}</dd></div>`).join('');
}

wireTray(tray, input, async (f) => {
  result.classList.add('hidden');
  runBtn.disabled = true;
  file = f;
  pagesData = [];
  try {
    fileBytes = new Uint8Array(await f.arrayBuffer());
    const pdfjs = await loadPdfjs();
    const pdf = await pdfjs.getDocument({ data: fileBytes.slice() }).promise;
    pageCount = pdf.numPages;
    try { await pdf.loadingTask.destroy(); } catch (e) { /* already gone */ }
    setSpec([
      ['file', f.name],
      ['size now', fmtBytes(f.size)],
      ['pages', String(pageCount)],
      ['reading depth', '300 DPI renders'],
    ]);
    if (pageCount > MAX_PAGES) {
      setStatus('That is ' + pageCount + ' pages. This page reads up to ' + MAX_PAGES + ' at a time; split the file first (the Split PDF tool) and read it in parts.');
    } else {
      setStatus('Ready. Reading happens here in the page; the first run loads the reading engine (about 10 MB, once).');
      runBtn.disabled = false;
    }
  } catch (err) {
    setStatus('That file could not be read as a PDF: ' + (err && err.message ? err.message : err));
  }
});

let pdfjsPromise = null;
function loadPdfjs() {
  if (!pdfjsPromise) {
    const url = '/pdfjs/pdf.min.mjs'; // self-hosted engine file; a variable keeps the bundler out of it
    pdfjsPromise = import(/* @vite-ignore */ url).then((m) => {
      m.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.min.mjs';
      return m;
    });
  }
  return pdfjsPromise;
}

async function getWorker() {
  if (worker) return worker;
  if (!window.Tesseract) throw new Error('the reading engine did not load');
  setStatus('Loading the reading engine (about 10 MB, once)…');
  worker = await window.Tesseract.createWorker('eng', window.Tesseract.OEM && window.Tesseract.OEM.LSTM_ONLY, {
    workerPath: '/tesseract/worker.min.js',
    corePath: '/tesseract/core',
    langPath: '/tesseract/lang',
    gzip: false,
    cacheMethod: 'none',
    logger: (m) => {
      if (m.status === 'recognizing text') setStatus('Reading the page… ' + Math.round(m.progress * 100) + '%');
    },
  });
  return worker;
}

function flattenWords(data) {
  const words = [];
  const push = (w) => {
    if (w && w.text && w.bbox) words.push({ text: w.text, x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1 });
  };
  if (data.words && data.words.length) { data.words.forEach(push); return words; }
  for (const block of data.blocks || []) {
    for (const para of block.paragraphs || []) {
      for (const line of para.lines || []) {
        (line.words || []).forEach(push);
      }
    }
  }
  return words;
}

runBtn.addEventListener('click', async () => {
  if (!file || !pageCount || running) return;
  running = true;
  runBtn.disabled = true;
  result.classList.add('hidden');
  pagesData = [];
  try {
    const pdfjs = await loadPdfjs();
    const pdf = await pdfjs.getDocument({ data: fileBytes.slice() }).promise;
    const w = await getWorker();
    const t0 = performance.now();
    for (let i = 1; i <= pageCount; i++) {
      setStatus('Rendering page ' + i + ' of ' + pageCount + ' at 300 DPI…');
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: SCALE });
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const ctx = canvas.getContext('2d');
      await page.render({ canvasContext: ctx, viewport }).promise;
      const pngBlob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
      const png = new Uint8Array(await pngBlob.arrayBuffer());
      setStatus('Reading page ' + i + ' of ' + pageCount + '…');
      const { data } = await w.recognize(pngBlob, {}, { blocks: true });
      pagesData.push({
        text: (data.text || '').trim(),
        words: flattenWords(data),
        png, wPx: canvas.width, hPx: canvas.height,
      });
      page.cleanup();
    }
    try { await pdf.loadingTask.destroy(); } catch (e) { /* already gone */ }
    const secs = ((performance.now() - t0) / 1000).toFixed(1);
    textBox.value = pagesData.map((p, i) => (pageCount > 1 ? '--- Page ' + (i + 1) + ' ---\n' : '') + p.text).join('\n\n');
    const chars = pagesData.reduce((a, p) => a + p.text.length, 0);
    $('oc-achieved').textContent =
      'Read ' + pageCount + ' page' + (pageCount === 1 ? '' : 's') + ', ' + chars + ' characters, in ' + secs + ' seconds. ' +
      'Check the text in the box before you use it, especially numbers: this engine has been caught dropping the decimal point in money amounts (124.50 read as 12450) on a clean test page. Fix anything in the box and the .txt download uses your corrected text.';
    result.classList.remove('hidden');
    const stamp = $('oc-stamp');
    stamp.classList.remove('land');
    void stamp.offsetWidth;
    stamp.classList.add('land');
    setStatus('Done.');
    recordJob({ tool: 'OCR PDF', name: file.name, detail: pageCount + ' pages, ' + chars + ' chars' });
  } catch (err) {
    setStatus('Something went wrong reading this file: ' + (err && err.message ? err.message : err));
  } finally {
    running = false;
    runBtn.disabled = pageCount > MAX_PAGES;
  }
});

$('oc-download-txt').addEventListener('click', () => {
  const blob = new Blob([textBox.value], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name.replace(/\.pdf$/i, '') + '-text.txt';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
});

// Searchable PDF: the rendered page, with the words laid over it at
// opacity 0 so the file can be searched and copied. Positions come from
// the recogniser's word boxes at 300 DPI, converted to points.
$('oc-download-pdf').addEventListener('click', async () => {
  if (!pagesData.length) return;
  setStatus('Building the searchable PDF…');
  try {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const px2pt = 72 / DPI;
    for (const p of pagesData) {
      const img = await doc.embedPng(p.png);
      const wPt = p.wPx * px2pt, hPt = p.hPx * px2pt;
      const page = doc.addPage([wPt, hPt]);
      page.drawImage(img, { x: 0, y: 0, width: wPt, height: hPt });
      for (const word of p.words) {
        const clean = word.text.replace(/[^\x20-\x7E]/g, '').trim();
        if (!clean) continue;
        const size = Math.min(72, Math.max(4, (word.y1 - word.y0) * px2pt));
        try {
          page.drawText(clean, {
            x: word.x0 * px2pt,
            y: hPt - word.y1 * px2pt,
            size, font, opacity: 0,
          });
        } catch (e) { /* one unprintable word never sinks the file */ }
      }
    }
    const bytes = await doc.save();
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name.replace(/\.pdf$/i, '') + '-searchable.pdf';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    setStatus('Done. The searchable PDF carries the text exactly as read; your edits in the box are in the .txt.');
  } catch (err) {
    setStatus('The searchable PDF could not be built: ' + (err && err.message ? err.message : err));
  }
});
