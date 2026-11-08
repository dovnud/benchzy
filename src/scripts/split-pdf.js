// Split PDF: pull a page range out as one PDF, take every page as its
// own PDF, or cut the file into parts that each fit under a size limit
// (the split-by-size job, milestone 6). Engine: @cantoo/pdf-lib, the
// measured bench pipeline (bench/pdfnums: a 10-page file split in 21 ms,
// content verified per page). Split by size packs pages greedily by
// measured per-page sizes, then builds each part and checks its real
// bytes; a part that comes out over the limit gives its last page to
// the next part and is rebuilt, so the printed sizes are the files'
// own, never estimates.
import { PDFDocument } from '@cantoo/pdf-lib';
import { fmtBytes, recordJob, wireTray } from './workbench.js';
import { makeZip } from './lib/zip.js';

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

// Extraction is delete-based (load the file, remove the pages not
// wanted, save) rather than copy-into-a-new-file: some PDFs keep their
// images in resources shared through the page tree, and copying a page
// into a fresh document can leave those behind, producing a part whose
// pages render without their pictures. Removing pages keeps the
// file's own structure intact, so every part renders whole. Verified
// against the bench's shared-image photo PDF, whose later pages copy
// out empty (about 1.3 KB) but extract whole by removal.
async function extract(indices) {
  const doc = await PDFDocument.load(fileBytes, { updateMetadata: false });
  const keep = new Set(indices);
  for (let i = pageCount - 1; i >= 0; i--) if (!keep.has(i)) doc.removePage(i);
  return doc.save();
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
    } else if (mode() === 'size') {
      const limitKB = parseInt(($('sp-size-kb') || {}).value, 10);
      if (!(limitKB >= 50 && limitKB <= 500000)) {
        setStatus('Give the part size as a number of KB between 50 and 500,000.');
        return;
      }
      const limit = limitKB * 1024;
      setStatus('Measuring the pages…');
      // Estimate each page's weight from its single-page file.
      const est = [];
      for (let i = 0; i < pageCount; i++) est.push((await extract([i])).length);
      // Greedy pack in order: a part takes pages while the estimated
      // total (minus the per-file overhead counted once per extra page)
      // stays under the limit.
      const overhead = Math.min(...est);
      const parts = [];
      let cur = [], curEst = 0;
      for (let i = 0; i < pageCount; i++) {
        if (cur.length && curEst + est[i] - overhead > limit) { parts.push(cur); cur = []; curEst = 0; }
        cur.push(i);
        curEst = cur.length === 1 ? est[i] : curEst + est[i] - overhead;
      }
      if (cur.length) parts.push(cur);
      // Build, check the real bytes, and repair any part that came out
      // over the limit by moving its last page forward. Bounded: each
      // repair strictly reduces a part's page count.
      setStatus('Cutting the parts…');
      const built = [];
      let guard = 0;
      for (let p = 0; p < parts.length; p++) {
        let idxs = parts[p];
        let bytes = await extract(idxs);
        while (bytes.length > limit && idxs.length > 1 && guard++ < 500) {
          const moved = idxs[idxs.length - 1];
          idxs = idxs.slice(0, -1);
          if (p + 1 < parts.length) parts[p + 1] = [moved, ...parts[p + 1]];
          else parts.push([moved]);
          bytes = await extract(idxs);
        }
        built.push({ idxs, bytes, over: bytes.length > limit });
      }
      const zipEntries = [];
      built.forEach((part, i) => {
        const a = part.idxs[0] + 1, b = part.idxs[part.idxs.length - 1] + 1;
        const name = base + '-part-' + (i + 1) + '.pdf';
        const url = URL.createObjectURL(new Blob([part.bytes], { type: 'application/pdf' }));
        zipEntries.push({ name, data: part.bytes });
        const row = document.createElement('div');
        row.className = 'spec-row items-center';
        const left = document.createElement('span');
        left.textContent = 'Part ' + (i + 1) + ' · pages ' + a + (b > a ? '–' + b : '');
        const link = document.createElement('a');
        link.className = 'chip no-underline';
        link.href = url;
        link.download = name;
        link.textContent = 'Download (' + fmtBytes(part.bytes.length) + (part.over ? ', over the limit: a single page is bigger than the limit' : '') + ')';
        row.append(left, link);
        linksEl.appendChild(row);
      });
      if (zipEntries.length > 1) {
        const { blob, name } = await makeZip(zipEntries, base + '-parts.zip');
        const z = document.createElement('a');
        z.className = 'btn-primary inline-block no-underline mt-2';
        z.href = URL.createObjectURL(blob);
        z.download = name;
        z.textContent = 'Download all parts as one ZIP (' + fmtBytes(blob.size) + ')';
        z.id = 'sp-zip';
        linksEl.appendChild(z);
      }
      recordJob({ tool: 'Split PDF by size', name: file.name, detail: built.length + ' parts under ' + limitKB + ' KB' });
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
