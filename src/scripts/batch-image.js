// Batch image bench: one queue, three jobs (shrink every photo to one
// exact KB target; convert a folder to one format; resize a folder to
// one pixel size), results packed into a single ZIP. Engine: the
// measured jSquash set via lib/image-core, the compress-image island's
// own codecs and combined search (bench/imgnums: 25 images converted
// in 22.1 s total on the bench). AVIF is not offered: the bench
// measured 49.7 s a photo, and the page says so.
import { fmtBytes, recordJob, wireTrayMulti } from './workbench.js';
import { initImageCodecs, decodeImageFile, compressImageToTarget, encodeImage, resizeImageData } from './lib/image-core.js';
import { makeZip } from './lib/zip.js';

const $ = (id) => document.getElementById(id);
const toolEl = $('bi-tool');
const MODE = toolEl && toolEl.dataset.mode ? toolEl.dataset.mode : 'compress';
const tray = $('bi-tray'), input = $('bi-file'), listEl = $('bi-list');
const spec = $('bi-spec'), runBtn = $('bi-run'), status = $('bi-status'), result = $('bi-result');
const rowsEl = $('bi-rows'), zipLink = $('bi-zip');
let entries = []; // { file, error }
let running = false;
let targetKB = 200, format = 'webp', quality = 80;
let rsWidth = null, rsHeight = null; // batch resize: the one size (milestone 11)

function setStatus(msg) { status.textContent = msg; }
function setSpec(rows) {
  spec.innerHTML = rows.map(([k, v]) => `<div class="spec-row"><dt>${k}</dt><dd>${v}</dd></div>`).join('');
}
function baseName(name) { return name.replace(/\.[^.]+$/, ''); }

if (MODE === 'compress') {
  document.querySelectorAll('#bi-targets .chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('#bi-targets .chip').forEach((c) => c.setAttribute('aria-pressed', 'false'));
      chip.setAttribute('aria-pressed', 'true');
      targetKB = parseInt(chip.dataset.kb, 10);
      const ci = $('bi-custom'); if (ci) ci.value = targetKB;
    });
  });
  const ci = $('bi-custom');
  if (ci) ci.addEventListener('change', () => {
    const v = parseInt(ci.value, 10);
    if (v >= 5 && v <= 20000) targetKB = v;
  });
  const match = document.querySelector(`#bi-targets .chip[data-kb="${targetKB}"]`);
  if (match) match.setAttribute('aria-pressed', 'true');
} else if (MODE === 'convert') {
  document.querySelectorAll('#bi-formats .chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('#bi-formats .chip').forEach((c) => c.setAttribute('aria-pressed', 'false'));
      chip.setAttribute('aria-pressed', 'true');
      format = chip.dataset.format;
    });
  });
  const match = document.querySelector(`#bi-formats .chip[data-format="${format}"]`);
  if (match) match.setAttribute('aria-pressed', 'true');
  const q = $('bi-quality');
  if (q) q.addEventListener('change', () => {
    const v = parseInt(q.value, 10);
    if (v >= 1 && v <= 100) quality = v;
  });
} else if (MODE === 'resize') {
  // One size for the whole folder: a width, a height, or both (both =
  // each photo fits inside that frame, keeping its own shape).
  const readSize = () => {
    const w = parseInt(($('bi-width') || {}).value, 10);
    const h = parseInt(($('bi-height') || {}).value, 10);
    rsWidth = w >= 1 && w <= 20000 ? w : null;
    rsHeight = h >= 1 && h <= 20000 ? h : null;
  };
  const wEl = $('bi-width'), hEl = $('bi-height');
  if (wEl) wEl.addEventListener('input', readSize);
  if (hEl) hEl.addEventListener('input', readSize);
  // Preset chips (milestone 18): the same sizes the single-photo
  // resize page offers; a chip fills the two boxes and reads them.
  document.querySelectorAll('#bi-presets [data-w]').forEach((chip) => {
    chip.addEventListener('click', () => {
      if (wEl) { wEl.value = chip.dataset.w || ''; wEl.dispatchEvent(new Event('input')); }
      if (hEl) { hEl.value = chip.dataset.h || ''; hEl.dispatchEvent(new Event('input')); }
      readSize();
    });
  });
  const q = $('bi-quality');
  if (q) q.addEventListener('change', () => {
    const v = parseInt(q.value, 10);
    if (v >= 1 && v <= 100) quality = v;
  });
}

