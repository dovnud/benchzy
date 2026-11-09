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
      setStatus('Ready. Reading happens here in the page; the first run loads the reading program (about 10 MB, one time only).');
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
  if (!window.Tesseract) throw new Error('the reading program did not load');
  setStatus('Loading the reading program (about 10 MB, one time only). It runs in your browser; your file is never uploaded…');
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
      'Check the text in the box before you use it, especially numbers: this reader has been caught dropping the decimal point in money amounts (124.50 read as 12450) on a clean test page. Fix anything in the box and both downloads use your corrected text: the searchable PDF places your edits back over the page, at the positions of the words they replaced. Keep the --- Page N --- lines in the box; they are how your edits find their page.';
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

// Corrected text into the searchable PDF (milestone 18, round-2
// Broken 3). The visitor fixes the read in the box; the searchable PDF
// must carry the FIXED text, not the raw read. Faithful re-placement
// works like this: the box text is split back into pages on the
// --- Page N --- lines the box itself was filled with; each page's
// corrected tokens are aligned to the recogniser's words by a longest
// common subsequence walk over normalised tokens. A corrected token
// that matches or replaces a read word is drawn at that word's box; a
// token the visitor inserted is drawn just after the word before it; a
// word the visitor deleted is simply not drawn. If the page markers
// were edited away, the split fails and the PDF falls back to the
// as-read layer, and the status line says so plainly.
function splitBoxPages(boxText, count) {
  if (count === 1) return [boxText];
  const parts = boxText.split(/^--- Page (\d+) ---\s*$/m);
  // parts: [pre, "1", text1, "2", text2, ...]
  if (parts.length !== 1 + count * 2) return null;
  if (parts[0].trim() !== '') return null;
  const pages = [];
  for (let i = 0; i < count; i++) {
    if (parseInt(parts[1 + i * 2], 10) !== i + 1) return null;
    pages.push(parts[2 + i * 2]);
  }
  return pages;
}
function tokenizeCorrected(text) {
  return (text.match(/\S+/g) || []).filter((t) => t.replace(/[^\x20-\x7E]/g, '').trim() !== '');
}
function normToken(t) {
  return t.toLowerCase().replace(/[^a-z0-9]+/g, '');
}
// Returns [{ text, x0, y0, x1, y1 }] in 300 DPI pixels, ready to draw.
function alignCorrectedWords(origWords, correctedTokens) {
  const a = origWords.map((w) => normToken(w.text));
  const b = correctedTokens.map((t) => normToken(t));
  const n = a.length, m = b.length;
  // LCS table.
  const dp = [];
  for (let i = 0; i <= n; i++) dp.push(new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  // Standard LCS backtrack into an op list: match / del (a read word
  // the visitor removed) / ins (a corrected token with no read word).
  const ops = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { ops.push({ t: 'match', i, j }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { ops.push({ t: 'del', i }); i++; }
    else { ops.push({ t: 'ins', j }); j++; }
  }
  while (i < n) { ops.push({ t: 'del', i }); i++; }
  while (j < m) { ops.push({ t: 'ins', j }); j++; }
  // A deletion immediately followed by an insertion at the same spot
  // is a substitution: the corrected token takes the read word's box.
  const out = [];
  let prev = null; // last placed box, for bare insertions
  const place = (text, box) => {
    const placed = { text, x0: box.x0, y0: box.y0, x1: box.x1, y1: box.y1 };
    out.push(placed);
    prev = placed;
  };
  for (let k = 0; k < ops.length; k++) {
    const op = ops[k];
    if (op.t === 'match') {
      place(correctedTokens[op.j], origWords[op.i]);
    } else if (op.t === 'del') {
      const next = ops[k + 1];
      if (next && next.t === 'ins') {
        place(correctedTokens[next.j], origWords[op.i]);
        k++;
      }
      // A bare deletion draws nothing.
    } else { // ins
      if (prev) {
        const gap = Math.max(2, (prev.x1 - prev.x0) * 0.08);
        place(correctedTokens[op.j], { x0: prev.x1 + gap, y0: prev.y0, x1: prev.x1 + gap + (prev.x1 - prev.x0), y1: prev.y1 });
      } else if (origWords.length) {
        const f = origWords[0];
        place(correctedTokens[op.j], { x0: f.x0, y0: f.y0, x1: f.x1, y1: f.y1 });
      }
    }
  }
  return out;
}

// Searchable PDF: the rendered page, with the words laid over it at
// opacity 0 so the file can be searched and copied. The words are the
// ones in the box, as corrected, placed back at the positions of the
// words they came from (see alignCorrectedWords above). Positions are
// the recogniser's word boxes at 300 DPI, converted to points.
$('oc-download-pdf').addEventListener('click', async () => {
  if (!pagesData.length) return;
  setStatus('Building the searchable PDF…');
  try {
    const boxPages = splitBoxPages(textBox.value, pagesData.length);
    let anyEdited = false;
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const px2pt = 72 / DPI;
    for (let pi = 0; pi < pagesData.length; pi++) {
      const p = pagesData[pi];
      const img = await doc.embedPng(p.png);
      const wPt = p.wPx * px2pt, hPt = p.hPx * px2pt;
      const page = doc.addPage([wPt, hPt]);
      page.drawImage(img, { x: 0, y: 0, width: wPt, height: hPt });
      let drawWords = p.words;
      if (boxPages) {
        if (boxPages[pi].trim() !== p.text.trim()) anyEdited = true;
        drawWords = alignCorrectedWords(p.words, tokenizeCorrected(boxPages[pi]));
      }
      for (const word of drawWords) {
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
    if (!boxPages) {
      setStatus('Done. This searchable PDF carries the text exactly as read: the --- Page N --- lines in the box were changed, so your edits could not be matched back to their pages. Your corrected text is in the .txt download; put the page lines back and the PDF will carry your edits too.');
    } else if (anyEdited) {
      setStatus('Done. The searchable PDF carries your corrected text: your edits in the box were placed back over the page, at the positions of the words they replaced.');
    } else {
      setStatus('Done. The searchable PDF carries the text from the box, unchanged from the read.');
    }
  } catch (err) {
    setStatus('The searchable PDF could not be built: ' + (err && err.message ? err.message : err));
  }
});
