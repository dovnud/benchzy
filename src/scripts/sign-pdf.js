// Sign PDF (self-signing only): draw or type a signature, place it on the
// page as real page content, done. Engine: @cantoo/pdf-lib (the measured
// PDF library; it embeds an image into a PDF in the same pipeline the
// other benches use). Scope, printed on the page before the tray: this
// places YOUR signature on YOUR document. It sends nothing, requests
// nothing from anyone else, and issues no certificate; it is not a
// legal e-signature service and the page never calls it one.
import { PDFDocument, StandardFonts, rgb } from '@cantoo/pdf-lib';
import { fmtBytes, recordJob, wireTray } from './workbench.js';

const $ = (id) => document.getElementById(id);
const tray = $('sg-tray'), input = $('sg-file'), spec = $('sg-spec');
const runBtn = $('sg-run'), status = $('sg-status'), result = $('sg-result');
const pad = $('sg-pad');
let file = null, fileBytes = null, pageCount = 0, running = false;
let drawn = false;

function setStatus(msg) { status.textContent = msg; }
function setSpec(rows) {
  spec.innerHTML = rows.map(([k, v]) => `<div class="spec-row"><dt>${k}</dt><dd>${v}</dd></div>`).join('');
}
function radio(name, fallback) {
  const r = document.querySelector('input[name="' + name + '"]:checked');
  return r ? r.value : fallback;
}
function inkColor() {
  return { ink: '#1b2634', black: '#101418', blue: '#1e40af' }[radio('sg-ink', 'ink')] || '#1b2634';
}

// --- the signature pad ---
const pctx = pad.getContext('2d');
pctx.lineWidth = 2.6;
pctx.lineCap = 'round';
pctx.lineJoin = 'round';
let penDown = false, last = null;
function padPos(e) {
  const r = pad.getBoundingClientRect();
  return { x: (e.clientX - r.left) * (pad.width / r.width), y: (e.clientY - r.top) * (pad.height / r.height) };
}
pad.addEventListener('pointerdown', (e) => { penDown = true; last = padPos(e); pad.setPointerCapture(e.pointerId); });
pad.addEventListener('pointermove', (e) => {
  if (!penDown) return;
  const p = padPos(e);
  pctx.strokeStyle = inkColor();
  pctx.beginPath();
  pctx.moveTo(last.x, last.y);
  pctx.lineTo(p.x, p.y);
  pctx.stroke();
  last = p;
  drawn = true;
});
pad.addEventListener('pointerup', () => { penDown = false; });
pad.addEventListener('pointerleave', () => { penDown = false; });
$('sg-clear').addEventListener('click', () => {
  pctx.clearRect(0, 0, pad.width, pad.height);
  drawn = false;
});

function typedSignatureCanvas(text) {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  const font = 'italic 700 64px Georgia, "Times New Roman", serif';
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width) + 24;
  c.width = Math.max(120, w);
  c.height = 96;
  const ctx2 = c.getContext('2d');
  ctx2.font = font;
  ctx2.fillStyle = inkColor();
  ctx2.textBaseline = 'middle';
  ctx2.fillText(text, 12, 52);
  return c;
}
function textCanvas(text, px) {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  const font = 'italic 700 ' + px + 'px Georgia, "Times New Roman", serif';
  ctx.font = font;
  c.width = Math.ceil(ctx.measureText(text).width) + 16;
  c.height = px + 20;
  const ctx2 = c.getContext('2d');
  ctx2.font = font;
  ctx2.fillStyle = inkColor();
  ctx2.textBaseline = 'middle';
  ctx2.fillText(text, 8, c.height / 2);
  return c;
}
function canvasPng(c) {
  return new Promise((resolve) => c.toBlob(async (b) => resolve(new Uint8Array(await b.arrayBuffer())), 'image/png'));
}

wireTray(tray, input, async (f) => {
  result.classList.add('hidden');
  runBtn.disabled = true;
  file = f;
  try {
    fileBytes = new Uint8Array(await f.arrayBuffer());
    const doc = await PDFDocument.load(fileBytes, { updateMetadata: false });
    pageCount = doc.getPageCount();
    setSpec([
      ['file', f.name],
      ['size now', fmtBytes(f.size)],
      ['pages', String(pageCount)],
    ]);
    setStatus('Ready. Make your signature, choose where it goes, then sign.');
    runBtn.disabled = false;
  } catch (err) {
    setStatus('That file could not be read as a PDF: ' + (err && err.message ? err.message : err));
  }
});

