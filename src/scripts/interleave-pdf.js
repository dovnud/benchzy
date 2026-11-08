// Interleave merge (alternate merge): A1, B1, A2, B2... The classic
// repair for a duplex document scanned on a single-sided scanner: the
// fronts in one file, the backs in a second file that was fed through
// face-down, so its pages run last-to-first. Engine: @cantoo/pdf-lib
// page copying in a custom order, on the measured merge pipeline
// (bench/pdfnums: 25 files merged in 71 ms). When one file runs out,
// the other's remaining pages follow in order, and the page says so.
import { PDFDocument } from '@cantoo/pdf-lib';
import { fmtBytes, recordJob, wireTray } from './workbench.js';

const $ = (id) => document.getElementById(id);
const spec = $('il-spec'), runBtn = $('il-run'), status = $('il-status'), result = $('il-result');
const sides = {
  a: { file: null, bytes: null, pages: 0, error: null },
  b: { file: null, bytes: null, pages: 0, error: null },
};
let running = false;

function setStatus(msg) { status.textContent = msg; }
function setSpec(rows) {
  spec.innerHTML = rows.map(([k, v]) => `<div class="spec-row"><dt>${k}</dt><dd>${v}</dd></div>`).join('');
}
function refresh() {
  const a = sides.a, b = sides.b;
  const fmt = (s, label) => s.error ? label + ': not a readable PDF' : s.file ? label + ': ' + s.pages + ' pages' : label + ': none picked yet';
  setSpec([
    ['first file (A)', a.file ? a.file.name : 'none picked yet'],
    ['second file (B)', b.file ? b.file.name : 'none picked yet'],
    ['pages in order', String((a.pages || 0) + (b.pages || 0))],
  ]);
  runBtn.disabled = running || !(a.file && !a.error && b.file && !b.error);
  if (a.file || b.file) setStatus(fmt(a, 'A') + '. ' + fmt(b, 'B') + '.');
}

function wireSide(trayId, inputId, key) {
  wireTray($(trayId), $(inputId), async (f) => {
    result.classList.add('hidden');
    const s = sides[key];
    s.file = f; s.error = null; s.pages = 0;
    try {
      s.bytes = new Uint8Array(await f.arrayBuffer());
      const doc = await PDFDocument.load(s.bytes, { updateMetadata: false });
      s.pages = doc.getPageCount();
    } catch (err) {
      s.error = err && err.message ? err.message : String(err);
    }
    refresh();
  });
}
wireSide('il-tray-a', 'il-file-a', 'a');
wireSide('il-tray-b', 'il-file-b', 'b');

runBtn.addEventListener('click', async () => {
  const A = sides.a, B = sides.b;
  if (!A.file || !B.file || A.error || B.error || running) return;
  running = true;
  runBtn.disabled = true;
  result.classList.add('hidden');
  try {
    setStatus('Interleaving on this device…');
    const startWith = document.querySelector('input[name="il-start"]:checked');
    const first = startWith && startWith.value === 'b' ? 'b' : 'a';
    const reverseB = $('il-reverse-b').checked;
    const srcA = await PDFDocument.load(A.bytes, { updateMetadata: false });
    const srcB = await PDFDocument.load(B.bytes, { updateMetadata: false });
    const orderA = srcA.getPageIndices();
    let orderB = srcB.getPageIndices();
    if (reverseB) orderB = [...orderB].reverse();
    const seq = [];
    const queues = { a: [...orderA], b: [...orderB] };
    let turn = first;
    while (queues.a.length || queues.b.length) {
      if (queues[turn].length) seq.push({ side: turn, index: queues[turn].shift() });
      turn = turn === 'a' ? 'b' : 'a';
    }
    const out = await PDFDocument.create();
    // copyPages per source, in sequence order, grouped to stay fast.
    const copiedA = await out.copyPages(srcA, orderA);
    const copiedB = await out.copyPages(srcB, orderB);
    for (const item of seq) {
      out.addPage(item.side === 'a' ? copiedA[orderA.indexOf(item.index)] : copiedB[orderB.indexOf(item.index)]);
    }
    const bytes = await out.save();
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const dl = $('il-download');
    dl.href = url;
    dl.download = 'interleaved-benchzy.pdf';
    const longer = A.pages === B.pages ? null : (A.pages > B.pages ? 'A' : 'B');
    $('il-achieved').textContent =
      'Interleaved into one PDF of ' + out.getPageCount() + ' pages, ' + fmtBytes(bytes.length) + ': page 1 of ' +
      (first === 'a' ? 'the first file' : 'the second file') + ', then alternating' + (reverseB ? ', with the second file read back to front' : '') +
      (longer ? '. The ' + (longer === 'A' ? 'first' : 'second') + ' file had more pages; its remaining pages follow at the end in their own order.' : '.') +
      ' Check the order on a few pages before you rely on it: this page deals the pages like cards, it does not read them.';
    result.classList.remove('hidden');
    const stamp = $('il-stamp');
    stamp.classList.remove('land');
    void stamp.offsetWidth;
    stamp.classList.add('land');
    setStatus('Done.');
    recordJob({ tool: 'Interleave merge', name: A.file.name + ' + ' + B.file.name, detail: out.getPageCount() + ' pages, ' + fmtBytes(bytes.length) });
  } catch (err) {
    setStatus('Something went wrong: ' + (err && err.message ? err.message : err));
  } finally {
    running = false;
    refresh();
  }
});

refresh();
