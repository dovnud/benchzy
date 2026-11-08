// Batch PDF bench: one queue, three jobs (compress, split, merge), one
// preset applied to every file, results packed into a single ZIP.
// Engines: the measured @cantoo/pdf-lib pipeline via the shared cores
// (compress = lib/pdf-compress-core, the compress-pdf island's own
// ladder; merge/split = the page-copying the merge and split benches
// measured). The mode is set by data-mode on #bp-tool; each batch door
// page carries the same ticket furniture with its own settings.
import { PDFDocument } from '@cantoo/pdf-lib';
import { fmtBytes, recordJob, wireTrayMulti } from './workbench.js';
import { compressPdfToTarget } from './lib/pdf-compress-core.js';
import { makeZip } from './lib/zip.js';

const $ = (id) => document.getElementById(id);
const toolEl = $('bp-tool');
const MODE = toolEl && toolEl.dataset.mode ? toolEl.dataset.mode : 'compress';
const tray = $('bp-tray'), input = $('bp-file'), listEl = $('bp-list');
const spec = $('bp-spec'), runBtn = $('bp-run'), status = $('bp-status'), result = $('bp-result');
const rowsEl = $('bp-rows'), zipLink = $('bp-zip');
const TITLES = { compress: 'Batch compress PDF', split: 'Batch split PDF', merge: 'Batch merge PDF' };
let entries = []; // { file, pages, error }
let running = false;
let targetKB = 500;

function setStatus(msg) { status.textContent = msg; }
function setSpec(rows) {
  spec.innerHTML = rows.map(([k, v]) => `<div class="spec-row"><dt>${k}</dt><dd>${v}</dd></div>`).join('');
}
function baseName(name) { return name.replace(/\.pdf$/i, ''); }

if (MODE === 'compress') {
  document.querySelectorAll('#bp-targets .chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('#bp-targets .chip').forEach((c) => c.setAttribute('aria-pressed', 'false'));
      chip.setAttribute('aria-pressed', 'true');
      targetKB = parseInt(chip.dataset.kb, 10);
      const ci = $('bp-custom'); if (ci) ci.value = targetKB;
    });
  });
  const ci = $('bp-custom');
  if (ci) ci.addEventListener('change', () => {
    const v = parseInt(ci.value, 10);
    if (v >= 20 && v <= 50000) targetKB = v;
  });
  const match = document.querySelector(`#bp-targets .chip[data-kb="${targetKB}"]`);
  if (match) match.setAttribute('aria-pressed', 'true');
}

function refresh() {
  const ok = entries.filter((e) => !e.error);
  const pages = ok.reduce((a, e) => a + (e.pages || 0), 0);
  const bytes = entries.reduce((a, e) => a + e.file.size, 0);
  setSpec([
    ['files on the tray', String(entries.length)],
    ...(MODE === 'merge' ? [['pages in order', String(pages)]] : [['readable PDFs', String(ok.length)]]),
    ['size in', fmtBytes(bytes)],
  ]);
  runBtn.disabled = running || (MODE === 'merge' ? ok.length < 2 : ok.length < 1);
  listEl.innerHTML = '';
  entries.forEach((e, i) => {
    const li = document.createElement('li');
    li.className = 'spec-row items-center';
    const left = document.createElement('span');
    left.textContent = (i + 1) + '. ' + e.file.name;
    const right = document.createElement('span');
    right.className = 'flex items-center gap-2 flex-wrap justify-end';
    const meta = document.createElement('span');
    meta.textContent = e.error ? 'not a readable PDF' : (e.pages != null ? e.pages + ' page' + (e.pages === 1 ? '' : 's') + ' · ' : '') + fmtBytes(e.file.size);
    if (e.error) meta.className = 'text-accent-deep';
    right.appendChild(meta);
    const mk = (label, fn, disabled) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'chip'; b.textContent = label; b.disabled = !!disabled;
      b.addEventListener('click', fn);
      return b;
    };
    if (MODE === 'merge') {
      right.append(
        mk('Up', () => { [entries[i - 1], entries[i]] = [entries[i], entries[i - 1]]; refresh(); }, i === 0),
        mk('Down', () => { [entries[i + 1], entries[i]] = [entries[i], entries[i + 1]]; refresh(); }, i === entries.length - 1),
      );
    }
    right.append(mk('Remove', () => { entries.splice(i, 1); refresh(); }, false));
    li.append(left, right);
    listEl.appendChild(li);
  });
  if (!entries.length) setStatus(MODE === 'merge' ? 'Pick two or more PDFs to begin.' : 'Pick PDFs to begin.');
}

