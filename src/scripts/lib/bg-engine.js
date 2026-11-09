// Shared core for background removal, extracted from the measured
// remove-bg island (milestones 1-3) so the batch bench runs the SAME
// pipeline: imgly's quantized ISNet (44,342,436 bytes) through
// onnxruntime-web's /wasm entry, one thread, delivered as 11 hashed
// pieces with a SHA-256 manifest (ticket T4); preprocessing is the
// bench's own (1024x1024, (pixel - 128) / 256, mask clipped to [0,1],
// composite at full resolution, BENCH-ROUND3B). The single-photo island
// keeps its own copy and its locale strings; this core reports progress
// as plain data and lets each page word it.
import * as ort from 'onnxruntime-web/wasm';
import { isHeifFile, decodeHeicToImageData } from './heif-core.js';

ort.env.wasm.wasmPaths = '/ort/';
ort.env.wasm.numThreads = 1;
ort.env.logLevel = 'warning';

const MANIFEST_URL = '/models/model-manifest.json';
export const MODEL_BYTES = 44342436;

async function sha256Hex(buf) {
  const h = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

let session = null;
let modelBuf = null;
// Cancel support (milestone 8, round-1 fix 2): the load accepts an
// AbortSignal; pieces already fetched and checked are KEPT in this
// module, so a later load resumes where the stopped one left off. A
// cancel throws an error with .cancelled, .kept and .total set.
let modelParts = null;

function cancelledError(total) {
  const e = new Error('load cancelled');
  e.cancelled = true;
  e.kept = modelParts ? modelParts.filter(Boolean).length : 0;
  e.total = total;
  return e;
}

// onProgress receives { phase, gotMB, totalMB, piece, pieces } with
// phase one of 'list' | 'piece' | 'checked' | 'starting'.
export async function loadBgSession(onProgress, signal) {
  const say = onProgress || (() => {});
  if (session) return session;
  if (!modelBuf) {
    say({ phase: 'list' });
    const mres = await fetch(MANIFEST_URL, { signal });
    if (!mres.ok) throw new Error('model list download failed (HTTP ' + mres.status + ')');
    const manifest = await mres.json();
    const total = manifest.totalBytes || MODEL_BYTES;
    const n = manifest.chunks.length;
    if (!modelParts || modelParts.length !== n) modelParts = new Array(n).fill(null);
    let got = modelParts.reduce((a, p) => a + (p ? p.length : 0), 0);
    for (let i = 0; i < n; i++) {
      if (modelParts[i]) continue;
      const c = manifest.chunks[i];
      say({ phase: 'piece', gotMB: got / 1048576, totalMB: total / 1048576, piece: i + 1, pieces: n });
      let buf;
      try {
        const res = await fetch('/models/' + c.file, { signal });
        if (!res.ok) throw new Error('model piece ' + (i + 1) + ' download failed (HTTP ' + res.status + ')');
        buf = new Uint8Array(await res.arrayBuffer());
      } catch (err) {
        if (signal && signal.aborted) throw cancelledError(n);
        throw err;
      }
      if (buf.length !== c.bytes) throw new Error('model piece ' + (i + 1) + ' arrived at the wrong size; nothing ran');
      if ((await sha256Hex(buf)) !== c.sha256) throw new Error('model piece ' + (i + 1) + ' failed its check; nothing ran');
      modelParts[i] = buf;
      got += buf.length;
    }
    modelBuf = new Uint8Array(total);
    let off = 0;
    for (const p of modelParts) { modelBuf.set(p, off); off += p.length; }
    if ((await sha256Hex(modelBuf)) !== manifest.sha256) {
      modelBuf = null;
      modelParts = null;
      throw new Error('the model failed its final check; nothing ran');
    }
    say({ phase: 'checked' });
  }
  say({ phase: 'starting' });
  session = await ort.InferenceSession.create(modelBuf.buffer, {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
  });
  return session;
}

// Decode a picked photo file into a bitmap the engine can cut.
// HEIC/HEIF (iPhone photos) cannot be read by createImageBitmap in
// Chrome or Firefox, so those files go through the shipped libheif
// decoder (milestone 15) first; the preview URL for a HEIC file is a
// PNG of the decoded picture, because an object URL of the HEIC file
// itself does not render in those browsers either. Returns
// { bitmap, previewUrl, format } where format is 'HEIC' when the
// decoder was used, otherwise null (callers fall back to file.type).
export async function bitmapFromPhotoFile(file) {
  const buf = await file.arrayBuffer();
  if (isHeifFile(file, buf)) {
    const r = await decodeHeicToImageData(buf);
    const c = document.createElement('canvas');
    c.width = r.imageData.width; c.height = r.imageData.height;
    c.getContext('2d').putImageData(r.imageData, 0, 0);
    const bitmap = await createImageBitmap(c);
    const previewBlob = await new Promise((res) => c.toBlob(res, 'image/png'));
    return { bitmap, previewUrl: URL.createObjectURL(previewBlob), format: 'HEIC' };
  }
  const bitmap = await createImageBitmap(file);
  return { bitmap, previewUrl: URL.createObjectURL(file), format: null };
}

// Cut the background out of one decoded bitmap. Returns
// { blob, width, height, runSecs } or { noSubject: true } when the mask
// is near-empty (the bench's thresholds: under 0.5% of pixels above half
// alpha and mean alpha under 4/255).
export async function cutoutBitmap(bitmap, onProgress) {
  const sess = await loadBgSession(onProgress);
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
  const runSecs = (performance.now() - t1) / 1000;
  const mask = out[sess.outputNames[0]].data;

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
  if (above / n < 0.005 && mean < 4) return { noSubject: true };

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
  return { blob, width: W, height: H, runSecs };
}