function refresh() {
  const bytes = entries.reduce((a, e) => a + e.file.size, 0);
  setSpec([
    ['files on the tray', String(entries.length)],
    ['size in', fmtBytes(bytes)],
  ]);
  runBtn.disabled = running || entries.length < 1;
  listEl.innerHTML = '';
  entries.forEach((e, i) => {
    const li = document.createElement('li');
    li.className = 'spec-row items-center';
    const left = document.createElement('span');
    left.textContent = (i + 1) + '. ' + e.file.name;
    const right = document.createElement('span');
    right.className = 'flex items-center gap-2 flex-wrap justify-end';
    const meta = document.createElement('span');
    meta.textContent = (e.file.type || 'image') + ' · ' + fmtBytes(e.file.size);
    const rm = document.createElement('button');
    rm.type = 'button'; rm.className = 'chip'; rm.textContent = 'Remove';
    rm.addEventListener('click', () => { entries.splice(i, 1); refresh(); });
    right.append(meta, rm);
    li.append(left, right);
    listEl.appendChild(li);
  });
  if (!entries.length) setStatus('Pick images to begin.');
}

wireTrayMulti(tray, input, (files) => {
  result.classList.add('hidden');
  for (const f of files) entries.push({ file: f, error: null });
  refresh();
});

function addResultRow(name, note, link) {
  const row = document.createElement('div');
  row.className = 'spec-row items-center';
  const left = document.createElement('span');
  left.textContent = name;
  const right = document.createElement('span');
  right.className = 'flex items-center gap-3 flex-wrap justify-end';
  const meta = document.createElement('span');
  meta.textContent = note;
  right.appendChild(meta);
  if (link) right.appendChild(link);
  row.append(left, right);
  rowsEl.appendChild(row);
}
function downloadLink(url, name, label) {
  const a = document.createElement('a');
  a.className = 'chip no-underline';
  a.href = url; a.download = name; a.textContent = label;
  return a;
}

