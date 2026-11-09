// Photo OCR: read the words out of a photo or screenshot.
// The same engine the scan reader uses (Tesseract.js 7, LSTM core,
// self-hosted) pointed at a picture instead of a PDF. The bench's
// honesty rules ship with it: the text lands in an editable box for
// checking before it is copied or downloaded, because this WASM build
// dropped the decimal point in a money amount on a clean test invoice
// (124.50 read as 12450; bench/BENCH-RESULTS.md round 2).
// Sharpness is the whole game, so the page plans around it, and the
// plan is printed in the spec before the run. The enlarge rule was
// benched on this page's own fixtures before it shipped
// (verify/m10-bench.mjs, m10-bench-degraded.mjs,
// m10-bench-degraded-hard.mjs; numbers in BUILD-STATUS milestone 10):
// on clean and mildly compressed pictures enlarging changed nothing
// or cost a few tenths of a point, but on a genuinely rough small
// picture (560 px wide, heavy JPEG mush) reading as picked scored
// 94.3% of characters while enlarging 3x scored 99.0%. So only small
// pictures are enlarged, by the winning factor; everything else is
// read as picked, and a very large picture is shrunk to a sane
// ceiling because the reader slows down for no gain up there.
import { fmtBytes, recordJob, wireTray } from './workbench.js';
import { isHeifBytes, decodeHeicToImageData } from './lib/heif-core.js';
import { ocrPlan, ocrPlanText, getOcrWorker } from './lib/ocr-core.js';

const $ = (id) => document.getElementById(id);
const tray = $('oi-tray'), input = $('oi-file'), spec = $('oi-spec');
const runBtn = $('oi-run'), status = $('oi-status'), result = $('oi-result');
const textBox = $('oi-text'), langSel = $('oi-lang');

// The reading plan (which pictures are enlarged or shrunk before
// reading, and by how much) lives in lib/ocr-core.js since milestone
// 16, shared with the workflow chains; the bench notes above are its
// provenance and the numbers are unchanged.
const plan = () => ocrPlan(imgW, imgH);
const planText = ocrPlanText;

const LANG_NAMES = { eng: 'English', spa: 'Spanish', por: 'Portuguese' };
let file = null, bitmap = null, imgW = 0, imgH = 0, running = false;
let sourceIsHeic = false; // a HEIC source must be rasterized to PNG before the reader sees it (milestone 15)

function setStatus(msg) { status.textContent = msg; }
function setSpec(rows) {
  spec.innerHTML = rows.map(([k, v]) => `<div class="spec-row"><dt>${k}</dt><dd>${v}</dd></div>`).join('');
}
function readyStatus() {
  const p = plan();
  const load = 'The first run loads the reading program (about 10 MB, one time only).';
  if (p.kind === 'enlarge') {
    return 'Ready. This picture is small (' + imgW + ' x ' + imgH + '), so it will be enlarged before reading: on a rough, small test picture, enlarging took the reading from 94% to 99% of characters right. ' + load;
  }
  if (p.kind === 'shrink') {
    return 'Ready. This picture is very large, so a copy is shrunk to 6,000 px on the long side before reading; the words read the same and it goes faster. ' + load;
  }
  return 'Ready. Reading happens here in the page. ' + load;
}
function refreshSpec() {
  setSpec([
    ['file', file.name],
    ['size now', fmtBytes(file.size)],
    ['picture', imgW + ' x ' + imgH + ' px'],
    ['words are in', LANG_NAMES[langSel.value] || 'English'],
    ['reading plan', planText(plan())],
  ]);
}

wireTray(tray, input, async (f) => {
  result.classList.add('hidden');
  runBtn.disabled = true;
  file = f;
  bitmap = null;
  sourceIsHeic = false;
  try {
    try {
      bitmap = await createImageBitmap(f);
    } catch (e) {
      bitmap = await new Promise((res, rej) => {
        const img = new Image();
        const url = URL.createObjectURL(f);
        img.onload = () => res(img);
        img.onerror = rej;
        img.src = url;
      });
    }
  } catch (firstErr) {
    // Last door: an iPhone HEIC photo, which the browser cannot open
    // natively outside Safari but the libheif reader can (milestone 15).
    try {
      const buf = await f.arrayBuffer();
      if (!isHeifBytes(buf)) throw firstErr;
      setStatus('Loading the HEIC reader (about 1.6 MB, one time only) and opening the photo…');
      const r = await decodeHeicToImageData(buf);
      const c = document.createElement('canvas');
      c.width = r.imageData.width;
      c.height = r.imageData.height;
      c.getContext('2d').putImageData(r.imageData, 0, 0);
      bitmap = c;
      sourceIsHeic = true;
    } catch (heifErr) {
      setStatus('That file could not be opened as a picture. This page reads JPG, PNG, WebP and iPhone HEIC pictures.');
      return;
    }
  }
  try {
    imgW = bitmap.width || bitmap.naturalWidth;
    imgH = bitmap.height || bitmap.naturalHeight;
    if (!imgW || !imgH) throw new Error('no picture size');
    refreshSpec();
    setStatus(readyStatus());
    runBtn.disabled = false;
  } catch (err) {
    setStatus('That file could not be opened as a picture. This page reads JPG, PNG, WebP and iPhone HEIC pictures.');
  }
});