wireTrayMulti(tray, input, async (files) => {
  result.classList.add('hidden');
  for (const f of files) {
    const entry = { file: f, pages: null, error: null };
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      const doc = await PDFDocument.load(bytes, { updateMetadata: false });
      entry.pages = doc.getPageCount();
    } catch (err) {
      entry.error = err && err.message ? err.message : String(err);
    }
    entries.push(entry);
  }
  refresh();
});

const folderInput = $('bp-folder-file');
if (folderInput) {
  $('bp-folder-btn').addEventListener('click', () => folderInput.click());
  folderInput.addEventListener('change', () => {
    const fs = [...folderInput.files].filter((f) => /\.pdf$/i.test(f.name) || f.type === 'application/pdf');
    if (fs.length) {
      result.classList.add('hidden');
      (async () => {
        for (const f of fs) {
          const entry = { file: f, pages: null, error: null };
          try {
            const bytes = new Uint8Array(await f.arrayBuffer());
            const doc = await PDFDocument.load(bytes, { updateMetadata: false });
            entry.pages = doc.getPageCount();
          } catch (err) { entry.error = err && err.message ? err.message : String(err); }
          entries.push(entry);
        }
        refresh();
      })();
    }
    folderInput.value = '';
  });
}
const sortChip = $('bp-sort');
if (sortChip) sortChip.addEventListener('click', () => {
  entries.sort((a, b) => a.file.name.localeCompare(b.file.name));
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
const REASONS = {
  'already-under': 'already under the target; original kept',
  'no-photos': 'no photos inside to recompress; original kept',
  'unreadable-photos': 'photos in a format this page cannot re-encode yet; original kept',
  'no-smaller': 'could not be made smaller; original kept',
};

runBtn.addEventListener('click', async () => {
  if (running) return;
  const ok = entries.filter((e) => !e.error);
  if (MODE === 'merge' ? ok.length < 2 : ok.length < 1) return;
  running = true;
  runBtn.disabled = true;
  result.classList.add('hidden');
  rowsEl.innerHTML = '';
  zipLink.classList.add('hidden');
  const zipEntries = [];
  let done = 0, failed = 0;
  try {
    if (MODE === 'merge') {
      setStatus('Merging on this device…');
      const out = await PDFDocument.create();
      for (const e of ok) {
        const src = await PDFDocument.load(new Uint8Array(await e.file.arrayBuffer()), { updateMetadata: false });
        const copied = await out.copyPages(src, src.getPageIndices());
        copied.forEach((p) => out.addPage(p));
      }
      const bytes = await out.save();
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      addResultRow('merged-benchzy.pdf', ok.length + ' files, ' + out.getPageCount() + ' pages, ' + fmtBytes(bytes.length),
        downloadLink(url, 'merged-benchzy.pdf', 'Download (' + fmtBytes(bytes.length) + ')'));
      recordJob({ tool: TITLES[MODE], name: ok.length + ' files', detail: out.getPageCount() + ' pages, ' + fmtBytes(bytes.length) });
      setStatus('Done. One merged file from ' + ok.length + ' PDFs.');
    } else if (MODE === 'compress') {
      const target = targetKB * 1024;
      for (const e of entries) {
        if (e.error) { addResultRow(e.file.name, 'skipped: not a readable PDF', null); failed++; continue; }
        setStatus('Working on ' + e.file.name + ' (' + (done + failed + 1) + ' of ' + entries.length + ')…');
        try {
          const bytes = new Uint8Array(await e.file.arrayBuffer());
          const r = await compressPdfToTarget(bytes, target);
          if (r.changed) {
            const name = baseName(e.file.name) + '-smaller.pdf';
            const url = URL.createObjectURL(new Blob([r.out], { type: 'application/pdf' }));
            zipEntries.push({ name, data: r.out });
            addResultRow(e.file.name, fmtBytes(e.file.size) + ' to ' + fmtBytes(r.out.length) + (r.underTarget ? ', under the ' + targetKB + ' KB target' : ', smallest reached (above target)'),
              downloadLink(url, name, 'Download'));
          } else {
            const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
            zipEntries.push({ name: e.file.name, data: bytes });
            addResultRow(e.file.name, REASONS[r.reason] || 'unchanged', downloadLink(url, e.file.name, 'Original'));
          }
          done++;
        } catch (err) {
          addResultRow(e.file.name, 'failed: ' + (err && err.message ? err.message : err), null);
          failed++;
        }
      }
      recordJob({ tool: TITLES[MODE], name: entries.length + ' files', detail: done + ' done, ' + failed + ' skipped, target ' + targetKB + ' KB' });
      setStatus('Done. ' + done + ' of ' + entries.length + ' files processed' + (failed ? ', ' + failed + ' skipped (listed above)' : '') + '.');
    } else { // split
      const from = Math.max(1, parseInt(($('bp-from') || {}).value, 10) || 1);
      const toRaw = parseInt(($('bp-to') || {}).value, 10);
      for (const e of entries) {
        if (e.error) { addResultRow(e.file.name, 'skipped: not a readable PDF', null); failed++; continue; }
        setStatus('Working on ' + e.file.name + ' (' + (done + failed + 1) + ' of ' + entries.length + ')…');
        try {
          const bytes = new Uint8Array(await e.file.arrayBuffer());
          const src = await PDFDocument.load(bytes, { updateMetadata: false });
          const count = src.getPageCount();
          const a = Math.min(from, count);
          const b = Math.min(isNaN(toRaw) ? count : toRaw, count);
          if (b < a) { addResultRow(e.file.name, 'skipped: the range does not fit this file (' + count + ' pages)', null); failed++; continue; }
          // Delete-based extraction, as on the Split PDF bench: pages
          // whose images live in shared page-tree resources survive
          // removal whole, where a copy into a new file can lose them.
          for (let i = count - 1; i >= 0; i--) if (i < a - 1 || i > b - 1) src.removePage(i);
          const outBytes = await src.save();
          const name = baseName(e.file.name) + '-pages-' + a + '-' + b + '.pdf';
          const url = URL.createObjectURL(new Blob([outBytes], { type: 'application/pdf' }));
          zipEntries.push({ name, data: outBytes });
          addResultRow(e.file.name, 'pages ' + a + '–' + b + ' of ' + count + ', ' + fmtBytes(outBytes.length), downloadLink(url, name, 'Download'));
          done++;
        } catch (err) {
          addResultRow(e.file.name, 'failed: ' + (err && err.message ? err.message : err), null);
          failed++;
        }
      }
      recordJob({ tool: TITLES[MODE], name: entries.length + ' files', detail: done + ' done, ' + failed + ' skipped' });
      setStatus('Done. ' + done + ' of ' + entries.length + ' files cut' + (failed ? ', ' + failed + ' skipped (listed above)' : '') + '.');
    }
    if (zipEntries.length > 1 || (zipEntries.length === 1 && MODE !== 'merge')) {
      const { blob, name } = await makeZip(zipEntries, MODE === 'compress' ? 'benchzy-batch-compressed.zip' : 'benchzy-batch-split.zip');
      zipLink.href = URL.createObjectURL(blob);
      zipLink.download = name;
      zipLink.textContent = 'Download all as one ZIP (' + fmtBytes(blob.size) + ')';
      zipLink.classList.remove('hidden');
    }
    result.classList.remove('hidden');
    const stamp = $('bp-stamp');
    stamp.classList.remove('land');
    void stamp.offsetWidth;
    stamp.classList.add('land');
  } catch (err) {
    setStatus('Something went wrong: ' + (err && err.message ? err.message : err));
  } finally {
    running = false;
    refresh();
  }
});

refresh();
