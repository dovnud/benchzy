// Watermark PDF: stamp one short text across every page, or one
// page range, at the size, strength and slant the visitor picks.
// The words are written into the pages' content when the file saves:
// printed in, like ink soaked into the paper. The page says plainly
// what that means and what it does not: a determined person with a
// full editor could still lift the stamp off, so it is a label, not
// a lock. Engine: @cantoo/pdf-lib.
import { PDFDocument, StandardFonts, rgb, degrees } from '@cantoo/pdf-lib';
import { fmtBytes, recordJob, savePreset, getPreset, wireTray } from './workbench.js';

const $ = (id) => document.getElementById(id);
const tray = $('wm-tray'), input = $('wm-file'), spec = $('wm-spec');
const runBtn = $('wm-run'), status = $('wm-status'), result = $('wm-result');
const textInput = $('wm-text');
const fromInput = $('wm-from'), toInput = $('wm-to');
let file = null, fileBytes = null, pages = 0, running = false;

function setStatus(msg) { status.textContent = msg; }
function setSpec(rows) {
  spec.innerHTML = rows.map(([k, v]) => `<div class="spec-row"><dt>${k}</dt><dd>${v}</dd></div>`).join('');
}
const picked = (name) => (document.querySelector('input[name="' + name + '"]:checked') || {}).value;

const saved = getPreset('watermark-pdf');
if (saved) {
  if (saved.text) textInput.value = saved.text;
  for (const [key, name] of [['size', 'wm-size'], ['opacity', 'wm-opacity'], ['layout', 'wm-layout'], ['scope', 'wm-scope']]) {
    if (saved[key]) { const r = document.querySelector('input[name="' + name + '"][value="' + saved[key] + '"]'); if (r) r.checked = true; }
  }
}
function remember() {
  savePreset('watermark-pdf', {
    text: textInput.value, size: picked('wm-size') || 'medium',
    opacity: picked('wm-opacity') || '0.3', layout: picked('wm-layout') || 'diagonal', scope: picked('wm-scope') || 'all',
  });
}
for (const el of document.querySelectorAll('input[name="wm-size"], input[name="wm-opacity"], input[name="wm-layout"], input[name="wm-scope"]')) el.addEventListener('change', remember);
textInput.addEventListener('change', remember);

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
    setStatus('Ready. Write the stamp, pick its strength, then watermark the PDF.');
    runBtn.disabled = false;
  } catch (err) {
    setStatus('That file could not be read as a PDF: ' + (err && err.message ? err.message : err));
  }
});

const SIZE_FRAC = { small: 0.38, medium: 0.58, large: 0.82 };
const SIZE_WORDS = { small: 'small', medium: 'medium', large: 'large' };
const OPACITY_WORDS = { '0.15': 'light', '0.3': 'medium', '0.5': 'strong' };

runBtn.addEventListener('click', async () => {
  if (!file || running) return;
  const text = textInput.value.trim();
  if (!text) { setStatus('Write the stamp first: a word or two, like DRAFT or CONFIDENTIAL.'); textInput.focus(); return; }
  if (text.length > 40) { setStatus('Keep the stamp to 40 characters or fewer; longer text is shrunk until it is unreadable.'); textInput.focus(); return; }
  const sizeKey = picked('wm-size') || 'medium';
  const opacity = Number(picked('wm-opacity')) || 0.3;
  const layout = picked('wm-layout') || 'diagonal';
  const scope = picked('wm-scope');
  const { from, to } = scope === 'range' ? range() : { from: 1, to: pages };
  const count = to - from + 1;
  running = true;
  runBtn.disabled = true;
  result.classList.add('hidden');
  try {
    setStatus('Watermarking on this device…');
    const doc = await PDFDocument.load(fileBytes, { updateMetadata: false, ignoreEncryption: true });
    const font = await doc.embedFont(StandardFonts.HelveticaBold);
    const stampColor = rgb(0.85, 0.33, 0.12);
    const list = doc.getPages();
    for (let i = from - 1; i < to; i++) {
      const page = list[i];
      const pw = page.getWidth(), ph = page.getHeight();
      const target = pw * SIZE_FRAC[sizeKey];
      const atHundred = font.widthOfTextAtSize(text, 100);
      const size = Math.max(10, Math.min(220, (100 * target) / atHundred));
      const w = font.widthOfTextAtSize(text, size);
      const cx = pw / 2, cy = ph / 2;
      if (layout === 'diagonal') {
        const rad = (38 * Math.PI) / 180;
        const x = cx - (w / 2) * Math.cos(rad) + (size * 0.35) * Math.sin(rad);
        const y = cy - (w / 2) * Math.sin(rad) - (size * 0.35) * Math.cos(rad);
        page.drawText(text, { x, y, size, font, color: stampColor, opacity, rotate: degrees(38) });
      } else {
        page.drawText(text, { x: cx - w / 2, y: cy - size * 0.35, size, font, color: stampColor, opacity });
      }
    }
    const bytes = await doc.save();
    const after = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true });
    if (after.getPageCount() !== pages) {
      setStatus('The watermarked file did not check out, so nothing was delivered. Your original is untouched.');
      return;
    }
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const dl = $('wm-download');
    dl.href = url;
    dl.download = file.name.replace(/\.pdf$/i, '') + '-watermarked.pdf';
    const span = from === to ? 'page ' + from : 'pages ' + from + ' to ' + to;
    $('wm-achieved').textContent = 'Stamped: "' + text + '" across ' + span + ' (' + count + ' page' + (count === 1 ? '' : 's') + '), ' +
      (layout === 'diagonal' ? 'diagonal' : 'straight across the middle') + ', ' + SIZE_WORDS[sizeKey] + ' size, ' + (OPACITY_WORDS[String(opacity)] || 'medium') + ' strength, ' +
      fmtBytes(bytes.length) + '. The stamp is printed into the pages now. It is a label, not a lock: a determined person with a full PDF editor could still lift it off.';
    result.classList.remove('hidden');
    const stamp = $('wm-stamp');
    stamp.classList.remove('land');
    void stamp.offsetWidth;
    stamp.classList.add('land');
    setStatus('Done.');
    recordJob({ tool: 'Watermark PDF', name: file.name, detail: '"' + text + '" on ' + count + ' pages' });
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    if (/winansi|cannot encode|character/i.test(msg)) {
      setStatus('That stamp has characters this page cannot print. Keep it to plain letters, numbers and spaces, and try again.');
    } else {
      setStatus('Something went wrong with this file: ' + msg);
    }
  } finally {
    running = false;
    runBtn.disabled = false;
  }
});