runBtn.addEventListener('click', async () => {
  if (!file || !pageCount || running) return;
  const source = radio('sg-source', 'draw');
  const typed = ($('sg-typed').value || '').trim();
  if (source === 'draw' && !drawn) { setStatus('Draw your signature on the pad first, or switch to typing it.'); return; }
  if (source === 'type' && !typed) { setStatus('Type your name first, or switch to drawing your signature.'); return; }
  running = true;
  runBtn.disabled = true;
  result.classList.add('hidden');
  try {
    setStatus('Signing on this device…');
    const sigCanvas = source === 'draw' ? pad : typedSignatureCanvas(typed);
    const doc = await PDFDocument.load(fileBytes, { updateMetadata: false });
    const sig = await doc.embedPng(await canvasPng(sigCanvas));

    const widthPt = parseInt(($('sg-size') || {}).value, 10) || 170;
    const scale = widthPt / sigCanvas.width;
    const sigW = sigCanvas.width * scale, sigH = sigCanvas.height * scale;
    const pos = radio('sg-pos', 'br');
    const pageSel = radio('sg-page', 'last');
    const pages = doc.getPages();
    const targets = pageSel === 'all' ? pages.map((_, i) => i) : pageSel === 'first' ? [0] : [pages.length - 1];

    const initials = ($('sg-initials').value || '').trim();
    let initialsImg = null, initialsDims = null;
    if (initials) {
      const ic = textCanvas(initials, 44);
      initialsImg = await doc.embedPng(await canvasPng(ic));
      initialsDims = { w: ic.width * 0.5, h: ic.height * 0.5 };
    }
    const withDate = $('sg-date').checked;
    let font = null;
    if (withDate) font = await doc.embedFont(StandardFonts.Helvetica);
    const dateText = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    const M = 36;

    for (const i of targets) {
      const page = pages[i];
      const { width, height } = page.getSize();
      let x, y;
      if (pos === 'br') { x = width - M - sigW; y = M; }
      else if (pos === 'bl') { x = M; y = M; }
      else if (pos === 'tr') { x = width - M - sigW; y = height - M - sigH; }
      else { x = M; y = height - M - sigH; }
      page.drawImage(sig, { x, y, width: sigW, height: sigH });
      if (initialsImg) {
        const ix = pos.endsWith('r') ? M : width - M - initialsDims.w;
        const iy = pos.startsWith('t') ? height - M - initialsDims.h : M;
        page.drawImage(initialsImg, { x: ix, y: iy, width: initialsDims.w, height: initialsDims.h });
      }
      if (font) {
        const dy = pos.startsWith('t') ? y - 14 : y + sigH + 4;
        if (dy > 12 && dy < height - 12) {
          page.drawText(dateText, { x: Math.min(Math.max(x, M), width - M - 70), y: dy, size: 9, font, color: rgb(0.1, 0.15, 0.2) });
        }
      }
    }
    const bytes = await doc.save();
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const dl = $('sg-download');
    dl.href = url;
    dl.download = file.name.replace(/\.pdf$/i, '') + '-signed.pdf';
    $('sg-achieved').textContent =
      'Signed: your signature is drawn onto ' + (targets.length === 1 ? 'page ' + (targets[0] + 1) : 'all ' + targets.length + ' pages') +
      ' as part of the page itself (not a sticker that can be peeled off in an editor), ' + fmtBytes(bytes.length) +
      '. This is your signature placed on your document; it carries no certificate and no audit trail, as the note above the tray says.';
    result.classList.remove('hidden');
    const stamp = $('sg-stamp');
    stamp.classList.remove('land');
    void stamp.offsetWidth;
    stamp.classList.add('land');
    setStatus('Done.');
    recordJob({ tool: 'Sign PDF', name: file.name, detail: 'signed, ' + targets.length + ' page' + (targets.length === 1 ? '' : 's') });
  } catch (err) {
    setStatus('Something went wrong with this file: ' + (err && err.message ? err.message : err));
  } finally {
    running = false;
    runBtn.disabled = false;
  }
});
