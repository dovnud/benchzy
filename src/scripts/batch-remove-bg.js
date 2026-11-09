// Batch background removal: a folder of photos through the flagship
// engine, one at a time, each cut out at its own full size, results
// packed into a single ZIP. Engine: lib/bg-engine, the remove-background
// island's own pipeline (ISNet, 11 hash-checked pieces, service-worker
// cached after the first visit). The model downloads once for the whole
// batch, and its size is printed before anything loads. A photo with no
// clear subject is listed as such, never silently passed over.
import { fmtBytes, recordJob, wireTrayMulti } from './workbench.js';
import { loadBgSession, cutoutBitmap, bitmapFromPhotoFile, MODEL_BYTES } from './lib/bg-engine.js';
import { makeZip } from './lib/zip.js';

const $ = (id) => document.getElementById(id);
const tray = $('bb-tray'), input = $('bb-file'), listEl = $('bb-list');
const spec = $('bb-spec'), runBtn = $('bb-run'), status = $('bb-status'), result = $('bb-result');
const cancelBtn = $('bb-cancel');
const rowsEl = $('bb-rows'), zipLink = $('bb-zip');
let entries = []; // { file, bitmap, error }
let running = false;
// Cancel support (milestone 8, round-1 fix 2): the one model load can
// be cancelled; pieces already fetched are kept by the engine, so the
// next run resumes the load instead of starting over.
let loadAbort = null;
if (cancelBtn) {
  cancelBtn.addEventListener('click', () => { if (loadAbort) loadAbort.abort(); });
}

function setStatus(msg) { status.textContent = msg; }
function setSpec(rows) {
  spec.innerHTML = rows.map(([k, v]) => `<div class="spec-row"><dt>${k}</dt><dd>${v}</dd></div>`).join('');
}
function baseName(name) { return name.replace(/\.[^.]+$/, ''); }

function refresh() {
  const ok = entries.filter((e) => !e.error);
  setSpec([
    ['files on the tray', String(entries.length)],
    ['readable images', String(ok.length)],
    ['model', fmtBytes(MODEL_BYTES) + ', loads once'],
  ]);
  runBtn.disabled = running || ok.length < 1;
  listEl.innerHTML = '';
  entries.forEach((e, i) => {
    const li = document.createElement('li');
    li.className = 'spec-row items-center';
    const left = document.createElement('span');
    left.textContent = (i + 1) + '. ' + e.file.name;
    const right = document.createElement('span');
    right.className = 'flex items-center gap-2 flex-wrap justify-end';
    const meta = document.createElement('span');
    meta.textContent = e.error ? 'not a readable image' : e.bitmap.width + ' x ' + e.bitmap.height + ' · ' + fmtBytes(e.file.size);
    if (e.error) meta.className = 'text-accent-deep';
    const rm = document.createElement('button');
    rm.type = 'button'; rm.className = 'chip'; rm.textContent = 'Remove';
    rm.addEventListener('click', () => { entries.splice(i, 1); refresh(); });
    right.append(meta, rm);
    li.append(left, right);
    listEl.appendChild(li);
  });
  if (!entries.length) setStatus('Pick images to begin. The removal program (44.3 MB) loads once, when you press start.');
}

wireTrayMulti(tray, input, async (files) => {
  result.classList.add('hidden');
  for (const f of files) {
    const entry = { file: f, bitmap: null, error: null };
    try {
      // HEIC photos decode through the shipped libheif reader
      // (milestone 18), the same route as the single-photo tool.
      entry.bitmap = (await bitmapFromPhotoFile(f)).bitmap;
    } catch (err) {
      entry.error = err && err.message ? err.message : String(err);
    }
    entries.push(entry);
  }
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

runBtn.addEventListener('click', async () => {
  if (running) return;
  const ok = entries.filter((e) => !e.error);
  if (ok.length < 1) return;
  running = true;
  runBtn.disabled = true;
  result.classList.add('hidden');
  rowsEl.innerHTML = '';
  zipLink.classList.add('hidden');
  const zipEntries = [];
  let done = 0, noSubject = 0, failed = 0;
  loadAbort = new AbortController();
  if (cancelBtn) cancelBtn.classList.remove('hidden');
  try {
    await loadBgSession((p) => {
      if (p.phase === 'piece') setStatus('Loading the removal program: ' + p.gotMB.toFixed(1) + ' of ' + p.totalMB.toFixed(1) + ' MB (piece ' + p.piece + ' of ' + p.pieces + ', each one checked)…');
      else if (p.phase === 'list') setStatus('Loading the tool program (44 MB, one time only). It runs in your browser to protect your privacy: your photos never leave your device…');
      else if (p.phase === 'checked') setStatus('Model downloaded and checked. Starting it…');
      else if (p.phase === 'starting') setStatus('Starting the model…');
    }, loadAbort.signal);
    if (cancelBtn) cancelBtn.classList.add('hidden');
    for (const e of entries) {
      if (e.error) { addResultRow(e.file.name, 'skipped: not a readable image', null); failed++; continue; }
      setStatus('Removing the background from ' + e.file.name + ' (' + (done + noSubject + failed + 1) + ' of ' + entries.length + ')…');
      try {
        const r = await cutoutBitmap(e.bitmap);
        if (r.noSubject) {
          addResultRow(e.file.name, 'no clear subject found; nothing downloaded for this one', null);
          noSubject++;
        } else {
          const name = baseName(e.file.name) + '-no-background.png';
          const url = URL.createObjectURL(r.blob);
          zipEntries.push({ name, data: r.blob });
          const a = document.createElement('a');
          a.className = 'chip no-underline';
          a.href = url; a.download = name; a.textContent = 'Download';
          addResultRow(e.file.name, 'cut out at full size ' + r.width + 'x' + r.height + ', ' + fmtBytes(r.blob.size) + ', in ' + r.runSecs.toFixed(1) + ' s', a);
          done++;
        }
      } catch (err) {
        addResultRow(e.file.name, 'failed: ' + (err && err.message ? err.message : err), null);
        failed++;
      }
    }
    recordJob({ tool: 'Batch remove background', name: entries.length + ' files', detail: done + ' cut out, ' + noSubject + ' no subject, ' + failed + ' failed' });
    if (zipEntries.length >= 1) {
      const { blob, name } = await makeZip(zipEntries, 'benchzy-batch-cutouts.zip');
      zipLink.href = URL.createObjectURL(blob);
      zipLink.download = name;
      zipLink.textContent = 'Download all as one ZIP (' + fmtBytes(blob.size) + ')';
      zipLink.classList.remove('hidden');
    }
    result.classList.remove('hidden');
    const stamp = $('bb-stamp');
    stamp.classList.remove('land');
    void stamp.offsetWidth;
    stamp.classList.add('land');
    setStatus('Done. ' + done + ' of ' + entries.length + ' photos cut out' + (noSubject ? ', ' + noSubject + ' with no clear subject' : '') + (failed ? ', ' + failed + ' skipped' : '') + '.');
  } catch (err) {
    if (err && err.cancelled) {
      setStatus('Loading stopped. ' + err.kept + ' of ' + err.total + ' pieces are already here and are kept; press start again and the load carries on from there. Nothing was run.');
    } else {
      setStatus('Something went wrong: ' + (err && err.message ? err.message : err));
    }
  } finally {
    if (cancelBtn) cancelBtn.classList.add('hidden');
    loadAbort = null;
    running = false;
    refresh();
  }
});

refresh();
