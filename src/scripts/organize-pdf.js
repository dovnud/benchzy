// Organise PDF: remove pages, change their order, copy a page —
// the document's page list is rewritten inside the file itself
// (lib/organize-core.js), so pages are never rebuilt and nothing
// they carry is re-encoded or left behind. Thumbnails are rendered
// by the shipped PDF.js, in this browser, like every other job here.
import { PDFDocument } from '@cantoo/pdf-lib';
import { fmtBytes, recordJob, wireTray } from './workbench.js';
import { organiseDocument } from './lib/organize-core.js';

const $ = (id) => document.getElementById(id);
const tray = $('og-tray'), input = $('og-file'), spec = $('og-spec');
const runBtn = $('og-run'), status = $('og-status'), result = $('og-result');
const strip = $('og-pages'), lastNote = $('og-last-note');
let file = null, fileBytes = null, pageCount = 0, running = false;
let order = []; // [{ src: 0-based source page }] in output order
let thumbs = []; // data URL per source page, filled as renders land
let renderToken = 0;

function setStatus(msg) { status.textContent = msg; }
function setSpec(rows) {
  spec.innerHTML = rows.map(([k, v]) => `<div class="spec-row"><dt>${k}</dt><dd>${v}</dd></div>`).join('');
}

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

function renderStrip() {
  strip.innerHTML = '';
  order.forEach((slot, pos) => {
    const tile = document.createElement('article');
    tile.className = 'ticket-soft p-3 flex flex-col gap-2';
    tile.draggable = true;
    tile.dataset.pos = String(pos);
    const img = document.createElement('img');
    img.alt = 'Page ' + (slot.src + 1) + ' of the document you brought';
    img.className = 'w-full border border-line bg-white';
    if (thumbs[slot.src]) img.src = thumbs[slot.src];
    const label = document.createElement('p');
    label.className = 'font-mono text-xs';
    label.textContent = 'Page ' + (slot.src + 1) + ' · now ' + (pos + 1) + ' of ' + order.length;
    const row = document.createElement('div');
    row.className = 'flex flex-wrap gap-1 mt-auto';
    const mk = (act, text, disabled) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.dataset.act = act;
      b.dataset.pos = String(pos);
      b.textContent = text;
      if (disabled) b.disabled = true;
      return b;
    };
    row.append(
      mk('left', '← Earlier', pos === 0),
      mk('right', 'Later →', pos === order.length - 1),
      mk('dup', 'Copy'),
      mk('del', 'Remove', order.length === 1),
    );
    tile.append(img, label, row);
    strip.appendChild(tile);
  });
  lastNote.classList.toggle('hidden', order.length !== 1);
  runBtn.disabled = !order.length || running;
}

strip.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-act]');
  if (!b || b.disabled) return;
  const pos = Number(b.dataset.pos);
  const act = b.dataset.act;
  if (act === 'left' && pos > 0) { [order[pos - 1], order[pos]] = [order[pos], order[pos - 1]]; }
  if (act === 'right' && pos < order.length - 1) { [order[pos + 1], order[pos]] = [order[pos], order[pos + 1]]; }
  if (act === 'dup') order.splice(pos + 1, 0, { src: order[pos].src });
  if (act === 'del' && order.length > 1) order.splice(pos, 1);
  renderStrip();
});

// Drag to reorder: the buttons above do the same job for anyone who
// cannot drag (touch, keyboard, a screen reader).
let dragPos = null;
strip.addEventListener('dragstart', (e) => {
  const tile = e.target.closest('[data-pos]');
  if (!tile) return;
  dragPos = Number(tile.dataset.pos);
  e.dataTransfer.effectAllowed = 'move';
  try { e.dataTransfer.setData('text/plain', String(dragPos)); } catch (err) { /* some browsers insist */ }
});
strip.addEventListener('dragover', (e) => {
  if (dragPos === null) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
});
strip.addEventListener('drop', (e) => {
  e.preventDefault();
  const tile = e.target.closest('[data-pos]');
  if (dragPos === null || !tile) { dragPos = null; return; }
  const to = Number(tile.dataset.pos);
  if (to !== dragPos) {
    const [moved] = order.splice(dragPos, 1);
    order.splice(to, 0, moved);
    renderStrip();
  }
  dragPos = null;
});
strip.addEventListener('dragend', () => { dragPos = null; });

