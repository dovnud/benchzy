// Extract images from a PDF: pull the pictures stored inside the
// file out as their own files. Stored JPEGs come out byte for byte;
// every other decodable stored picture is rebuilt from its stored
// data as a PNG through the shipped image stack, with its stored
// transparency put back. Anything that cannot be pulled is named in
// the written report under the result, with its reason: never
// silently dropped. Scope benched in verify/m12-bench.mjs (JPEG byte
// identity, PNG pixel equality, predictor / palette / CMYK / 1-bit
// decoding, named skips for JPEG 2000 and fax encodings).
// Walk + decode: src/scripts/lib/pdf-images-core.js.
import { PDFDocument } from '@cantoo/pdf-lib';
import { fmtBytes, recordJob, wireTray } from './workbench.js';
import { scanPdfImages, extractPdfImages } from './lib/pdf-images-core.js';
import { initImageCodecs, encodeImage } from './lib/image-core.js';
import { makeZip } from './lib/zip.js';

const $ = (id) => document.getElementById(id);
const tray = $('ex-tray'), input = $('ex-file'), spec = $('ex-spec');
const runBtn = $('ex-run'), status = $('ex-status'), result = $('ex-result');
const reportEl = $('ex-report');
let file = null, fileBytes = null, pages = 0, stored = 0, codecsReady = false, running = false;

function setStatus(msg) { status.textContent = msg; }
function setSpec(rows) {
  spec.innerHTML = rows.map(([k, v]) => `<div class="spec-row"><dt>${k}</dt><dd>${v}</dd></div>`).join('');
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
    const scan = scanPdfImages(doc);
    stored = scan.total;
    const withPics = [...scan.perPage.keys()].sort((a, b) => a - b);
    setSpec([
      ['file', f.name],
      ['size now', fmtBytes(f.size)],
      ['pages', String(pages)],
      ['stored pictures', String(stored)],
      ['on pages', withPics.length ? withPics.join(', ') : 'none'],
    ]);
    if (stored === 0) {
      setStatus('No stored pictures were found in this file. Its pages may still carry text and drawn shapes (charts, logos drawn as lines), but those are drawing instructions, not stored pictures, and there is no picture file to pull from them.');
      return;
    }
    setStatus('Ready. ' + stored + ' stored picture' + (stored === 1 ? '' : 's') + ' found; press the button and each one is pulled out and reported.');
    runBtn.disabled = false;
  } catch (err) {
    setStatus('That file could not be read as a PDF: ' + (err && err.message ? err.message : err));
  }
});

async function encodePng({ data, width, height }) {
  if (!codecsReady) {
    setStatus('Loading the image program (about 2 MB, one time only). It runs in your browser to protect your privacy: your file never leaves your device…');
    await initImageCodecs();
    codecsReady = true;
    setStatus('Pulling the pictures out on this device…');
  }
  const img = new ImageData(data, width, height);
  const out = await encodeImage(img, 'png');
  return new Uint8Array(out.buf);
}

runBtn.addEventListener('click', async () => {
  if (!file || running || stored === 0) return;
  running = true;
  runBtn.disabled = true;
  result.classList.add('hidden');
  try {
    setStatus('Pulling the pictures out on this device…');
    const doc = await PDFDocument.load(fileBytes, { updateMetadata: false, ignoreEncryption: true });
    const res = await extractPdfImages(doc, { encodePng });
    if (res.pulledCount === 0) {
      $('ex-achieved').textContent = 'Nothing could be pulled from this file. Every stored picture in it is a kind this page cannot open; each one is named below with its reason.';
      const dlNone = $('ex-download');
      dlNone.classList.add('hidden');
    } else {
      const base = file.name.replace(/\.pdf$/i, '');
      let blob, name, type;
      if (res.files.length === 1) {
        const f0 = res.files[0];
        blob = new Blob([f0.data], { type: f0.ext === 'jpg' ? 'image/jpeg' : 'image/png' });
        name = base + '-' + f0.name;
        type = 'one file';
      } else {
        const zip = await makeZip(res.files.map((f) => ({ name: f.name, data: f.data })), base + '-images.zip');
        blob = zip.blob;
        name = zip.name;
        type = 'one ZIP';
      }
      const dl = $('ex-download');
      dl.classList.remove('hidden');
      dl.href = URL.createObjectURL(blob);
      dl.download = name;
      dl.textContent = res.files.length === 1 ? 'Download ' + name : 'Download the ZIP (' + res.files.length + ' pictures)';
      $('ex-achieved').textContent = 'Pulled ' + res.pulledCount + ' picture' + (res.pulledCount === 1 ? '' : 's') + ' out of ' + res.storedCount + ' stored, as ' + type + '.' +
        (res.skippedCount ? ' ' + res.skippedCount + ' stored picture' + (res.skippedCount === 1 ? '' : 's') + ' could not be pulled; each is named below with its reason, not dropped quietly.' : ' Every stored picture came out.') +
        ' Stored JPEGs are the file\'s own bytes, untouched; the rest are rebuilt as PNGs from the stored picture data.';
    }
    // The written report: every stored picture, pulled or not, plus
    // a line for every page that stores none.
    const covered = new Set();
    const lines = [];
    for (const r of res.report) {
      r.pages.forEach((p) => covered.add(p));
      lines.push(r.outcome === 'pulled'
        ? 'Page ' + r.pages.join(', ') + ' — a ' + r.what + ' picture: pulled (' + r.why + ').'
        : 'Page ' + r.pages.join(', ') + ' — a ' + r.what + ' picture: NOT pulled. ' + r.why + '.');
    }
    for (let p = 1; p <= pages; p++) {
      if (!covered.has(p)) lines.push('Page ' + p + ' — no stored pictures on this page.');
    }
    lines.sort((a, b) => (parseInt(a.slice(5), 10) || 0) - (parseInt(b.slice(5), 10) || 0));
    reportEl.innerHTML = '';
    for (const line of lines) {
      const li = document.createElement('li');
      li.textContent = line;
      reportEl.appendChild(li);
    }
    result.classList.remove('hidden');
    const stamp = $('ex-stamp');
    stamp.classList.remove('land');
    void stamp.offsetWidth;
    stamp.classList.add('land');
    setStatus('Done.');
    recordJob({ tool: 'Extract images from PDF', name: file.name, detail: res.pulledCount + ' pulled, ' + res.skippedCount + ' reported' });
  } catch (err) {
    setStatus('Something went wrong with this file: ' + (err && err.message ? err.message : err));
  } finally {
    running = false;
    runBtn.disabled = false;
  }
});
