// Remove Background.
// Engine: imgly's quantized ISNet build (44,342,436 bytes) through our own
// onnxruntime-web pipeline, WASM, one thread (build plan T4/T5).
// Delivery (T4): the model ships as 11 hashed pieces with a SHA-256
// manifest (public/models/model-manifest.json, made by
// tools/make-model-chunks.mjs). The loader fetches the pieces, checks every
// piece's hash and then the whole file's hash, and only then runs it.
// Preprocessing is the bench's own: resize to 1024x1024, (pixel - 128) / 256,
// mask clipped to [0,1] (bench/BENCH-ROUND3B.md). The model downloads only
// when the visitor presses start, and its size is printed before that.
// A near-empty mask is reported honestly as "no clear subject found".
import * as ort from 'onnxruntime-web/wasm';
import { fmtBytes, recordJob, wireTray } from './workbench.js';
import { bitmapFromPhotoFile } from './lib/bg-engine.js';
import { BG_STRINGS } from '../locales/bg.js';

// Every user-facing string comes from the locale file; the page picks its
// set with data-locale on the #bg-tool section (en is the fallback and the
// source of truth). es / pt-BR are pending human review (TRANSLATIONS.md).
const locale = (document.getElementById('bg-tool') || { dataset: {} }).dataset.locale || 'en';
const S = (BG_STRINGS[locale] || BG_STRINGS.en).msg;
// Spanish and Portuguese write decimals with a comma (44,3 MB).
const num = (x) => (locale === 'en' ? String(x) : String(x).replace('.', ','));

ort.env.wasm.wasmPaths = '/ort/';
ort.env.wasm.numThreads = 1;
ort.env.logLevel = 'warning';

const MANIFEST_URL = '/models/model-manifest.json';
const MODEL_BYTES = 44342436;

