// Add page numbers to a PDF: the numbers are drawn onto the pages
// themselves, as ordinary page content, at the place and in the
// words the visitor picks. Drawn in means they print with the file
// everywhere and cannot fall off; it also means they are not form
// fields, so the page tells the visitor to keep the unnumbered
// original. Engine: @cantoo/pdf-lib.
import { PDFDocument, StandardFonts, rgb } from '@cantoo/pdf-lib';
import { fmtBytes, recordJob, savePreset, getPreset, wireTray } from './workbench.js';

const $ = (id) => document.getElementById(id);
const tray = $('pn-tray'), input = $('pn-file'), spec = $('pn-spec');
const runBtn = $('pn-run'), status = $('pn-status'), result = $('pn-result');
const fromInput = $('pn-from'), toInput = $('pn-to'), startInput = $('pn-start');
let file = null, fileBytes = null, pages = 0, running = false;

function setStatus(msg) { status.textContent = msg; }
function setSpec(rows) {
  spec.innerHTML = rows.map(([k, v]) => `<div class="spec-row"><dt>${k}</dt><dd>${v}</dd></div>`).join('');
}
const picked = (name) => (document.querySelector('input[name="' + name + '"]:checked') || {}).value;

const saved = getPreset('pdf-page-numbers');
if (saved) {
  for (const [key, name] of [['pos', 'pn-pos'], ['format', 'pn-format'], ['scope', 'pn-scope']]) {
    if (saved[key]) { const r = document.querySelector('input[name="' + name + '"][value="' + saved[key] + '"]'); if (r) r.checked = true; }
  }
  if (saved.start) startInput.value = String(saved.start);
}
function remember() {
  savePreset('pdf-page-numbers', {
    pos: picked('pn-pos') || 'bottom-centre', format: picked('pn-format') || 'page-of',
    scope: picked('pn-scope') || 'all', start: parseInt(startInput.value, 10) || 1,
  });
}
for (const el of document.querySelectorAll('input[name="pn-pos"], input[name="pn-format"], input[name="pn-scope"]')) el.addEventListener('change', remember);
startInput.addEventListener('change', remember);

function range() {
  let from = parseInt(fromInput.value, 10), to = parseInt(toInput.value, 10);
  if (isNaN(from)) from = 1;
  if (isNaN(to)) to = pages;
  from = Math.max(1, Math.min(from, pages));
  to = Math.max(from, Math.min(to, pages));
  return { from, to };
}

wireTray(tray, input, async (f) => {
  result.classList.add('hidden');
  runBtn.disabled = true;
  file = f;
  try {
    fileBytes = new Uint8Array(await f.arrayBuffer());
    const doc = await PDFDocument.load(fileBytes, { updateMetadata: false, ignoreEncryption: true });
    if (doc.isEncrypted) {
      pages = doc.getPageCount();
      setSpec([
        ['file', f.name],
        ['size now', fmtBytes(f.size)],
        ['pages', String(pages)],
        ['password', 'this file has one'],
      ]);
      setStatus('This file has a password on it, so this page cannot open it. Take the password off first with the unlock tool, then bring the file back here.');
      return;
    }
    pages = doc.getPageCount();
    fromInput.max = String(pages);
    toInput.max = String(pages);
    toInput.value = String(pages);
    setSpec([
      ['file', f.name],
      ['size now', fmtBytes(f.size)],
      ['pages', String(pages)],
    ]);
    setStatus('Ready. Pick where the numbers sit, then add them.');
    runBtn.disabled = false;
  } catch (err) {
    setStatus('That file could not be read as a PDF: ' + (err && err.message ? err.message : err));
  }
});

const FORMAT_WORDS = { 'page-of': (n, total) => 'Page ' + n + ' of ' + total, 'of': (n, total) => n + ' of ' + total, 'plain': (n) => String(n) };
const POS_WORDS = { 'bottom-centre': 'at the bottom centre', 'corners': 'at the bottom outside corner', 'top-centre': 'at the top centre' };

runBtn.addEventListener('click', async () => {
  if (!file || running) return;
  const pos = picked('pn-pos') || 'bottom-centre';
  const format = picked('pn-format') || 'page-of';
  const scope = picked('pn-scope');
  const start = Math.max(0, parseInt(startInput.value, 10) || 1);
  const { from, to } = scope === 'range' ? range() : { from: 1, to: pages };
  const count = to - from + 1;
  const total = start + count - 1;
  const fmt = FORMAT_WORDS[format];
  running = true;
  runBtn.disabled = true;
  result.classList.add('hidden');
  try {
    setStatus('Numbering on this device…');
    const doc = await PDFDocument.load(fileBytes, { updateMetadata: false, ignoreEncryption: true });
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const size = 10;
    const ink = rgb(0.16, 0.2, 0.26);
    const list = doc.getPages();
    for (let i = from - 1; i < to; i++) {
      const page = list[i];
      const n = start + (i - (from - 1));
      const text = fmt(n, total);
      const w = font.widthOfTextAtSize(text, size);
      const pw = page.getWidth(), ph = page.getHeight();
      let x, y;
      if (pos === 'top-centre') { x = (pw - w) / 2; y = ph - 28; }
      else if (pos === 'corners') { x = n % 2 === 1 ? pw - 36 - w : 36; y = 24; }
      else { x = (pw - w) / 2; y = 24; }
      page.drawText(text, { x, y, size, font, color: ink });
    }
    const bytes = await doc.save();
    // Re-open the finished file: the result line reports its page
    // count, so a file that did not save whole is never dressed up.
    const after = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true });
    if (after.getPageCount() !== pages) {
      setStatus('The numbered file did not check out, so nothing was delivered. Your original is untouched.');
      return;
    }
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const dl = $('pn-download');
    dl.href = url;
    dl.download = file.name.replace(/\.pdf$/i, '') + '-numbered.pdf';
    const span = from === to ? 'page ' + from : 'pages ' + from + ' to ' + to;
    $('pn-achieved').textContent = 'Numbered: ' + span + ' of the file, ' + POS_WORDS[pos] + ', reading "' + fmt(start, total) + '" to "' + fmt(total, total) + '", ' +
      fmtBytes(bytes.length) + '. The numbers are drawn onto the pages themselves, so they print with the file everywhere. ' +
      'They are part of the pages now, not fields that can be switched off; keep your unnumbered original.';
    result.classList.remove('hidden');
    const stamp = $('pn-stamp');
    stamp.classList.remove('land');
    void stamp.offsetWidth;
    stamp.classList.add('land');
    setStatus('Done.');
    recordJob({ tool: 'Add page numbers', name: file.name, detail: count + ' pages numbered from ' + start });
  } catch (err) {
    setStatus('Something went wrong with this file: ' + (err && err.message ? err.message : err));
  } finally {
    running = false;
    runBtn.disabled = false;
  }
});