async function renderThumbs(pdf, token) {
  for (let i = 1; i <= pdf.numPages; i++) {
    if (token !== renderToken) return;
    try {
      const pg = await pdf.getPage(i);
      const base = pg.getViewport({ scale: 1 });
      const vp = pg.getViewport({ scale: 176 / base.width });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(vp.width);
      canvas.height = Math.round(vp.height);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await pg.render({ canvasContext: ctx, viewport: vp }).promise;
      thumbs[i - 1] = canvas.toDataURL('image/jpeg', 0.72);
      // Refresh any tile currently showing this source page.
      strip.querySelectorAll('article').forEach((tileEl, k) => {
        if (order[k] && order[k].src === i - 1) {
          const im = tileEl.querySelector('img');
          if (im) im.src = thumbs[i - 1];
        }
      });
    } catch (err) { /* a page that will not render still organises; its tile stays blank */ }
  }
}

wireTray(tray, input, async (f) => {
  result.classList.add('hidden');
  runBtn.disabled = true;
  file = f;
  order = [];
  thumbs = [];
  strip.innerHTML = '';
  const token = ++renderToken;
  try {
    fileBytes = new Uint8Array(await f.arrayBuffer());
    const doc = await PDFDocument.load(fileBytes, { updateMetadata: false, ignoreEncryption: true });
    if (doc.isEncrypted) {
      pageCount = doc.getPageCount();
      setSpec([
        ['file', f.name],
        ['size now', fmtBytes(f.size)],
        ['pages', String(pageCount)],
        ['password', 'this file has one'],
      ]);
      setStatus('This file has a password on it, so this page cannot open it. Take the password off first with the unlock tool, then bring the file back here.');
      return;
    }
    pageCount = doc.getPageCount();
    order = Array.from({ length: pageCount }, (_, i) => ({ src: i }));
    setSpec([
      ['file', f.name],
      ['size now', fmtBytes(f.size)],
      ['pages', String(pageCount)],
    ]);
    renderStrip();
    setStatus('Laying out the pages…');
    const pdfjs = await loadPdfjs();
    const pdf = await pdfjs.getDocument({ data: fileBytes.slice() }).promise;
    await renderThumbs(pdf, token);
    try { await pdf.loadingTask.destroy(); } catch (e) { /* already gone */ }
    if (token === renderToken) setStatus('Ready. Arrange the pages, then build the organised PDF.');
  } catch (err) {
    setStatus('That file could not be read as a PDF: ' + (err && err.message ? err.message : err));
  }
});

runBtn.addEventListener('click', async () => {
  if (!file || !order.length || running) return;
  running = true;
  runBtn.disabled = true;
  result.classList.add('hidden');
  try {
    setStatus('Rebuilding the page order on this device…');
    const doc = await PDFDocument.load(fileBytes, { updateMetadata: false });
    await organiseDocument(doc, order.map((s) => s.src));
    const bytes = await doc.save();
    // Re-open the finished file and count its pages: the result
    // line reports the file's own numbers, not the plan.
    const after = await PDFDocument.load(bytes, { updateMetadata: false });
    const afterCount = after.getPageCount();
    if (afterCount !== order.length) throw new Error('the finished file carries ' + afterCount + ' pages, not the ' + order.length + ' arranged here');
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const dl = $('og-download');
    dl.href = URL.createObjectURL(blob);
    dl.download = file.name.replace(/\.pdf$/i, '') + '-organized.pdf';
    const seq = order.map((s) => s.src + 1).join(', ');
    const removed = pageCount - new Set(order.map((s) => s.src)).size;
    $('og-achieved').textContent = 'Pages now run: ' + seq + ' (the numbers are the pages of the file you brought). ' +
      afterCount + ' pages, ' + fmtBytes(bytes.length) + '.' +
      (removed ? ' ' + removed + (removed === 1 ? ' page was' : ' pages were') + ' taken out of the reading order; a removed page\'s contents stay inside the file\'s storage, so the file may not be smaller.' : '') +
      ' The pages themselves were not rebuilt or re-encoded, so words, pictures and filled form answers are exactly as they were.';
    result.classList.remove('hidden');
    const stamp = $('og-stamp');
    stamp.classList.remove('land');
    void stamp.offsetWidth;
    stamp.classList.add('land');
    setStatus('Done.');
    recordJob({ tool: 'Organise PDF', name: file.name, detail: 'order ' + seq });
  } catch (err) {
    setStatus('Something went wrong with this file: ' + (err && err.message ? err.message : err));
  } finally {
    running = false;
    renderStrip();
  }
});
