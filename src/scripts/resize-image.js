// Resize image: one photo to exact pixel dimensions, by percent, or
// from the honest preset sizes. Engine: the shared jSquash core
// (lib/image-core) — the same codecs and the same resize the exact-KB
// search uses. No new engine; this island is a new tool because the
// job (dimensions, not bytes) is a different one.
// Rules the page prints and the code keeps: the aspect lock keeps the
// photo's own shape; with the lock on and both boxes filled, the photo
// fits inside that frame; upscaling is allowed but stated plainly —
// bigger is not sharper, and no "enhance" word appears anywhere.
import { fmtBytes, recordJob, savePreset, getPreset, wireTray } from './workbench.js';
import { initImageCodecs, decodeImageFile, resizeImageData, encodeImage, hasAlpha, flattenOnto } from './lib/image-core.js';

const $ = (id) => document.getElementById(id);
const tray = $('ri-tray'), input = $('ri-file'), spec = $('ri-spec');
const runBtn = $('ri-run'), status = $('ri-status'), result = $('ri-result');
const outLine = $('ri-out');
let file = null, img = null, running = false;
let mode = 'pixels'; // 'pixels' | 'percent'
let format = 'same'; // 'same' | 'jpeg' | 'png' | 'webp'
let quality = 90;
let bg = '#ffffff';

const saved = getPreset('resize-image');
if (saved) {
  if (saved.mode === 'pixels' || saved.mode === 'percent') mode = saved.mode;
  if (['same', 'jpeg', 'png', 'webp'].includes(saved.format)) format = saved.format;
  if (typeof saved.quality === 'number') quality = saved.quality;
  if (typeof saved.bg === 'string') bg = saved.bg;
}

function setStatus(msg) { status.textContent = msg; }
function setSpec(rows) {
  spec.innerHTML = rows.map(([k, v]) => `<div class="spec-row"><dt>${k}</dt><dd>${v}</dd></div>`).join('');
}

function inputFormat() {
  if (!file) return 'jpeg';
  if (file.type === 'image/png') return 'png';
  if (file.type === 'image/webp') return 'webp';
  return 'jpeg';
}
function effFormat() { return format === 'same' ? inputFormat() : format; }

function num(id) {
  const v = parseInt(($(id) || {}).value, 10);
  return isNaN(v) || v <= 0 ? null : v;
}

// The target size, from whichever way the visitor picked. Returns
// { w, h } in whole pixels, never below 1, or null without a photo.
function computeTarget() {
  if (!img) return null;
  const W = img.width, H = img.height;
  if (mode === 'percent') {
    const p = num('ri-percent') || 50;
    return { w: Math.max(1, Math.round(W * p / 100)), h: Math.max(1, Math.round(H * p / 100)) };
  }
  const lock = $('ri-lock').checked;
  const tw = num('ri-width'), th = num('ri-height');
  if (!lock) return { w: tw || W, h: th || H };
  if (tw && th) {
    const s = Math.min(tw / W, th / H);
    return { w: Math.max(1, Math.round(W * s)), h: Math.max(1, Math.round(H * s)) };
  }
  if (tw) return { w: tw, h: Math.max(1, Math.round(H * (tw / W))) };
  if (th) return { w: Math.max(1, Math.round(W * (th / H))), h: th };
  return { w: W, h: H };
}

function refreshOut() {
  const t = computeTarget();
  const fmt = effFormat();
  $('ri-bg-row').classList.toggle('hidden', fmt !== 'jpeg');
  $('ri-quality-row').classList.toggle('hidden', fmt === 'png');
  if (!t) { outLine.textContent = file ? '' : 'Pick a photo and its size lands here.'; return; }
  let line = 'Result will be ' + t.w + ' x ' + t.h + ' px, ' + fmt.toUpperCase() + '.';
  if (img && (t.w > img.width || t.h > img.height)) {
    line += ' That is bigger than the original: the file grows, the sharpness does not. No detail is added.';
  }
  if (img && t.w === img.width && t.h === img.height && fmt === inputFormat()) {
    line += ' Same size and format as the original: the photo comes back re-encoded, unchanged in shape.';
  }
  outLine.textContent = line;
}

function syncModeChips() {
  document.querySelectorAll('#ri-modes .chip').forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.mode === mode)));
  $('ri-pixels-panel').classList.toggle('hidden', mode !== 'pixels');
  $('ri-percent-panel').classList.toggle('hidden', mode !== 'percent');
}

