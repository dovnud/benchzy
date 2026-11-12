// Compress Image to an exact KB target.
// Engine: jSquash (mozjpeg) + jSquash resize, the measured bench set.
// Algorithm: the COMBINED quality-and-size search from bench/imgnums
// (bench/imgnums/combined.mjs): quality-only search has no rung inside the
// tolerance window on hard photos, so when quality alone cannot land the
// target, the search fixes a low anchor quality and binary-searches the
// dimensions as well. Settings are probed first; the winner is encoded once
// more from the cached attempts (attempts are kept, not re-encoded).
import jpegDecode, { init as initJpegDec } from '@jsquash/jpeg/decode.js';
import jpegEncode, { init as initJpegEnc } from '@jsquash/jpeg/encode.js';
import pngDecode, { init as initPngDec } from '@jsquash/png/decode.js';
import webpDecode, { init as initWebpDec } from '@jsquash/webp/decode.js';
import resize, { initResize } from '@jsquash/resize';
import { fmtBytes, recordJob, savePreset, getPreset, wireTray } from './workbench.js';
import { isHeifFile, decodeHeicToImageData } from './lib/heif-core.js';

const $ = (id) => document.getElementById(id);
const tray = $('ci-tray'), input = $('ci-file'), spec = $('ci-spec');
const runBtn = $('ci-run'), status = $('ci-status'), result = $('ci-result');
const customInput = $('ci-custom');
let file = null, targetKB = 200, inited = false, running = false;

// Preset pages (e.g. /compress-image-to-50kb/) set data-preset-kb and
// data-lock-target on #ci-tool: the target is fixed by the page, and the
// visitor's saved general preset does not override it.
// Milestone 24: the /compress-jpg/ and /compress-png/ doors set
// data-lock-format ("jpeg" or "png") on #ci-tool: the door takes
// only that kind of picture in, and says so at the tray when a
// different kind arrives. The engine and its output (a JPEG at the
// target) are unchanged; the lock is the door's framing, enforced.
const toolEl = $('ci-tool');
const presetKB = toolEl && toolEl.dataset.presetKb ? parseInt(toolEl.dataset.presetKb, 10) : null;
const lockTarget = !!toolEl && toolEl.dataset.lockTarget === '1';
const lockFormat = toolEl && toolEl.dataset.lockFormat ? toolEl.dataset.lockFormat : null;
const LOCK_WORDS = { jpeg: ['JPG', 'a JPG photo'], png: ['PNG', 'a PNG picture'] };
function kindOfFile(f) {
  if (f.type === 'image/jpeg' || /\.jpe?g$/i.test(f.name)) return 'jpeg';
  if (f.type === 'image/png' || /\.png$/i.test(f.name)) return 'png';
  if (f.type === 'image/webp' || /\.webp$/i.test(f.name)) return 'webp';
  if (f.type === 'image/heic' || f.type === 'image/heif' || /\.hei[cf]$/i.test(f.name)) return 'heic';
  return null;
}
if (presetKB) targetKB = presetKB;
if (!lockTarget) {
  const saved = getPreset('compress-image');
  if (saved && saved.targetKB) targetKB = saved.targetKB;
}
if (customInput) customInput.value = targetKB;

function setStatus(msg) { status.textContent = msg; }
function setSpec(rows) {
  spec.innerHTML = rows.map(([k, v]) => `<div class="spec-row"><dt>${k}</dt><dd>${v}</dd></div>`).join('');
}

async function initCodecs() {
  if (inited) return;
  setStatus('Loading the image program (about 2 MB, one time only). It runs in your browser; your file is never uploaded…');
  const compile = async (p) => {
    const res = await fetch(p);
    return WebAssembly.compile(await res.arrayBuffer());
  };
  await initJpegDec(await compile('/codecs/mozjpeg_dec.wasm'));
  await initJpegEnc(await compile('/codecs/mozjpeg_enc.wasm'));
  await initWebpDec(await compile('/codecs/webp_dec.wasm'));
  await initPngDec('/codecs/squoosh_png_bg.wasm');
  initResize(await (await fetch('/codecs/squoosh_resize_bg.wasm')).arrayBuffer());
  inited = true;
}

