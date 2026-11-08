// Merge PDF: several PDFs in, one PDF out, in the order on the list.
// Engine: @cantoo/pdf-lib, the measured bench pipeline (bench/pdfnums:
// 25 files merged in 71 ms, output smaller than the biggest site's on the
// same files). Built as habit infrastructure per BUILD-PLAN item 17.
import { PDFDocument } from '@cantoo/pdf-lib';
import { fmtBytes, recordJob, wireTrayMulti } from './workbench.js';

const $ = (id) => document.getElementById(id);
const tray = $('mg-tray'), input = $('mg-file'), listEl = $('mg-list');
const spec = $('mg-spec'), runBtn = $('mg-run'), status = $('mg-status'), result = $('mg-result');
let entries = []; // { file, bytes, pages, error }
let running = false;

function setStatus(msg) { status.textContent = msg; }
function setSpec(rows) {
  spec.innerHTML = rows.map(([k, v]) => `<div class="spec-row"><dt>${k}</dt><dd>${v}</dd></div>`).join('');
}

function totals() {
  const ok = entries.filter((e) => !e.error);
  return {
    files: entries.length,
    ok: ok.length,
    pages: ok.reduce((a, e) => a + (e.pages || 0), 0),
    bytes: entries.reduce((a, e) => a + e.file.size, 0),
  };
}

function refresh() {
  const t = totals();
  setSpec([
    ['files on the tray', String(t.files)],
    ['pages in order', String(t.pages)],
    ['size in', fmtBytes(t.bytes)],
  ]);
  runBtn.disabled = !(t.ok >= 2) || running;
  listEl.innerHTML = '';
  entries.forEach((e, i) => {
    const li = document.createElement('li');
    li.className = 'spec-row items-center';
    const left = document.createElement('span');
    left.textContent = (i + 1) + '. ' + e.file.name;
    const right = document.createElement('span');
    right.className = 'flex items-center gap-2 flex-wrap justify-end';
    const meta = document.createElement('span');
    meta.textContent = e.error ? 'not a readable PDF' : e.pages + ' page' + (e.pages === 1 ? '' : 's') + ' · ' + fmtBytes(e.file.size);
    if (e.error) meta.className = 'text-accent-deep';
    right.appendChild(meta);
    const mk = (label, fn, disabled) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.textContent = label;
      b.disabled = !!disabled;
      b.addEventListener('click', fn);
      return b;
    };
    right.append(
      mk('Up', () => { [entries[i - 1], entries[i]] = [entries[i], entries[i - 1]]; refresh(); }, i === 0),
      mk('Down', () => { [entries[i + 1], entries[i]] = [entries[i], entries[i + 1]]; refresh(); }, i === entries.length - 1),
      mk('Remove', () => { entries.splice(i, 1); refresh(); }, false),
    );
    li.append(left, right);
    listEl.appendChild(li);
  });
  if (entries.length === 0) setStatus('Pick two or more PDFs to begin.');
  else if (t.ok < 2) setStatus('Add at least two readable PDFs to merge.');
  else setStatus('Ready. The merged file follows the order on this list, top to bottom.');
}

wireTrayMulti(tray, input, async (files) => {
  result.classList.add('hidden');
  for (const f of files) {
    const entry = { file: f, bytes: null, pages: 0, error: null };
    try {
      entry.bytes = new Uint8Array(await f.arrayBuffer());
      const doc = await PDFDocument.load(entry.bytes, { updateMetadata: false });
      entry.pages = doc.getPageCount();
    } catch (err) {
      entry.error = err && err.message ? err.message : String(err);
    }
    entries.push(entry);
  }
  refresh();
});

runBtn.addEventListener('click', async () => {
  const ok = entries.filter((e) => !e.error);
  if (ok.length < 2 || running) return;
  running = true;
  runBtn.disabled = true;
  result.classList.add('hidden');
  try {
    setStatus('Merging on this device…');
    const out = await PDFDocument.create();
    for (const e of ok) {
      const src = await PDFDocument.load(e.bytes, { updateMetadata: false });
      const copied = await out.copyPages(src, src.getPageIndices());
      copied.forEach((p) => out.addPage(p));
    }
    const bytes = await out.save();
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const dl = $('mg-download');
    dl.href = url;
    dl.download = 'merged-benchzy.pdf';
    $('mg-achieved').textContent =
      ok.length + ' files merged into one PDF of ' + out.getPageCount() + ' pages, ' + fmtBytes(bytes.length) +
      ' (the files going in were ' + fmtBytes(ok.reduce((a, e) => a + e.file.size, 0)) + ' together). Check the page order before you rely on it: page order is the list order, and this page does not inspect what is on the pages.';
    result.classList.remove('hidden');
    const stamp = $('mg-stamp');
    stamp.classList.remove('land');
    void stamp.offsetWidth;
    stamp.classList.add('land');
    setStatus('Done.');
    recordJob({ tool: 'Merge PDF', name: ok.length + ' files', detail: out.getPageCount() + ' pages, ' + fmtBytes(bytes.length) });
  } catch (err) {
    setStatus('Something went wrong merging: ' + (err && err.message ? err.message : err));
  } finally {
    running = false;
    refresh();
  }
});

refresh();