langSel.addEventListener('change', () => {
  if (file && !running) { refreshSpec(); setStatus(readyStatus()); }
});

// The worker itself is the shared one in lib/ocr-core.js; this page
// supplies its own loading and progress words, unchanged.
function pageWorker(lang) {
  return getOcrWorker(lang, {
    loading: (l) => setStatus(l === 'eng'
      ? 'Loading the reading program (about 10 MB, one time only). It runs in your browser to protect your privacy: your photo never leaves your device…'
      : 'Loading the reading program with the ' + LANG_NAMES[l] + ' data (about 10 MB, one time only). It runs in your browser to protect your privacy: your photo never leaves your device…'),
    progress: (pct) => setStatus('Reading the picture… ' + pct + '%'),
  });
}

runBtn.addEventListener('click', async () => {
  if (!file || !bitmap || running) return;
  running = true;
  runBtn.disabled = true;
  result.classList.add('hidden');
  try {
    const p = plan();
    let inputBlob = file;
    if (p.factor !== 1 || sourceIsHeic) {
      // A HEIC source is rasterized even at factor 1: the reader cannot
      // open the HEIC file itself, only the picture decoded from it.
      setStatus(sourceIsHeic && p.factor === 1
        ? 'Preparing the photo for the reader…'
        : (p.kind === 'enlarge' ? 'Enlarging the picture before reading…' : 'Shrinking a copy of the picture before reading…'));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(imgW * p.factor));
      canvas.height = Math.max(1, Math.round(imgH * p.factor));
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      inputBlob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
    }
    const w = await pageWorker(langSel.value);
    const t0 = performance.now();
    const { data } = await w.recognize(inputBlob);
    const secs = ((performance.now() - t0) / 1000).toFixed(1);
    const text = (data.text || '').trim();
    textBox.value = text;
    if (text) {
      $('oi-achieved').textContent =
        'Read ' + text.length + ' characters from a ' + imgW + ' x ' + imgH + ' picture in ' + secs + ' seconds. ' +
        'Check the text in the box before you use it, especially numbers: this reader has been caught dropping the decimal point in money amounts (124.50 read as 12450) on a clean test page. ' +
        'Fix anything in the box: Copy and the .txt download both use your corrected text.';
    } else {
      $('oi-achieved').textContent =
        'The reader found no words it could read in this picture. It reads printed text only: a straighter, bigger, better-lit picture of printed words is the fix worth trying. Nothing was made up to fill the box.';
    }
    result.classList.remove('hidden');
    const stamp = $('oi-stamp');
    stamp.classList.remove('land');
    void stamp.offsetWidth;
    stamp.classList.add('land');
    setStatus('Done.');
    recordJob({ tool: 'OCR image', name: file.name, detail: text.length + ' chars read' });
  } catch (err) {
    setStatus('Something went wrong reading this picture: ' + (err && err.message ? err.message : err));
  } finally {
    running = false;
    runBtn.disabled = false;
  }
});

$('oi-copy').addEventListener('click', async () => {
  const text = textBox.value;
  let copied = false;
  try {
    await navigator.clipboard.writeText(text);
    copied = true;
  } catch (e) {
    textBox.focus();
    textBox.select();
    try { copied = document.execCommand('copy'); } catch (e2) { copied = false; }
  }
  setStatus(copied
    ? 'Copied. The text in the box, exactly as it stands, is on your clipboard.'
    : 'Copy did not take. Select the text in the box and copy it the usual way; it is all there.');
});

$('oi-download-txt').addEventListener('click', () => {
  const blob = new Blob([textBox.value], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name.replace(/\.(jpe?g|png|webp)$/i, '') + '-text.txt';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
});