runBtn.addEventListener('click', async () => {
  if (running || entries.length < 1) return;
  running = true;
  runBtn.disabled = true;
  result.classList.add('hidden');
  rowsEl.innerHTML = '';
  zipLink.classList.add('hidden');
  const zipEntries = [];
  let done = 0, failed = 0;
  try {
    await initImageCodecs();
    for (const e of entries) {
      setStatus('Working on ' + e.file.name + ' (' + (done + failed + 1) + ' of ' + entries.length + ')…');
      try {
        const buf = await e.file.arrayBuffer();
        const img = await decodeImageFile(e.file, buf);
        if (MODE === 'compress') {
          const target = targetKB * 1024;
          if (e.file.size <= target && e.file.type === 'image/jpeg') {
            const url = URL.createObjectURL(e.file);
            zipEntries.push({ name: e.file.name, data: new Uint8Array(buf) });
            addResultRow(e.file.name, 'already under the target at ' + fmtBytes(e.file.size) + '; original kept', downloadLink(url, e.file.name, 'Original'));
          } else {
            const best = await compressImageToTarget(img, target);
            const name = baseName(e.file.name) + '-benchzy.jpg';
            const blob = new Blob([best.buf], { type: 'image/jpeg' });
            const url = URL.createObjectURL(blob);
            zipEntries.push({ name, data: new Uint8Array(best.buf) });
            addResultRow(e.file.name, fmtBytes(e.file.size) + ' to ' + fmtBytes(best.bytes) + ', quality ' + best.q + ', ' + best.w + 'x' + best.h + (best.bytes <= target ? '' : ' (closest reached, above target)'),
              downloadLink(url, name, 'Download'));
          }
        } else if (MODE === 'convert') {
          const maxW = parseInt(($('bi-maxwidth') || {}).value, 10);
          const r = await encodeImage(img, format, quality, isNaN(maxW) ? null : maxW);
          const name = baseName(e.file.name) + '.' + r.ext;
          const blob = new Blob([r.buf], { type: r.mime });
          const url = URL.createObjectURL(blob);
          zipEntries.push({ name, data: new Uint8Array(r.buf) });
          addResultRow(e.file.name, fmtBytes(e.file.size) + ' to ' + fmtBytes(r.bytes) + ' ' + format.toUpperCase() + ', ' + r.width + 'x' + r.height,
            downloadLink(url, name, 'Download'));
        } else {
          // Resize: every photo to the one size, each keeping its own
          // format and (inside the frame) its own shape.
          const fmt = e.file.type === 'image/png' ? 'png' : e.file.type === 'image/webp' ? 'webp' : 'jpeg';
          let tw, th;
          if (rsWidth && rsHeight) {
            const s = Math.min(rsWidth / img.width, rsHeight / img.height);
            tw = Math.max(1, Math.round(img.width * s)); th = Math.max(1, Math.round(img.height * s));
          } else if (rsWidth) { tw = rsWidth; th = Math.max(1, Math.round(img.height * (rsWidth / img.width))); }
          else if (rsHeight) { th = rsHeight; tw = Math.max(1, Math.round(img.width * (rsHeight / img.height))); }
          else { tw = img.width; th = img.height; }
          const im = (tw === img.width && th === img.height) ? img : await resizeImageData(img, tw, th);
          const r = await encodeImage(im, fmt, quality, null);
          const name = baseName(e.file.name) + '.' + r.ext;
          const blob = new Blob([r.buf], { type: r.mime });
          const url = URL.createObjectURL(blob);
          zipEntries.push({ name, data: new Uint8Array(r.buf) });
          addResultRow(e.file.name, img.width + 'x' + img.height + ' to ' + tw + 'x' + th + ' · ' + fmtBytes(e.file.size) + ' to ' + fmtBytes(r.bytes) + ' ' + fmt.toUpperCase(),
            downloadLink(url, name, 'Download'));
        }
        done++;
      } catch (err) {
        addResultRow(e.file.name, 'failed: ' + (err && err.message ? err.message : err), null);
        failed++;
      }
    }
    recordJob({
      tool: MODE === 'compress' ? 'Batch compress images' : MODE === 'convert' ? 'Batch convert images' : 'Batch resize images',
      name: entries.length + ' files',
      detail: done + ' done, ' + failed + ' failed' + (MODE === 'compress' ? ', target ' + targetKB + ' KB'
        : MODE === 'convert' ? ', to ' + format.toUpperCase()
        : ', to ' + (rsWidth || 'auto') + 'x' + (rsHeight || 'auto')),
    });
    if (zipEntries.length >= 1) {
      const { blob, name } = await makeZip(zipEntries, MODE === 'compress' ? 'benchzy-batch-images.zip'
        : MODE === 'convert' ? 'benchzy-batch-converted.zip' : 'benchzy-batch-resized.zip');
      zipLink.href = URL.createObjectURL(blob);
      zipLink.download = name;
      zipLink.textContent = 'Download all as one ZIP (' + fmtBytes(blob.size) + ')';
      zipLink.classList.remove('hidden');
    }
    result.classList.remove('hidden');
    const stamp = $('bi-stamp');
    stamp.classList.remove('land');
    void stamp.offsetWidth;
    stamp.classList.add('land');
    setStatus('Done. ' + done + ' of ' + entries.length + ' images processed' + (failed ? ', ' + failed + ' failed (listed above)' : '') + '.');
  } catch (err) {
    setStatus('Something went wrong: ' + (err && err.message ? err.message : err));
  } finally {
    running = false;
    refresh();
  }
});

refresh();
