// HEIC to JPG (and PNG / WebP): the iPhone photo door (milestone 15).
// Decode: libheif via lib/heif-core.js (LGPL-3.0, unmodified, loaded
// from /heif/ only when a HEIC file arrives). Encode: the shipped
// jSquash stack via lib/image-core.js, the same writers the convert
// doors run, so a HEIC conversion and a batch conversion of the same
// picture agree. Orientation truth lives in heif-core: the decoder
// applies container transformation properties itself, and EXIF
// orientation is applied there when the file has none; this island
// just reports which happened. Colour truth, printed on the page and
// repeated on the result when the source is a 10-bit file: HEIC can
// hold more brightness range than these formats show; the copy is in
// the standard range.
import { fmtBytes, recordJob, wireTray } from './workbench.js';
import { initImageCodecs, encodeImage, hasAlpha, flattenOnto } from './lib/image-core.js';
import { isHeifBytes, decodeHeicToImageData } from './lib/heif-core.js';

const $ = (id) => document.getElementById(id);
const NAMES = { jpeg: 'JPG', png: 'PNG', webp: 'WebP' };
const tray = $('hc-tray'), input = $('hc-file'), spec = $('hc-spec');
const runBtn = $('hc-run'), status = $('hc-status'), result = $('hc-result');
let file = null, buf = null, running = false, quality = 90, bg = '#ffffff', outFormat = 'jpeg';

function setStatus(msg) { status.textContent = msg; }
function setSpec(rows) {
  spec.innerHTML = rows.map(([k, v]) => `<div class="spec-row"><dt>${k}</dt><dd>${v}</dd></div>`).join('');
}

function fileFormat(f, bytes) {
  if (bytes && isHeifBytes(bytes)) return 'heic';
  if (f.type === 'image/jpeg') return 'jpeg';
  if (f.type === 'image/png') return 'png';
  if (f.type === 'image/webp') return 'webp';
  const m = /\.([a-z0-9]+)$/i.exec(f.name || '');
  if (m) {
    const e = m[1].toLowerCase();
    if (e === 'heic' || e === 'heif') return 'heic';
    if (e === 'jpg' || e === 'jpeg') return 'jpeg';
    if (e === 'png') return 'png';
    if (e === 'webp') return 'webp';
  }
  return null;
}

document.querySelectorAll('#hc-formats .chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('#hc-formats .chip').forEach((c) => c.setAttribute('aria-pressed', 'false'));
    chip.setAttribute('aria-pressed', 'true');
    outFormat = chip.dataset.format;
    $('hc-bg-row').classList.toggle('hidden', outFormat !== 'jpeg');
    $('hc-quality-row').classList.toggle('hidden', outFormat === 'png');
    runBtn.textContent = 'Convert to ' + NAMES[outFormat];
    if (file) setStatus('Ready. The photo comes out as a ' + NAMES[outFormat] + '.');
  });
});
const qEl = $('hc-quality');
qEl.addEventListener('change', () => {
  const v = parseInt(qEl.value, 10);
  if (v >= 1 && v <= 100) quality = v;
});
const bgEl = $('hc-bg');
bgEl.addEventListener('input', () => { bg = bgEl.value; });
document.querySelectorAll('#hc-bgs .chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('#hc-bgs .chip').forEach((c) => c.setAttribute('aria-pressed', 'false'));
    chip.setAttribute('aria-pressed', 'true');
    bg = chip.dataset.bg;
    bgEl.value = bg;
  });
});

wireTray(tray, input, async (f) => {
  file = null;
  buf = null;
  result.classList.add('hidden');
  runBtn.disabled = true;
  let bytes = null;
  try { bytes = await f.arrayBuffer(); } catch (e) { /* sniff falls back to name/type */ }
  const fmt = fileFormat(f, bytes);
  if (fmt !== 'heic') {
    setSpec([['file', f.name], ['this door takes', 'HEIC or HEIF files (iPhone photos)']]);
    if (fmt) {
      setStatus('This door starts from a HEIC photo. Your file is a ' + NAMES[fmt] + '. The batch convert page takes it from there: /batch-convert-images/');
    } else {
      setStatus('This door starts from a HEIC or HEIF photo (the kind iPhones save). That file is not one this page can read.');
    }
    return;
  }
  file = f;
  buf = bytes;
  runBtn.disabled = false;
  setSpec([
    ['file', f.name],
    ['format', 'HEIC (iPhone photo)'],
    ['size now', fmtBytes(f.size)],
    ['comes out as', NAMES[outFormat]],
  ]);
  setStatus('Ready. Press Convert and the ' + NAMES[outFormat] + ' is made here in the page; nothing is uploaded.');
});

runBtn.addEventListener('click', async () => {
  if (!file || running) return;
  running = true;
  runBtn.disabled = true;
  result.classList.add('hidden');
  try {
    setStatus('Loading the HEIC reader (about 1.6 MB, one time only). It runs in your browser to protect your privacy: your photo never leaves your device…');
    const decoded = await decodeHeicToImageData(buf || await file.arrayBuffer());
    setStatus('Loading the image program (about 2 MB, one time only)…');
    await initImageCodecs();
    let img = decoded.imageData;
    let flattened = false;
    if (outFormat === 'jpeg' && hasAlpha(img)) {
      img = flattenOnto(img, bg);
      flattened = true;
    }
    setStatus('Writing the ' + NAMES[outFormat] + '…');
    const r = await encodeImage(img, outFormat, quality, null);
    const blob = new Blob([r.buf], { type: r.mime });
    const url = URL.createObjectURL(blob);
    const dl = $('hc-download');
    const base = file.name.replace(/\.[^.]+$/, '');
    dl.href = url;
    dl.download = base + '.' + r.ext;
    dl.textContent = 'Download the ' + NAMES[outFormat];
    let note = 'HEIC, ' + fmtBytes(file.size) + ' → ' + NAMES[outFormat] + ', ' + fmtBytes(r.bytes)
      + (outFormat === 'png' ? ' (lossless: every pixel of the decoded picture, written exactly)' : ' (quality ' + quality + ')')
      + '. The photo is ' + r.width + ' x ' + r.height + ' px.';
    if (decoded.orientationApplied) {
      note += ' It was stored turned, with a note saying how it stands; this copy is upright.';
    }
    if (decoded.lumaBits > 8) {
      note += ' The original holds more brightness range than a ' + NAMES[outFormat] + ' can show (it is a ' + decoded.lumaBits + '-bit photo); this copy is in the standard range.';
    }
    if (decoded.hadSequence) {
      note += ' This file also holds a short video (a Live Photo). Only the still picture was converted; the video part was not touched.';
    }
    if (flattened) note += ' The see-through parts were painted over ' + bg + ', because JPG cannot hold transparency.';
    $('hc-achieved').textContent = note;
    const prev = $('hc-preview');
    prev.src = url;
    prev.classList.remove('hidden');
    result.classList.remove('hidden');
    const stamp = $('hc-stamp');
    stamp.classList.remove('land');
    void stamp.offsetWidth;
    stamp.classList.add('land');
    setStatus('Done.');
    recordJob({ tool: 'HEIC to ' + NAMES[outFormat], name: file.name, detail: fmtBytes(file.size) + ' to ' + fmtBytes(r.bytes) });
  } catch (err) {
    setStatus('Something went wrong with this file: ' + (err && err.message ? err.message : err));
  } finally {
    running = false;
    runBtn.disabled = false;
  }
});
