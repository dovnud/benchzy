// PDF to text: pull the words a PDF already carries out as plain
// text, in this browser, with the shipped PDF.js. This is not OCR:
// nothing is read from the pictures of the pages. A PDF made by a
// program (an invoice, a report, an exported document) stores its
// words as text, and those words come out here in the order the
// file stores them, line by line, page by page. A scanned PDF is a
// photograph of a page and stores no words at all; when a file
// gives no text, the page says so plainly and points at the OCR
// tool, which is the one that reads pictures of words.
// The output is plain text: the layout (columns, tables, spacing
// tricks) is not kept, and the page copy says so before the run.
import { PDFDocument } from '@cantoo/pdf-lib';
import { fmtBytes, recordJob, wireTray } from './workbench.js';

const $ = (id) => document.getElementById(id);
const tray = $('tx-tray'), input = $('tx-file'), spec = $('tx-spec');
const runBtn = $('tx-run'), status = $('tx-status'), result = $('tx-result');
const textEl = $('tx-text'), dl = $('tx-download'), copyBtn = $('tx-copy');
let file = null, fileBytes = null, pages = 0, running = false;

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
      file = null;
      return;
    }
    setSpec([
      ['file', f.name],
      ['size now', fmtBytes(f.size)],
      ['pages', String(pages)],
    ]);
    setStatus('Ready. The words stored in the file are pulled out here in the page; nothing is uploaded.');
    runBtn.disabled = false;
  } catch (err) {
    file = null;
    setStatus('That file could not be read as a PDF: ' + (err && err.message ? err.message : err));
  }
});

// One page's stored items become lines: an item ends a line when
// the file itself says so (hasEOL) or when the next item sits on a
// clearly different line (its baseline moved). Items on one line
// are joined with a single space; the file's own spacing inside a
// stored string is kept as stored.
function pageText(items) {
  const lines = [];
  let line = '';
  let lastY = null;
  for (const it of items) {
    const y = it.transform ? it.transform[5] : null;
    if (lastY !== null && y !== null && Math.abs(y - lastY) > 2 && line) {
      lines.push(line);
      line = '';
    }
    if (it.str) line += (line && !line.endsWith(' ') && !it.str.startsWith(' ') ? ' ' : '') + it.str;
    if (y !== null) lastY = y;
    if (it.hasEOL) {
      lines.push(line);
      line = '';
      lastY = null;
    }
  }
  if (line) lines.push(line);
  return lines.join('\n');
}

runBtn.addEventListener('click', async () => {
  if (!file || running) return;
  running = true;
  runBtn.disabled = true;
  result.classList.add('hidden');
  try {
    setStatus('Loading the reading program. It runs in your browser to protect your privacy: your file never leaves your device…');
    const pdfjs = await loadPdfjs();
    let pdf;
    try {
      pdf = await pdfjs.getDocument({ data: fileBytes.slice() }).promise;
    } catch (err) {
      if (err && err.name === 'PasswordException') {
        setStatus('This file asks for a password before its words can be read. Take the password off first with the unlock tool, then bring the file back here.');
        return;
      }
      throw err;
    }
    const total = pdf.numPages;
    const pageTexts = [];
    let words = 0, chars = 0;
    for (let n = 1; n <= total; n++) {
      setStatus('Reading the stored words on page ' + n + ' of ' + total + '…');
      const pg = await pdf.getPage(n);
      const tc = await pg.getTextContent();
      const t = pageText(tc.items);
      pageTexts.push(t);
      chars += t.length;
      words += t.split(/\s+/).filter(Boolean).length;
      pg.cleanup();
    }
    try { await pdf.loadingTask.destroy(); } catch (e) { /* already gone */ }
    const all = pageTexts.join('\n\n');
    const stamp = $('tx-stamp');
    if (!all.trim()) {
      // No text layer: this is a scan or a picture-only file. Say
      // so plainly, show no empty download, point at the reader.
      textEl.value = '';
      dl.classList.add('hidden');
      copyBtn.classList.add('hidden');
      $('tx-achieved').textContent =
        'This file stores no words to pull out: its pages are pictures (a scan, or pages saved as images), ' +
        'so there is no text layer in the file. That is a fact about the file, not a failure of the run. ' +
        'The read a scan (OCR) tool reads words from pictures of pages: it is the right tool for this file.';
      result.classList.remove('hidden');
      setStatus('Done. No text layer found in this file.');
      recordJob({ tool: 'PDF to text', name: file.name, detail: total + ' pages, no text layer' });
      return;
    }
    textEl.value = all;
    const blob = new Blob([all], { type: 'text/plain;charset=utf-8' });
    dl.href = URL.createObjectURL(blob);
    dl.download = file.name.replace(/\.pdf$/i, '') + '-benchzy.txt';
    dl.classList.remove('hidden');
    copyBtn.classList.remove('hidden');
    $('tx-achieved').textContent =
      total + ' page' + (total === 1 ? '' : 's') + ' gave ' + words.toLocaleString('en-US') + ' words, ' +
      chars.toLocaleString('en-US') + ' characters of text, in the order the file stores them. ' +
      'The layout is not kept: columns and tables come out as lines of words, one page after another, separated by a blank line.';
    result.classList.remove('hidden');
    stamp.classList.remove('land');
    void stamp.offsetWidth;
    stamp.classList.add('land');
    setStatus('Done.');
    recordJob({ tool: 'PDF to text', name: file.name, detail: total + ' pages, ' + words + ' words' });
  } catch (err) {
    setStatus('Something went wrong with this file: ' + (err && err.message ? err.message : err));
  } finally {
    running = false;
    if (file) runBtn.disabled = false;
  }
});

copyBtn.addEventListener('click', async () => {
  const t = textEl.value;
  if (!t) return;
  try {
    await navigator.clipboard.writeText(t);
    setStatus('Copied: the whole text is on your clipboard.');
  } catch (e) {
    textEl.focus();
    textEl.select();
    setStatus('The text is selected: copy it with your keyboard (Ctrl+C, or Cmd+C on a Mac).');
  }
});
