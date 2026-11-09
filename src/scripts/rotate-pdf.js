// Rotate PDF: turn every page, or one page range, by a quarter or a
// half turn. Rotation is a setting each page carries inside the file
// (the /Rotate entry): this page changes the setting and saves the
// file. The words and pictures on the pages are not redrawn or
// re-encoded, so nothing loses quality. Engine: @cantoo/pdf-lib.
import { PDFDocument, degrees } from '@cantoo/pdf-lib';
import { fmtBytes, recordJob, savePreset, getPreset, wireTray } from './workbench.js';

const $ = (id) => document.getElementById(id);
const tray = $('rt-tray'), input = $('rt-file'), spec = $('rt-spec');
const runBtn = $('rt-run'), status = $('rt-status'), result = $('rt-result');
const fromInput = $('rt-from'), toInput = $('rt-to');
let file = null, fileBytes = null, pages = 0, running = false;

function setStatus(msg) { status.textContent = msg; }
function setSpec(rows) {
  spec.innerHTML = rows.map(([k, v]) => `<div class="spec-row"><dt>${k}</dt><dd>${v}</dd></div>`).join('');
}
const picked = (name) => (document.querySelector('input[name="' + name + '"]:checked') || {}).value;

const saved = getPreset('rotate-pdf');
if (saved) {
  if (saved.angle) { const r = document.querySelector('input[name="rt-angle"][value="' + saved.angle + '"]'); if (r) r.checked = true; }
  if (saved.scope) { const r = document.querySelector('input[name="rt-scope"][value="' + saved.scope + '"]'); if (r) r.checked = true; }
}
function remember() {
  savePreset('rotate-pdf', { angle: Number(picked('rt-angle')) || 90, scope: picked('rt-scope') || 'all' });
}
for (const el of document.querySelectorAll('input[name="rt-angle"], input[name="rt-scope"]')) el.addEventListener('change', remember);

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
    setStatus('Ready. Pick the turn, then rotate the PDF.');
    runBtn.disabled = false;
  } catch (err) {
    setStatus('That file could not be read as a PDF: ' + (err && err.message ? err.message : err));
  }
});

const TURN_WORDS = { 90: 'a quarter turn to the right (90°)', 180: 'a half turn (180°)', 270: 'a quarter turn to the left (270°)' };

runBtn.addEventListener('click', async () => {
  if (!file || running) return;
  const angle = Number(picked('rt-angle')) || 90;
  const scope = picked('rt-scope');
  const { from, to } = scope === 'range' ? range() : { from: 1, to: pages };
  running = true;
  runBtn.disabled = true;
  result.classList.add('hidden');
  try {
    setStatus('Rotating on this device…');
    const doc = await PDFDocument.load(fileBytes, { updateMetadata: false, ignoreEncryption: true });
    const list = doc.getPages();
    for (let i = from - 1; i < to; i++) {
      const now = list[i].getRotation().angle;
      list[i].setRotation(degrees((now + angle) % 360));
    }
    const bytes = await doc.save();
    // Re-open the finished file and count the turns it actually
    // carries: the result line reports the file's numbers, not the
    // plan.
    const after = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true });
    const afterPages = after.getPages();
    let turned = 0;
    for (let i = from - 1; i < to; i++) {
      const before = list[i].getRotation().angle;
      if (afterPages[i].getRotation().angle === before) turned++;
    }
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const dl = $('rt-download');
    dl.href = url;
    dl.download = file.name.replace(/\.pdf$/i, '') + '-rotated.pdf';
    const span = from === to ? 'page ' + from : 'pages ' + from + ' to ' + to;
    $('rt-achieved').textContent = 'Rotated: ' + span + ' of ' + pages + ' turned ' + TURN_WORDS[angle] + '; the finished file carries the turn on ' +
      turned + ' of those pages, ' + fmtBytes(bytes.length) + '. The turn is a setting each page carries inside the file; ' +
      'the words and pictures were not redrawn, so nothing lost quality and the size barely moved.';
    result.classList.remove('hidden');
    const stamp = $('rt-stamp');
    stamp.classList.remove('land');
    void stamp.offsetWidth;
    stamp.classList.add('land');
    setStatus('Done.');
    recordJob({ tool: 'Rotate PDF', name: file.name, detail: span + ' turned ' + angle + '°' });
  } catch (err) {
    setStatus('Something went wrong with this file: ' + (err && err.message ? err.message : err));
  } finally {
    running = false;
    runBtn.disabled = false;
  }
});