async function decodeImage(f, buf) {
  // HEIC/HEIF (iPhone photos): the libheif decoder (milestone 15).
  if (isHeifFile(f, buf)) {
    setStatus('Loading the HEIC reader (about 1.6 MB, one time only) and reading the photo…');
    const r = await decodeHeicToImageData(buf);
    return r.imageData;
  }
  if (f.type === 'image/jpeg') return jpegDecode(buf);
  if (f.type === 'image/png') return pngDecode(buf);
  if (f.type === 'image/webp') return webpDecode(buf);
  // Anything the browser itself can read (GIF, BMP, AVIF in some browsers):
  const bmp = await createImageBitmap(f);
  const c = document.createElement('canvas');
  c.width = bmp.width; c.height = bmp.height;
  const ctx = c.getContext('2d');
  ctx.drawImage(bmp, 0, 0);
  return ctx.getImageData(0, 0, c.width, c.height);
}

wireTray(tray, input, async (f) => {
  if (lockFormat && kindOfFile(f) !== lockFormat) {
    file = null;
    result.classList.add('hidden');
    runBtn.disabled = true;
    setSpec([
      ['file', f.name],
      ['format', f.type || 'unknown'],
      ['this door takes', LOCK_WORDS[lockFormat][1] + ' in'],
    ]);
    setStatus('This door starts from ' + LOCK_WORDS[lockFormat][1] + '. The general compress page takes this file as it is: /compress-image/');
    return;
  }
  file = f;
  result.classList.add('hidden');
  runBtn.disabled = false;
  setSpec([
    ['file', f.name],
    ['format', f.type || 'unknown'],
    ['size now', fmtBytes(f.size)],
    ['target', targetKB + ' KB'],
  ]);
  setStatus('Ready. The search runs here in the page; nothing is uploaded.');
});

document.querySelectorAll('#ci-targets .chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('#ci-targets .chip').forEach((c) => c.setAttribute('aria-pressed', 'false'));
    chip.setAttribute('aria-pressed', 'true');
    targetKB = parseInt(chip.dataset.kb, 10);
    if (customInput) customInput.value = targetKB;
    if (file) setStatus('Target set to ' + targetKB + ' KB.');
  });
});
if (customInput) customInput.addEventListener('change', () => {
  const v = parseInt(customInput.value, 10);
  if (v >= 5 && v <= 20000) targetKB = v;
});
{ // mark the chip that matches the restored preset
  const match = document.querySelector(`#ci-targets .chip[data-kb="${targetKB}"]`);
  if (match) match.setAttribute('aria-pressed', 'true');
}