document.querySelectorAll('#ri-modes .chip').forEach((chip) => {
  chip.addEventListener('click', () => { mode = chip.dataset.mode; syncModeChips(); refreshOut(); });
});
document.querySelectorAll('#ri-presets .chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    mode = 'pixels';
    $('ri-width').value = chip.dataset.w || '';
    $('ri-height').value = chip.dataset.h || '';
    syncModeChips();
    refreshOut();
    if (!file) setStatus('Preset set: ' + chip.textContent.trim() + '. Now pick the photo.');
  });
});
document.querySelectorAll('.ri-pct-chip').forEach((chip) => {
  chip.addEventListener('click', () => { $('ri-percent').value = chip.dataset.pct; refreshOut(); });
});
document.querySelectorAll('#ri-formats .chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('#ri-formats .chip').forEach((c) => c.setAttribute('aria-pressed', 'false'));
    chip.setAttribute('aria-pressed', 'true');
    format = chip.dataset.format;
    refreshOut();
  });
});
document.querySelectorAll('#ri-bgs .chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('#ri-bgs .chip').forEach((c) => c.setAttribute('aria-pressed', 'false'));
    chip.setAttribute('aria-pressed', 'true');
    bg = chip.dataset.bg;
    $('ri-bg').value = bg;
  });
});
$('ri-bg').addEventListener('input', () => { bg = $('ri-bg').value; });
$('ri-quality').addEventListener('change', () => {
  const v = parseInt($('ri-quality').value, 10);
  if (v >= 1 && v <= 100) quality = v;
});
for (const id of ['ri-width', 'ri-height', 'ri-percent']) {
  $(id).addEventListener('input', refreshOut);
}
$('ri-lock').addEventListener('change', refreshOut);

{ // restore saved settings into the controls
  const fmatch = document.querySelector(`#ri-formats .chip[data-format="${format}"]`);
  if (fmatch) fmatch.setAttribute('aria-pressed', 'true');
  $('ri-quality').value = quality;
  $('ri-bg').value = bg;
  if (saved) {
    if (saved.width) $('ri-width').value = saved.width;
    if (saved.height) $('ri-height').value = saved.height;
    if (saved.pct) $('ri-percent').value = saved.pct;
    if (typeof saved.lock === 'boolean') $('ri-lock').checked = saved.lock;
  }
  syncModeChips();
}

wireTray(tray, input, async (f) => {
  file = f;
  img = null;
  result.classList.add('hidden');
  runBtn.disabled = true;
  try {
    setStatus('Loading the image program (about 2 MB, one time only). It runs in your browser to protect your privacy: your file never leaves your device…');
    await initImageCodecs();
    setStatus('Reading the photo…');
    img = await decodeImageFile(f, await f.arrayBuffer());
    setSpec([
      ['file', f.name],
      ['format', f.type || 'image'],
      ['size now', fmtBytes(f.size)],
      ['dimensions', img.width + ' x ' + img.height + ' px'],
    ]);
    runBtn.disabled = false;
    setStatus('Ready. Pick the new size, then press Resize.');
    refreshOut();
  } catch (err) {
    setStatus('That file could not be read as a picture: ' + (err && err.message ? err.message : err));
  }
});

runBtn.addEventListener('click', async () => {
  if (!file || !img || running) return;
  running = true;
  runBtn.disabled = true;
  result.classList.add('hidden');
  try {
    const t = computeTarget();
    const fmt = effFormat();
    setStatus('Resizing to ' + t.w + ' x ' + t.h + ' px…');
    let im = (t.w === img.width && t.h === img.height) ? img : await resizeImageData(img, t.w, t.h);
    let flattened = false;
    if (fmt === 'jpeg' && hasAlpha(im)) {
      im = flattenOnto(im, bg);
      flattened = true;
    }
    const r = await encodeImage(im, fmt, quality, null);
    const blob = new Blob([r.buf], { type: r.mime });
    const url = URL.createObjectURL(blob);
    const dl = $('ri-download');
    const base = file.name.replace(/\.[^.]+$/, '');
    dl.href = url;
    dl.download = base + '-resized.' + r.ext;
    const grew = t.w > img.width || t.h > img.height;
    let note = img.width + ' x ' + img.height + ' px, ' + fmtBytes(file.size) + ' → ' + t.w + ' x ' + t.h + ' px, ' + fmtBytes(r.bytes)
      + ' (' + fmt.toUpperCase() + (fmt === 'png' ? ', lossless' : ', quality ' + quality) + ').';
    if (flattened) note += ' The see-through parts were painted over ' + bg + ', because JPG cannot hold transparency.';
    if (grew) note += ' Made bigger, as asked: the file grew, the sharpness did not. No detail was added.';
    $('ri-achieved').textContent = note;
    const prev = $('ri-preview');
    prev.src = url;
    prev.classList.remove('hidden');
    result.classList.remove('hidden');
    const stamp = $('ri-stamp');
    stamp.classList.remove('land');
    void stamp.offsetWidth;
    stamp.classList.add('land');
    setStatus('Done.');
    recordJob({ tool: 'Resize image', name: file.name, detail: img.width + 'x' + img.height + ' to ' + t.w + 'x' + t.h });
    savePreset('resize-image', {
      mode, format, quality, bg,
      width: $('ri-width').value, height: $('ri-height').value,
      pct: $('ri-percent').value, lock: $('ri-lock').checked,
    });
  } catch (err) {
    setStatus('Something went wrong with this file: ' + (err && err.message ? err.message : err));
  } finally {
    running = false;
    runBtn.disabled = false;
  }
});

refreshOut();
