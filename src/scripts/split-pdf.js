// Split PDF: pull a page range out as one PDF, or take every page as its
// own PDF. Engine: @cantoo/pdf-lib, the measured bench pipeline
// (bench/pdfnums: a 10-page file split in 21 ms, content verified per page).
import { PDFDocument } from '@cantoo/pdf-lib';
import { fmtBytes, recordJob, wireTray } from './workbench.js';

const $ = (id) => document.getElementById(id);
const tray = $('sp-tray'), input = $('sp-file'), spec = $('sp-spec');
const runBtn = $('sp-run'), status = $('sp-status'), result = $('sp-result'), linksEl = $('sp-links');
const fromInput = $('sp-from'), toInput = $('sp-to');
let file = null, fileBytes = null, pageCount = 0, running = false;

function setStatus(msg) { status.textContent = msg; }
function setSpec(rows) {
  spec.innerHTML = rows.map(([k, v]) => `<div class="spec-row"><dt>${k}</dt><dd>${v}</dd></div>`).join('');
}
function mode() {
  const r = document.querySelector('input[name="sp-mode"]:checked');
  return r ? r.value : 'range';
}

wireTray(tray, input, async (f) => {
  result.classList.add('hidden');
  runBtn.disabled = true;
  file = f;
  try {
    fileBytes = new Uint8Array(await f.arrayBuffer());
    const doc = await PDFDocument.load(fileBytes, { updateMetadata: false });
    pageCount = doc.getPageCount();
    fromInput.value = 1;
    toInput.value = pageCount;
    fromInput.max = pageCount;
    toInput.max = pageCount;
    setSpec([
      ['file', f.name],
      ['size now', fmtBytes(f.size)],
      ['pages', String(pageCount)],
    ]);
    setStatus('Ready. Choose a range, or take every page as its own file.');
    runBtn.disabled = false;
  } catch (err) {
    setStatus('That file could not be read as a PDF: ' + (err && err.message ? err.message : err));
  }
});

async function extract(indices) {
  const src = await PDFDocument.load(fileBytes, { updateMetadata: false });
  const out = await PDFDocument.create();
  const copied = await out.copyPages(src, indices);
  copied.forEach((p) => out.addPage(p));
  return out.save();
}

runBtn.addEventListener('click', async () => {
  if (!file || !pageCount || running) return;
  running = true;
  runBtn.disabled = true;
  result.classList.add('hidden');
  linksEl.innerHTML = '';
  const base = file.name.replace(/\.pdf$/i, '');
  try {
    if (mode() === 'range') {
      let a = parseInt(fromInput.value, 10), b = parseInt(toInput.value, 10);
      if (!(a >= 1) || !(b >= a) || b > pageCount) {
        setStatus('Pick a range inside the file: from page 1 to page ' + pageCount + ', start before end.');
        return;
      }
      setStatus('Cutting pages ' + a + ' to ' + b + '…');
      const indices = [];
      for (let i = a - 1; i < b; i++) indices.push(i);
      const bytes = await extract(indices);
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      const link = document.createElement('a');
      link.className = 'btn-primary inline-block no-underline';
      link.href = url;
      link.download = base + '-pages-' + a + '-' + b + '.pdf';
      link.textContent = 'Download pages ' + a + '–' + b + ' (' + fmtBytes(bytes.length) + ')';
      linksEl.appendChild(link);
      recordJob({ tool: 'Split PDF', name: file.name, detail: 'pages ' + a + '-' + b + ' of ' + pageCount });
    } else {
      setStatus('Cutting every page into its own file…');
      for (let i = 0; i < pageCount; i++) {
        const bytes = await extract([i]);
        const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
        const row = document.createElement('div');
        row.className = 'spec-row items-center';
        const left = document.createElement('span');
        left.textContent = 'Page ' + (i + 1);
        const link = document.createElement('a');
        link.className = 'chip no-underline';
        link.href = url;
        link.download = base + '-page-' + (i + 1) + '.pdf';
        link.textContent = 'Download (' + fmtBytes(bytes.length) + ')';
        row.append(left, link);
        linksEl.appendChild(row);
      }
      recordJob({ tool: 'Split PDF', name: file.name, detail: pageCount + ' single pages' });
    }
    result.classList.remove('hidden');
    const stamp = $('sp-stamp');
    stamp.classList.remove('land');
    void stamp.offsetWidth;
    stamp.classList.add('land');
    setStatus('Done.');
  } catch (err) {
    setStatus('Something went wrong with this file: ' + (err && err.message ? err.message : err));
  } finally {
    running = false;
    runBtn.disabled = false;
  }
});
