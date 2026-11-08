// Batch image bench: one queue, two jobs (shrink every photo to one exact
// KB target; convert a folder to one format), results packed into a
// single ZIP. Engine: the measured jSquash set via lib/image-core, the
// compress-image island's own codecs and combined search (bench/imgnums:
// 25 images converted in 22.1 s total on the bench). AVIF is not offered:
// the bench measured 49.7 s a photo, and the page says so.
import { fmtBytes, recordJob, wireTrayMulti } from './workbench.js';
import { initImageCodecs, decodeImageFile, compressImageToTarget, encodeImage } from './lib/image-core.js';
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
} else {
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
        } else {
          const maxW = parseInt(($('bi-maxwidth') || {}).value, 10);
          const r = await encodeImage(img, format, quality, isNaN(maxW) ? null : maxW);
          const name = baseName(e.file.name) + '.' + r.ext;
          const blob = new Blob([r.buf], { type: r.mime });
          const url = URL.createObjectURL(blob);
          zipEntries.push({ name, data: new Uint8Array(r.buf) });
          addResultRow(e.file.name, fmtBytes(e.file.size) + ' to ' + fmtBytes(r.bytes) + ' ' + format.toUpperCase() + ', ' + r.width + 'x' + r.height,
            downloadLink(url, name, 'Download'));
        }
        done++;
      } catch (err) {
        addResultRow(e.file.name, 'failed: ' + (err && err.message ? err.message : err), null);
        failed++;
      }
    }
    recordJob({
      tool: MODE === 'compress' ? 'Batch compress images' : 'Batch convert images',
      name: entries.length + ' files',
      detail: done + ' done, ' + failed + ' failed' + (MODE === 'compress' ? ', target ' + targetKB + ' KB' : ', to ' + format.toUpperCase()),
    });
    if (zipEntries.length >= 1) {
      const { blob, name } = await makeZip(zipEntries, MODE === 'compress' ? 'benchzy-batch-images.zip' : 'benchzy-batch-converted.zip');
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