runBtn.addEventListener('click', async () => {
  if (!file || running) return;
  running = true;
  runBtn.disabled = true;
  result.classList.add('hidden');
  const target = targetKB * 1024;
  try {
    await initCodecs();
    const buf = await file.arrayBuffer();

    if (file.size <= target && file.type === 'image/jpeg') {
      showResult(file, null, `Already under your target at ${fmtBytes(file.size)}. Here is your file back, unchanged.`, 0, 0);
      return;
    }

    setStatus('Reading the photo…');
    const img = await decodeImage(file, buf);
    setSpec([
      ['file', file.name],
      ['format', file.type || 'unknown'],
      ['size now', fmtBytes(file.size)],
      ['dimensions', img.width + ' x ' + img.height],
      ['target', targetKB + ' KB'],
    ]);

    const resizeCache = new Map([[1, img]]);
    async function atScale(s) {
      if (!resizeCache.has(s)) {
        const w = Math.max(1, Math.round(img.width * s));
        const h = Math.max(1, Math.round(img.height * s));
        resizeCache.set(s, await resize(img, { width: w, height: h }));
      }
      return resizeCache.get(s);
    }

    const tried = [];
    let attempts = 0;
    async function attempt(s, q) {
      attempts++;
      const im = await atScale(s);
      const out = await jpegEncode(im, { quality: q });
      const rec = { bytes: out.byteLength, buf: out, q, s, w: im.width, h: im.height };
      tried.push(rec);
      setStatus(`Trying quality ${q}${s < 1 ? ' at ' + Math.round(s * 100) + '% size' : ''}: ${fmtBytes(out.byteLength)} (attempt ${attempts})`);
      return rec;
    }
    const bestUnder = () => tried.filter((r) => r.bytes <= target).sort((a, b) => b.bytes - a.bytes)[0];
    const closest = () => [...tried].sort((a, b) => Math.abs(a.bytes - target) - Math.abs(b.bytes - target))[0];
    const closeEnough = (r) => r && Math.abs(r.bytes - target) / target <= 0.01;

    const t0 = performance.now();
    const r50 = await attempt(1, 50);
    if (r50.bytes > target) {
      let lo = 2, hi = 50;
      for (let i = 0; i < 5; i++) {
        const q = Math.round((lo + hi) / 2);
        const r = await attempt(1, q);
        if (r.bytes <= target) lo = q; else hi = q;
        if (closeEnough(bestUnder())) break;
      }
    } else {
      let lo = 50, hi = 98;
      for (let i = 0; i < 5; i++) {
        const q = Math.round((lo + hi) / 2);
        const r = await attempt(1, q);
        if (r.bytes <= target) lo = q; else hi = q;
        if (closeEnough(bestUnder())) break;
      }
    }

    let best = bestUnder() || closest();
    if (!best || best.bytes > target * 1.005) {
      // Combined search: quality alone has no rung close enough (measured on
      // hard photos). Fix a low anchor quality, binary-search the size too.
      const qAnchor = Math.max(4, Math.min(...tried.map((r) => r.q)));
      let lo = 0.15, hi = 1.0;
      for (let i = 0; i < 6; i++) {
        const s = (lo + hi) / 2;
        const r = await attempt(s, qAnchor);
        if (r.bytes <= target) lo = s; else hi = s;
        if (closeEnough(bestUnder())) break;
      }
      best = bestUnder() || closest();
    }
    const secs = ((performance.now() - t0) / 1000).toFixed(1);

    const blob = new Blob([best.buf], { type: 'image/jpeg' });
    const errPct = (((best.bytes - target) / target) * 100).toFixed(1);
    const note = best.bytes <= target
      ? `Landed at ${fmtBytes(best.bytes)} (${errPct}% vs the ${targetKB} KB target), quality ${best.q}, ${best.w}x${best.h}, after ${attempts} tries in ${secs} seconds.`
      : `Closest we could reach is ${fmtBytes(best.bytes)} (${errPct}% vs the ${targetKB} KB target), quality ${best.q}, ${best.w}x${best.h}. We would rather show you that plainly than hand you a bigger file and call it done.`;
    showResult(blob, best, note, attempts, secs);
    if (!lockTarget) savePreset('compress-image', { targetKB });
    recordJob({ tool: 'Compress image', name: file.name, detail: fmtBytes(file.size) + ' to ' + fmtBytes(best.bytes) });
  } catch (err) {
    setStatus('Something went wrong with this file: ' + (err && err.message ? err.message : err));
  } finally {
    running = false;
    runBtn.disabled = false;
  }
});

function showResult(blobOrFile, rec, note, attempts, secs) {
  const url = URL.createObjectURL(blobOrFile);
  const dl = $('ci-download');
  const base = file.name.replace(/\.[^.]+$/, '');
  dl.href = url;
  dl.download = base + '-benchzy.jpg';
  $('ci-achieved').textContent = note;
  const prev = $('ci-preview');
  prev.src = url;
  prev.classList.remove('hidden');
  result.classList.remove('hidden');
  const stamp = $('ci-stamp');
  stamp.classList.remove('land');
  void stamp.offsetWidth;
  stamp.classList.add('land');
  setStatus('Done.');
}
