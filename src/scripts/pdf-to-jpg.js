// PDF to JPG: render every page of a PDF into a picture, in this
// browser, with the shipped PDF.js. A page becomes a picture, so its
// words are part of the picture afterwards — they cannot be selected
// or searched as text, and the page copy says so before the run.
// Pages are rendered one at a time; the finished pictures are held
// only until they are packed, so a long document is a memory job,
// and the honest tested number (a 50-page document) is printed on
// the page. One page comes back as the picture itself; several come
// back in one ZIP (lib/zip.js, entries stored).
import { PDFDocument } from '@cantoo/pdf-lib';
import { fmtBytes, recordJob, savePreset, getPreset, wireTray } from './workbench.js';
import { makeZip } from './lib/zip.js';

const $ = (id) => document.getElementById(id);
const tray = $('pj-tray'), input = $('pj-file'), spec = $('pj-spec');
const runBtn = $('pj-run'), status = $('pj-status'), result = $('pj-result');
// Milestone 24: the /pdf-to-png/ door runs this same island with
// the format locked to PNG in its own markup; it sets its own
// preset key and tool name on #pj-tool so the two doors never
// overwrite each other's saved settings. No attributes = the
// milestone-14 PDF to JPG behaviour, unchanged.
const toolEl = $('pj-tool');
const PRESET_KEY = (toolEl && toolEl.dataset.presetKey) || 'pdf-to-jpg';
const TOOL_NAME = (toolEl && toolEl.dataset.toolName) || 'PDF to JPG';
let file = null, fileBytes = null, pages = 0, running = false;

function setStatus(msg) { status.textContent = msg; }
function setSpec(rows) {
  spec.innerHTML = rows.map(([k, v]) => `<div class="spec-row"><dt>${k}</dt><dd>${v}</dd></div>`).join('');
}
const picked = (name) => (document.querySelector('input[name="' + name + '"]:checked') || {}).value;

const saved = getPreset(PRESET_KEY);
if (saved) {
  if (saved.format) { const r = document.querySelector('input[name="pj-format"][value="' + saved.format + '"]'); if (r) r.checked = true; }
  if (saved.dpi) { const r = document.querySelector('input[name="pj-dpi"][value="' + saved.dpi + '"]'); if (r) r.checked = true; }
}
function remember() {
  savePreset(PRESET_KEY, { format: picked('pj-format') || 'jpg', dpi: Number(picked('pj-dpi')) || 96 });
}
for (const el of document.querySelectorAll('input[name="pj-format"], input[name="pj-dpi"]')) el.addEventListener('change', remember);

let pdfjsPromise = null;
function loadPdfjs() {
  if (!pdfjsPromise) {
    const url = '/pdfjs/pdf.min.mjs'; // self-hosted engine file; a variable keeps the bundler out of it
    pdfjsPromise = import(/* @vite-ignore */ url).then((m) => {
      m.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.min.mjs';
      return m;
    });
  }
  return pdfjsPromise;
}

wireTray(tray, input, async (f) => {
  result.classList.add('hidden');
  runBtn.disabled = true;
  file = f;
  try {
    fileBytes = new Uint8Array(await f.arrayBuffer());
    const doc = await PDFDocument.load(fileBytes, { updateMetadata: false, ignoreEncryption: true });
    pages = doc.getPageCount();
    if (doc.isEncrypted) {
      setSpec([
        ['file', f.name],
        ['size now', fmtBytes(f.size)],
        ['pages', String(pages)],
        ['password', 'this file has one'],
      ]);
      setStatus('This file has a password on it, so this page cannot open it. Take the password off first with the unlock tool, then bring the file back here.');
      return;
    }
    setSpec([
      ['file', f.name],
      ['size now', fmtBytes(f.size)],
      ['pages', String(pages)],
    ]);
    setStatus('Ready. Pick the picture kind and size, then turn the pages into pictures.');
    runBtn.disabled = false;
  } catch (err) {
    setStatus('That file could not be read as a PDF: ' + (err && err.message ? err.message : err));
  }
});

const DPI_WORDS = { 96: 'screen size (96 DPI)', 200: 'print size (200 DPI)' };

runBtn.addEventListener('click', async () => {
  if (!file || running) return;
  const format = picked('pj-format') || 'jpg';
  const dpi = Number(picked('pj-dpi')) || 96;
  running = true;
  runBtn.disabled = true;
  result.classList.add('hidden');
  try {
    setStatus('Loading the page-drawing program. It runs in your browser to protect your privacy: your file never leaves your device…');
    const pdfjs = await loadPdfjs();
    const pdf = await pdfjs.getDocument({ data: fileBytes.slice() }).promise;
    const total = pdf.numPages;
    const scale = dpi / 72;
    const base = file.name.replace(/\.pdf$/i, '');
    const pad = String(total).length;
    const made = [];
    let firstW = 0, firstH = 0, totalBytes = 0;
    for (let n = 1; n <= total; n++) {
      setStatus('Drawing page ' + n + ' of ' + total + ' as a picture…');
      const pg = await pdf.getPage(n);
      const vp = pg.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(vp.width);
      canvas.height = Math.round(vp.height);
      const ctx = canvas.getContext('2d');
      // Pages are drawn over white: a page with nothing behind its
      // drawings would otherwise turn see-through in a PNG and black
      // in a JPG, neither of which is what the page looks like.
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await pg.render({ canvasContext: ctx, viewport: vp }).promise;
      const blob = await new Promise((res) => {
        if (format === 'png') canvas.toBlob(res, 'image/png');
        else canvas.toBlob(res, 'image/jpeg', 0.92);
      });
      if (!blob) throw new Error('page ' + n + ' could not be saved as a picture');
      if (n === 1) { firstW = canvas.width; firstH = canvas.height; }
      totalBytes += blob.size;
      made.push({ name: base + '-page-' + String(n).padStart(pad, '0') + '.' + format, data: blob });
      pg.cleanup();
    }
    try { await pdf.loadingTask.destroy(); } catch (e) { /* already gone */ }
    const dl = $('pj-download');
    let achieved;
    if (total === 1) {
      dl.href = URL.createObjectURL(made[0].data);
      dl.download = made[0].name;
      achieved = 'One page became one ' + format.toUpperCase() + ' picture, ' + firstW + ' x ' + firstH + ' pixels at ' +
        DPI_WORDS[dpi] + ', ' + fmtBytes(totalBytes) + '.';
    } else {
      const zip = await makeZip(made, base + '-pages.zip');
      dl.href = URL.createObjectURL(zip.blob);
      dl.download = zip.name;
      achieved = total + ' pages became ' + total + ' ' + format.toUpperCase() + ' pictures at ' + DPI_WORDS[dpi] +
        ' (page 1: ' + firstW + ' x ' + firstH + ' pixels), packed into one ZIP, ' + fmtBytes(zip.blob.size) + ' in all.';
    }
    $('pj-achieved').textContent = achieved +
      ' The words on the pages are part of the pictures now: they cannot be selected or searched as text.';
    result.classList.remove('hidden');
    const stamp = $('pj-stamp');
    stamp.classList.remove('land');
    void stamp.offsetWidth;
    stamp.classList.add('land');
    setStatus('Done.');
    recordJob({ tool: TOOL_NAME, name: file.name, detail: total + ' pages at ' + dpi + ' DPI as ' + format.toUpperCase() });
  } catch (err) {
    setStatus('Something went wrong with this file: ' + (err && err.message ? err.message : err));
  } finally {
    running = false;
    runBtn.disabled = false;
  }
});
