// Remove Background.
// Engine: imgly's quantized ISNet build (44,342,436 bytes) through our own
// onnxruntime-web pipeline, WASM, one thread (build plan T4/T5).
// Preprocessing is the bench's own: resize to 1024x1024, (pixel - 128) / 256,
// mask clipped to [0,1] (bench/BENCH-ROUND3B.md). The model downloads only
// when the visitor presses start, and its size is printed before that.
// A near-empty mask is reported honestly as "no clear subject found".
import * as ort from 'onnxruntime-web/wasm';
import { fmtBytes, recordJob, wireTray } from './workbench.js';

ort.env.wasm.wasmPaths = '/ort/';
ort.env.wasm.numThreads = 1;
ort.env.logLevel = 'warning';

const MODEL_URL = '/models/imgly-isnet-small-quantized.onnx';
const MODEL_BYTES = 44342436;

const $ = (id) => document.getElementById(id);
const tray = $('bg-tray'), input = $('bg-file'), spec = $('bg-spec');
const runBtn = $('bg-run'), status = $('bg-status'), result = $('bg-result');
const noSubject = $('bg-nosubject');
let file = null, bitmap = null, session = null, modelBuf = null, running = false;

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
    bitmap = await createImageBitmap(f);
    const prev = $('bg-preview');
    prev.src = URL.createObjectURL(f);
    prev.classList.remove('hidden');
    setSpec([
      ['file', f.name],
      ['format', f.type || 'unknown'],
      ['size', fmtBytes(f.size)],
      ['dimensions', bitmap.width + ' x ' + bitmap.height],
      ['model', '44.3 MB, downloads when you press start'],
    ]);
    setStatus('Ready. Nothing has been downloaded or sent anywhere yet.');
    runBtn.disabled = false;
  } catch (err) {
    setStatus('That file could not be read as an image: ' + (err && err.message ? err.message : err));
  }
});

async function loadModel() {
  if (session) return session;
  if (!modelBuf) {
    setStatus('Downloading the removal program: 0 of 44.3 MB…');
    const res = await fetch(MODEL_URL);
    if (!res.ok) throw new Error('model download failed (' + res.status + ')');
    const total = parseInt(res.headers.get('content-length') || MODEL_BYTES, 10);
    const reader = res.body.getReader();
    const chunks = [];
    let got = 0, lastShown = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      got += value.length;
      if (got - lastShown > 1024 * 1024) {
        lastShown = got;
        setStatus(`Downloading the removal program: ${(got / 1048576).toFixed(1)} of ${(total / 1048576).toFixed(1)} MB…`);
      }
    }
    modelBuf = new Uint8Array(got);
    let off = 0;
    for (const c of chunks) { modelBuf.set(c, off); off += c.length; }
  }
  setStatus('Starting the removal program…');
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

    setStatus('Reading the photo and cutting out the subject…');
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
      setStatus('Done. No clear subject found in this photo.');
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
    const beforeUrl = URL.createObjectURL(file);
    $('bg-after-img').src = resultUrl;
    $('bg-before-img').src = beforeUrl;
    const dl = $('bg-download');
    dl.href = resultUrl;
    dl.download = file.name.replace(/\.[^.]+$/, '') + '-no-background.png';
    $('bg-times').textContent = `Program start: ${loadSecs} s. Cutout: ${runSecs} s. Full size result: ${W} x ${H}, ${fmtBytes(blob.size)}.`;
    result.classList.remove('hidden');
    setCompare(50);
    const stamp = $('bg-stamp');
    stamp.classList.remove('land');
    void stamp.offsetWidth;
    stamp.classList.add('land');
    setStatus('Done.');
    recordJob({ tool: 'Remove background', name: file.name, detail: 'cutout ' + W + 'x' + H });
  } catch (err) {
    setStatus('Something went wrong: ' + (err && err.message ? err.message : err));
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