async function sha256Hex(buf) {
  const h = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const $ = (id) => document.getElementById(id);
const tray = $('bg-tray'), input = $('bg-file'), spec = $('bg-spec');
const runBtn = $('bg-run'), status = $('bg-status'), result = $('bg-result');
const cancelBtn = $('bg-cancel');
const noSubject = $('bg-nosubject');
let file = null, bitmap = null, previewUrl = null, session = null, modelBuf = null, running = false;
// Cancel support (milestone 8, round-1 fix 2): the load is abortable,
// and the pieces already fetched and checked are KEPT in this page, so
// a later start resumes where the load stopped instead of starting
// over. The cancelled status line says exactly that, in plain words.
let modelParts = null; // per-piece verified buffers, or null per piece
let loadAbort = null;

function keptPieces() {
  return modelParts ? modelParts.filter(Boolean).length : 0;
}
function cancelledError(total) {
  const e = new Error('load cancelled');
  e.cancelled = true;
  e.kept = keptPieces();
  e.total = total;
  return e;
}
function showCancel(on) {
  if (cancelBtn) cancelBtn.classList.toggle('hidden', !on);
}
if (cancelBtn) {
  cancelBtn.addEventListener('click', () => { if (loadAbort) loadAbort.abort(); });
}

function setStatus(msg) { status.textContent = msg; }
function setSpec(rows) {
  spec.innerHTML = rows.map(([k, v]) => `<div class="spec-row"><dt>${k}</dt><dd>${v}</dd></div>`).join('');
}

wireTray(tray, input, async (f) => {
  result.classList.add('hidden');
  noSubject.classList.add('hidden');
  runBtn.disabled = true;
  file = f;
  try {
    // HEIC photos are decoded by the shipped libheif reader first
    // (milestone 18): createImageBitmap cannot read them in Chrome or
    // Firefox, and the preview comes from the decoded picture for the
    // same reason.
    const got = await bitmapFromPhotoFile(f);
    bitmap = got.bitmap;
    previewUrl = got.previewUrl;
    const prev = $('bg-preview');
    prev.src = previewUrl;
    prev.classList.remove('hidden');
    setSpec([
      [S.specFile, f.name],
      [S.specFormat, got.format || f.type || S.formatUnknown],
      [S.specSize, num(fmtBytes(f.size))],
      [S.specDimensions, bitmap.width + ' x ' + bitmap.height],
      [S.specModel, S.modelValue],
    ]);
    setStatus(S.ready);
    runBtn.disabled = false;
  } catch (err) {
    setStatus(S.unreadablePrefix + (err && err.message ? err.message : err));
  }
});

async function loadModel() {
  if (session) return session;
  if (!modelBuf) {
    setStatus(S.fetchingList);
    const mres = await fetch(MANIFEST_URL);
    if (!mres.ok) throw new Error(S.errList(mres.status));
    const manifest = await mres.json();
    const total = manifest.totalBytes || MODEL_BYTES;
    const n = manifest.chunks.length;
    if (!modelParts || modelParts.length !== n) modelParts = new Array(n).fill(null);
    let got = modelParts.reduce((a, p) => a + (p ? p.length : 0), 0);
    loadAbort = new AbortController();
    showCancel(true);
    try {
      for (let i = 0; i < n; i++) {
        if (modelParts[i]) continue;
        const c = manifest.chunks[i];
        setStatus(S.downloading(num((got / 1048576).toFixed(1)), num((total / 1048576).toFixed(1)), i + 1, n));
        let buf;
        try {
          const res = await fetch('/models/' + c.file, { signal: loadAbort.signal });
          if (!res.ok) throw new Error(S.errPieceDownload(i + 1, res.status));
          buf = new Uint8Array(await res.arrayBuffer());
        } catch (err) {
          if (loadAbort.signal.aborted) throw cancelledError(n);
          throw err;
        }
        if (buf.length !== c.bytes) throw new Error(S.errPieceSize(i + 1));
        if ((await sha256Hex(buf)) !== c.sha256) throw new Error(S.errPieceCheck(i + 1));
        modelParts[i] = buf;
        got += buf.length;
      }
    } finally {
      showCancel(false);
      loadAbort = null;
    }
    modelBuf = new Uint8Array(total);
    let off = 0;
    for (const p of modelParts) { modelBuf.set(p, off); off += p.length; }
    if ((await sha256Hex(modelBuf)) !== manifest.sha256) {
      modelBuf = null;
      modelParts = null;
      throw new Error(S.errFinalCheck);
    }
    setStatus(S.downloadedChecked);
  }
  setStatus(S.starting);
  session = await ort.InferenceSession.create(modelBuf.buffer, {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
  });
  return session;
}

runBtn.addEventListener('click', async () => {
  if (!file || !bitmap || running) return;
  running = true;
  runBtn.disabled = true;
  result.classList.add('hidden');
  noSubject.classList.add('hidden');
  try {
    const t0 = performance.now();
    const sess = await loadModel();
    const loadSecs = ((performance.now() - t0) / 1000).toFixed(1);

    setStatus(S.reading);
    // Preprocess at 1024x1024 with the bench's ISNet scaling.
    const pc = document.createElement('canvas');
    pc.width = 1024; pc.height = 1024;
    const pctx = pc.getContext('2d', { willReadFrequently: true });
    pctx.drawImage(bitmap, 0, 0, 1024, 1024);
    const px = pctx.getImageData(0, 0, 1024, 1024).data;
    const n = 1024 * 1024;
    const data = new Float32Array(3 * n);
    for (let i = 0; i < n; i++) {
      data[i] = (px[i * 4] - 128) / 256;
      data[n + i] = (px[i * 4 + 1] - 128) / 256;
      data[2 * n + i] = (px[i * 4 + 2] - 128) / 256;
    }
    const tensor = new ort.Tensor('float32', data, [1, 3, 1024, 1024]);
    const t1 = performance.now();
    const out = await sess.run({ [sess.inputNames[0]]: tensor });
    const runSecs = ((performance.now() - t1) / 1000).toFixed(1);
    const mask = out[sess.outputNames[0]].data;

    // Mask statistics: the honest no-subject check.
    let sum = 0, above = 0;
    const maskBytes = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      let v = mask[i];
      v = v < 0 ? 0 : v > 1 ? 1 : v;
      const b = Math.round(v * 255);
      maskBytes[i] = b;
      sum += b;
      if (b > 128) above++;
    }
    const mean = sum / n;
    if (above / n < 0.005 && mean < 4) {
      noSubject.classList.remove('hidden');
      setStatus(S.doneNoSubject);
      return;
    }

    // Composite at full resolution: original pixels, mask as alpha.
    const W = bitmap.width, H = bitmap.height;
    const full = document.createElement('canvas');
    full.width = W; full.height = H;
    const fctx = full.getContext('2d', { willReadFrequently: true });
    fctx.drawImage(bitmap, 0, 0);
    const orig = fctx.getImageData(0, 0, W, H);

    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = 1024; maskCanvas.height = 1024;
    const mctx = maskCanvas.getContext('2d');
    const mImg = mctx.createImageData(1024, 1024);
    for (let i = 0; i < n; i++) {
      mImg.data[i * 4] = maskBytes[i];
      mImg.data[i * 4 + 1] = maskBytes[i];
      mImg.data[i * 4 + 2] = maskBytes[i];
      mImg.data[i * 4 + 3] = 255;
    }
    mctx.putImageData(mImg, 0, 0);
    const scaled = document.createElement('canvas');
    scaled.width = W; scaled.height = H;
    const sctx = scaled.getContext('2d', { willReadFrequently: true });
    sctx.imageSmoothingEnabled = true;
    sctx.drawImage(maskCanvas, 0, 0, W, H);
    const alpha = sctx.getImageData(0, 0, W, H).data;

    const outImg = fctx.createImageData(W, H);
    for (let i = 0; i < W * H; i++) {
      outImg.data[i * 4] = orig.data[i * 4];
      outImg.data[i * 4 + 1] = orig.data[i * 4 + 1];
      outImg.data[i * 4 + 2] = orig.data[i * 4 + 2];
      outImg.data[i * 4 + 3] = alpha[i * 4];
    }
    fctx.putImageData(outImg, 0, 0);
    const blob = await new Promise((r) => full.toBlob(r, 'image/png'));

    const resultUrl = URL.createObjectURL(blob);
    $('bg-after-img').src = resultUrl;
    $('bg-before-img').src = previewUrl || URL.createObjectURL(file);
    const dl = $('bg-download');
    dl.href = resultUrl;
    dl.download = file.name.replace(/\.[^.]+$/, '') + S.downloadSuffix;
    $('bg-times').textContent = S.times(num(loadSecs), num(runSecs), W, H, num(fmtBytes(blob.size)));
    result.classList.remove('hidden');
    setCompare(50);
    const stamp = $('bg-stamp');
    stamp.classList.remove('land');
    void stamp.offsetWidth;
    stamp.classList.add('land');
    setStatus(S.done);
    recordJob({ tool: S.toolName, name: file.name, detail: S.detailPrefix + W + 'x' + H });
  } catch (err) {
    if (err && err.cancelled) setStatus(S.cancelled(err.kept, err.total));
    else setStatus(S.wentWrongPrefix + (err && err.message ? err.message : err));
  } finally {
    running = false;
    runBtn.disabled = false;
  }
});

// Before/after comparison: drag anywhere on the picture, or use the slider.
const compare = $('bg-compare');
function setCompare(p) {
  p = Math.max(0, Math.min(100, p));
  $('bg-before-wrap').style.clipPath = `inset(0 ${100 - p}% 0 0)`;
  $('bg-divider').style.left = p + '%';
  $('bg-range').value = p;
}
$('bg-range').addEventListener('input', (e) => setCompare(parseFloat(e.target.value)));
let dragging = false;
compare.addEventListener('pointerdown', (e) => { dragging = true; moveCompare(e); });
window.addEventListener('pointermove', (e) => { if (dragging) moveCompare(e); });
window.addEventListener('pointerup', () => { dragging = false; });
function moveCompare(e) {
  const r = compare.getBoundingClientRect();
  if (r.width > 0) setCompare(((e.clientX - r.left) / r.width) * 100);
}
