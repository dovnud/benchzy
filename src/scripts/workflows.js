// Workflows: chained jobs and saved presets (ticket T7). Build a chain
// out of the measured tools, save it in your browser under your own
// name, drop files on the tray, and the chain runs end to end: each
// step's output feeds the next. The engines are the same ones the
// single-tool benches run (pdf-lib page copying, the compress cores,
// the image cores, the background-removal engine, the reading engine);
// a step that cannot use a file passes it through and says so, per
// file, in the run log. Chains hold settings only; files are never
// stored or sent.
//
// The builder keeps a chain to one kind of file (the picker's rule,
// printed under the step list on the page): pdf steps and image steps
// are not mixed, because a step handed the other kind passes it
// through untouched. Reading the words (OCR) takes either kind and is
// always last: it hands on text, not a file, and the chain's output
// is the text itself, in boxes the visitor can check and fix.
import { PDFDocument, StandardFonts, rgb } from '@cantoo/pdf-lib';
import { fmtBytes, recordJob, wireTrayMulti, getChains, saveChains, addChain, normalizeChain, normalizeStep } from './workbench.js';
import { compressPdfToTarget } from './lib/pdf-compress-core.js';
import { initImageCodecs, decodeImageFile, compressImageToTarget, compressPngToTarget, hasAlpha, flattenOnto } from './lib/image-core.js';
import { loadBgSession, cutoutBitmap } from './lib/bg-engine.js';
import { isHeifFile } from './lib/heif-core.js';
import { getOcrWorker, ocrPlan } from './lib/ocr-core.js';
import { STEP_TOOLS, stepTool, chainKind, describeStep, STARTER_CHAINS } from './lib/chains.js';
import { makeZip } from './lib/zip.js';

const $ = (id) => document.getElementById(id);
const stepsEl = $('wf-steps'), savedEl = $('wf-saved'), status = $('wf-status');
const outputsEl = $('wf-outputs'), zipLink = $('wf-zip'), result = $('wf-result');
const pickerNote = $('wf-picker-note'), cancelBtn = $('wf-cancel'), ocrNote = $('wf-ocr-note');
let steps = [];
let currentId = null;
let files = [];
let running = false;
// Cancel support for the background model's one download inside a
// chain run (the milestone-8 contract, same as the batch bench):
// pieces already fetched are kept by the engine, and a later run
// resumes the load instead of starting over.
let chainAbort = null;
if (cancelBtn) {
  cancelBtn.addEventListener('click', () => { if (chainAbort) chainAbort.abort(); });
}

function setStatus(msg) { status.textContent = msg; }

function ocrMisplaced() {
  const i = steps.findIndex((s) => s.tool === 'ocr');
  return i >= 0 && i !== steps.length - 1;
}

// ---------- the step picker rule ----------
// A chain works on one kind of file. The select offers only the steps
// that fit the chain being built, and the note under the builder says
// why, in the picker's own words. Reading the words fits either kind
// but ends the chain: after it, nothing more can be added.
function refreshPicker() {
  const sel = $('wf-tool');
  const hasOcr = steps.some((s) => s.tool === 'ocr');
  const kind = chainKind(steps);
  for (const o of sel.options) {
    const t = stepTool(o.value);
    if (!t) continue;
    o.disabled = hasOcr || (kind !== null && t.kind !== 'any' && t.kind !== kind);
  }
  if (sel.selectedOptions.length && sel.selectedOptions[0].disabled) {
    const first = [...sel.options].find((o) => !o.disabled);
    if (first) sel.value = first.value;
  }
  if (!pickerNote) return;
  if (hasOcr) {
    pickerNote.textContent = 'Read the words (OCR) is in this chain. It turns files into text, so the chain ends there: no step can be added after it. Remove it if you want to keep building.';
  } else if (kind === 'image') {
    pickerNote.textContent = 'This chain works on photos, so the PDF steps are not offered: handed a photo, they would pass it through untouched and the step would do nothing. Start a new chain for PDF steps. Read the words (OCR) still fits: it reads photos too, and ends the chain with text.';
  } else if (kind === 'pdf') {
    pickerNote.textContent = 'This chain works on PDFs, so the photo steps are not offered: handed a PDF, they would pass it through untouched and the step would do nothing. Start a new chain for photo steps. Read the words (OCR) still fits: it reads PDFs too, and ends the chain with text.';
  } else {
    pickerNote.textContent = 'A chain works on one kind of file: PDF steps and photo steps are not mixed, because a step handed the other kind passes it through untouched. Read the words (OCR) takes either kind and ends the chain with text.';
  }
}

// ---------- chain builder ----------
function renderSteps() {
  stepsEl.innerHTML = '';
  steps.forEach((s, i) => {
    const row = document.createElement('div');
    row.className = 'spec-row items-center';
    const left = document.createElement('span');
    left.textContent = (i + 1) + '. ' + describeStep(s);
    const right = document.createElement('span');
    right.className = 'flex items-center gap-2';
    const up = document.createElement('button');
    up.type = 'button'; up.className = 'chip'; up.textContent = 'Up'; up.disabled = i === 0;
    up.addEventListener('click', () => { [steps[i - 1], steps[i]] = [steps[i], steps[i - 1]]; renderSteps(); });
    const down = document.createElement('button');
    down.type = 'button'; down.className = 'chip'; down.textContent = 'Down'; down.disabled = i === steps.length - 1;
    down.addEventListener('click', () => { [steps[i + 1], steps[i]] = [steps[i], steps[i + 1]]; renderSteps(); });
    const rm = document.createElement('button');
    rm.type = 'button'; rm.className = 'chip'; rm.textContent = 'Remove';
    rm.addEventListener('click', () => { steps.splice(i, 1); renderSteps(); });
    right.append(up, down, rm);
    row.append(left, right);
    stepsEl.appendChild(row);
  });
  if (!steps.length) {
    const p = document.createElement('p');
    p.className = 'font-mono text-sm text-ink-soft';
    p.textContent = 'No steps yet. Add one below, or take a starter chain.';
    stepsEl.appendChild(p);
  }
  if (ocrMisplaced()) {
    const p = document.createElement('p');
    p.className = 'font-mono text-sm text-accent-deep mt-2';
    p.textContent = 'Read the words (OCR) turns files into text, so it has to be the last step in the chain. Move it to the end, or remove it; the chain will not run while it sits earlier.';
    stepsEl.appendChild(p);
  }
  refreshPicker();
  $('wf-run').disabled = running || !steps.length || !files.length || ocrMisplaced();
}

function renderSaved() {
  const chains = getChains();
  savedEl.innerHTML = '';
  if (!chains.length) {
    const p = document.createElement('p');
    p.className = 'font-mono text-sm text-ink-soft';
    p.textContent = 'No saved chains yet.';
    savedEl.appendChild(p);
    return;
  }
  for (const c of chains) {
    const row = document.createElement('div');
    row.className = 'spec-row items-center';
    const left = document.createElement('span');
    left.textContent = c.name + ' · ' + c.steps.map(describeStep).join(' → ');
    const right = document.createElement('span');
    right.className = 'flex items-center gap-2';
    const load = document.createElement('button');
    load.type = 'button'; load.className = 'chip'; load.textContent = 'Load';
    load.addEventListener('click', () => {
      currentId = c.id;
      $('wf-name').value = c.name;
      steps = c.steps.map(normalizeStep);
      renderSteps();
      setStatus('Chain "' + c.name + '" loaded. Drop files on the tray and run it.');
    });
    const del = document.createElement('button');
    del.type = 'button'; del.className = 'chip'; del.textContent = 'Delete';
    del.addEventListener('click', () => {
      saveChains(getChains().filter((x) => x.id !== c.id));
      if (currentId === c.id) currentId = null;
      renderSaved();
    });
    right.append(load, del);
    row.append(left, right);
    savedEl.appendChild(row);
  }
}

document.querySelectorAll('[data-starter]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const starter = STARTER_CHAINS.find((c) => c.id === btn.dataset.starter);
    if (!starter) return;
    if (!getChains().some((c) => c.id === starter.id)) addChain(starter);
    currentId = starter.id;
    $('wf-name').value = starter.name;
    steps = starter.steps.map(normalizeStep);
    renderSteps();
    renderSaved();
    setStatus('Starter chain "' + starter.name + '" saved and loaded. Drop files on the tray and run it.');
  });
});

$('wf-add').addEventListener('click', () => {
  const tool = $('wf-tool').value;
  const picked = stepTool(tool);
  if (!picked || picked.endsWithText && steps.some((s) => s.tool === 'ocr')) return;
  const kind = chainKind(steps);
  if (kind !== null && picked.kind !== 'any' && picked.kind !== kind) return; // the picker disables it; belt and braces
  if (steps.some((s) => s.tool === 'ocr')) return;
  const step = normalizeStep({
    tool,
    targetKB: tool === 'compress-pdf' || tool === 'compress-image' ? (parseInt($('wf-target').value, 10) || (tool === 'compress-pdf' ? 500 : 200)) : null,
    fromPage: tool === 'split' ? (parseInt($('wf-from').value, 10) || 1) : null,
    toPage: tool === 'split' ? (parseInt($('wf-to').value, 10) || null) : null,
    text: tool === 'stamp' ? (($('wf-text').value || '').trim() || 'PAID') : null,
  });
  steps.push(step);
  renderSteps();
});

$('wf-save').addEventListener('click', () => {
  const name = ($('wf-name').value || '').trim();
  if (!name) { setStatus('Give the chain a name first.'); return; }
  if (!steps.length) { setStatus('Add at least one step first.'); return; }
  const chain = normalizeChain({ id: currentId || undefined, name, steps });
  const chains = getChains().filter((c) => c.id !== chain.id);
  chains.push(chain);
  saveChains(chains);
  currentId = chain.id;
  renderSaved();
  setStatus('Chain "' + name + '" saved in this browser. It will be here next visit; your files never are.');
});

// ---------- the run ----------
wireTrayMulti($('wf-tray'), $('wf-file'), (picked) => {
  files = picked;
  result.classList.add('hidden');
  const spec = $('wf-spec');
  spec.innerHTML = [
    ['files on the tray', String(files.length)],
    ['size in', fmtBytes(files.reduce((a, f) => a + f.size, 0))],
  ].map(([k, v]) => `<div class="spec-row"><dt>${k}</dt><dd>${v}</dd></div>`).join('');
  setStatus(files.length ? 'Ready. The chain runs top to bottom; each step feeds the next.' : 'Pick files to begin.');
  renderSteps();
});

function kindOf(name, type) {
  if (type === 'application/pdf' || /\.pdf$/i.test(name)) return 'pdf';
  if ((type && type.startsWith('image/')) || /\.(jpe?g|png|webp|heic|heif)$/i.test(name)) return 'image';
  return 'other';
}
function baseName(name) { return name.replace(/\.[^.]+$/, ''); }

async function runMerge(items, step, log) {
  const pdfs = items.filter((i) => i.kind === 'pdf');
  const rest = items.filter((i) => i.kind !== 'pdf');
  if (pdfs.length < 2) {
    log('Merge: fewer than two PDFs on the tray; files passed through unchanged.');
    return items;
  }
  const out = await PDFDocument.create();
  for (const item of pdfs) {
    const src = await PDFDocument.load(new Uint8Array(await item.blob.arrayBuffer()), { updateMetadata: false });
    const copied = await out.copyPages(src, src.getPageIndices());
    copied.forEach((p) => out.addPage(p));
  }
  const bytes = await out.save();
  log('Merge: ' + pdfs.length + ' PDFs became one file of ' + out.getPageCount() + ' pages.');
  return [{ name: 'merged.pdf', kind: 'pdf', blob: new Blob([bytes], { type: 'application/pdf' }) }, ...rest];
}

async function runCompressPdf(items, step, log) {
  const target = (step.targetKB || 500) * 1024;
  const out = [];
  for (const item of items) {
    if (item.kind !== 'pdf') { out.push(item); continue; }
    const bytes = new Uint8Array(await item.blob.arrayBuffer());
    const r = await compressPdfToTarget(bytes, target);
    if (r.changed) {
      out.push({ name: baseName(item.name) + '-smaller.pdf', kind: 'pdf', blob: new Blob([r.out], { type: 'application/pdf' }) });
      log('Compress PDF: ' + item.name + ' ' + fmtBytes(bytes.length) + ' to ' + fmtBytes(r.out.length) + '.');
    } else {
      out.push(item);
      log('Compress PDF: ' + item.name + ' unchanged (' + r.reason.replace(/-/g, ' ') + ').');
    }
  }
  return out;
}

async function runSplit(items, step, log) {
  const out = [];
  for (const item of items) {
    if (item.kind !== 'pdf') { out.push(item); continue; }
    const bytes = new Uint8Array(await item.blob.arrayBuffer());
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    const count = doc.getPageCount();
    const a = Math.min(Math.max(1, step.fromPage || 1), count);
    const b = Math.min(step.toPage || count, count);
    // Delete-based extraction (as on the Split bench): keeps pages
    // whose images live in shared page-tree resources whole.
    for (let i = count - 1; i >= 0; i--) if (i < a - 1 || i > b - 1) doc.removePage(i);
    const outBytes = await doc.save();
    out.push({ name: baseName(item.name) + '-pages-' + a + '-' + b + '.pdf', kind: 'pdf', blob: new Blob([outBytes], { type: 'application/pdf' }) });
    log('Split: ' + item.name + ' (' + fmtBytes(bytes.length) + ') gave pages ' + a + ' to ' + b + ' of ' + count + ' (' + fmtBytes(outBytes.length) + ').');
  }
  return out;
}

async function runStamp(items, step, log) {
  const text = (step.text || 'PAID').slice(0, 60);
  const out = [];
  for (const item of items) {
    if (item.kind !== 'pdf') { out.push(item); continue; }
    const bytes = new Uint8Array(await item.blob.arrayBuffer());
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    const font = await doc.embedFont(StandardFonts.HelveticaBold);
    for (const page of doc.getPages()) {
      const { width } = page.getSize();
      const size = 13;
      const w = font.widthOfTextAtSize(text, size);
      page.drawText(text, { x: Math.max(18, (width - w) / 2), y: 22, size, font, color: rgb(0.72, 0.26, 0.07), opacity: 0.9 });
    }
    const outBytes = await doc.save();
    out.push({ name: item.name, kind: 'pdf', blob: new Blob([outBytes], { type: 'application/pdf' }) });
    log('Stamp: "' + text + '" placed on every page of ' + item.name + ' (' + fmtBytes(bytes.length) + ' to ' + fmtBytes(outBytes.length) + ').');
  }
  return out;
}

async function runCompressImage(items, step, log) {
  const target = (step.targetKB || 200) * 1024;
  const targetLabel = (step.targetKB || 200) + ' KB';
  const out = [];
  let codecsReady = false;
  for (const item of items) {
    if (item.kind !== 'image') { out.push(item); continue; }
    if (!codecsReady) { await initImageCodecs(); codecsReady = true; }
    if (item.blob.size <= target && (item.blob.type === 'image/jpeg' || item.blob.type === 'image/png')) {
      out.push(item);
      log('Compress image: ' + item.name + ' already under the ' + targetLabel + ' target; kept as it is.');
      continue;
    }
    const buf = await item.blob.arrayBuffer();
    const img = await decodeImageFile({ type: item.blob.type || 'image/jpeg', name: item.name }, buf);
    if (hasAlpha(img)) {
      // A picture with see-through parts (a cutout) stays a PNG: JPEG
      // cannot hold transparency, and flattening it here would paint
      // the removed background straight back in. PNG has no quality
      // dial, so the search shrinks the dimensions to fit the target.
      const best = await compressPngToTarget(img, target);
      out.push({ name: baseName(item.name) + '.png', kind: 'image', blob: new Blob([best.buf], { type: 'image/png' }) });
      if (best.over) {
        log('Compress image: ' + item.name + ' has see-through parts, so it stays a PNG; even at ' + best.w + 'x' + best.h + ' it lands at ' + fmtBytes(best.bytes) + ', over the ' + targetLabel + ' target. That is the smallest honest result.');
      } else {
        log('Compress image: ' + item.name + ' has see-through parts, so it stays a PNG: ' + fmtBytes(item.blob.size) + ' to ' + fmtBytes(best.bytes) + ' at ' + best.w + 'x' + best.h + '.');
      }
      continue;
    }
    const best = await compressImageToTarget(img, target);
    out.push({ name: baseName(item.name) + '.jpg', kind: 'image', blob: new Blob([best.buf], { type: 'image/jpeg' }) });
    log('Compress image: ' + item.name + ' ' + fmtBytes(item.blob.size) + ' to ' + fmtBytes(best.bytes) + ' at quality ' + best.q + '.');
  }
  return out;
}

// Decode a chain item to a bitmap for the background engine: the
// browser's own reader first (JPG/PNG/WebP), then the shared image
// core, which is also the HEIC path.
async function decodeChainBitmap(item) {
  const buf = await item.blob.arrayBuffer();
  // HEIC photos go through the shipped libheif reader FIRST
  // (milestone 18): whether createImageBitmap rejects them depends on
  // the browser, so the check sniffs the file's own bytes instead of
  // waiting for a failure, the same route as the single-photo tool.
  if (isHeifFile({ type: item.blob.type || '', name: item.name }, buf)) {
    const img = await decodeImageFile({ type: item.blob.type || 'image/jpeg', name: item.name }, buf);
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    c.getContext('2d').putImageData(img, 0, 0);
    return createImageBitmap(c);
  }
  try {
    return await createImageBitmap(item.blob);
  } catch (e) {
    const img = await decodeImageFile({ type: item.blob.type || 'image/jpeg', name: item.name }, buf);
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    c.getContext('2d').putImageData(img, 0, 0);
    return createImageBitmap(c);
  }
}

async function runRemoveBg(items, step, log) {
  const out = [];
  let sessionReady = false;
  for (const item of items) {
    if (item.kind !== 'image') {
      out.push(item);
      log('Remove background: ' + item.name + ' is not a photo; passed through unchanged.');
      continue;
    }
    if (!sessionReady) {
      // The one model download, with the same words and the same
      // working Cancel as the background benches: pieces already
      // fetched are kept, and a later run resumes the load.
      chainAbort = new AbortController();
      if (cancelBtn) cancelBtn.classList.remove('hidden');
      try {
        await loadBgSession((p) => {
          if (p.phase === 'piece') setStatus('Loading the removal program: ' + p.gotMB.toFixed(1) + ' of ' + p.totalMB.toFixed(1) + ' MB (piece ' + p.piece + ' of ' + p.pieces + ', each one checked)…');
          else if (p.phase === 'list') setStatus('Loading the tool program (44 MB, one time only). It runs in your browser to protect your privacy: your photos never leave your device…');
          else if (p.phase === 'checked') setStatus('Model downloaded and checked. Starting it…');
          else if (p.phase === 'starting') setStatus('Starting the model…');
        }, chainAbort.signal);
      } finally {
        if (cancelBtn) cancelBtn.classList.add('hidden');
        chainAbort = null;
      }
      sessionReady = true;
    }
    let bitmap;
    try {
      bitmap = await decodeChainBitmap(item);
    } catch (err) {
      out.push(item);
      log('Remove background: ' + item.name + ' could not be opened as a photo; passed through unchanged.');
      continue;
    }
    setStatus('Removing the background from ' + item.name + '…');
    const r = await cutoutBitmap(bitmap);
    if (r.noSubject) {
      out.push(item);
      log('Remove background: no clear subject found in ' + item.name + '; passed through unchanged.');
      continue;
    }
    const name = baseName(item.name) + '-no-background.png';
    out.push({ name, kind: 'image', blob: r.blob });
    log('Remove background: ' + item.name + ' (' + fmtBytes(item.blob.size) + ') cut out at full size ' + r.width + 'x' + r.height + ', in ' + r.runSecs.toFixed(1) + ' s → ' + name + ' (' + fmtBytes(r.blob.size) + ').');
  }
  return out;
}

// ---------- reading words (OCR): the terminal step ----------
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

function chainOcrWorker() {
  return getOcrWorker('eng', {
    loading: () => setStatus('Loading the reading program (about 10 MB, one time only). It runs in your browser to protect your privacy: your files never leave your device…'),
    progress: (pct) => setStatus('Reading… ' + pct + '%'),
  });
}

const OCR_MAX_PDF_PAGES = 50; // the same printed limit as the Read a scan page

async function ocrImageItem(item, log) {
  const buf = await item.blob.arrayBuffer();
  const img = await decodeImageFile({ type: item.blob.type || 'image/jpeg', name: item.name }, buf);
  let src = img;
  if (hasAlpha(img)) {
    // A cutout's words are read over white, the ground a listing or a
    // form would put behind them; the see-through parts carry no words.
    src = flattenOnto(img, '#ffffff');
    log('Read words: ' + item.name + ' has see-through parts; they were read over white.');
  }
  const p = ocrPlan(src.width, src.height);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(src.width * p.factor));
  canvas.height = Math.max(1, Math.round(src.height * p.factor));
  const ctx = canvas.getContext('2d');
  const flat = document.createElement('canvas');
  flat.width = src.width; flat.height = src.height;
  flat.getContext('2d').putImageData(src, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(flat, 0, 0, canvas.width, canvas.height);
  const png = await new Promise((r) => canvas.toBlob(r, 'image/png'));
  const w = await chainOcrWorker();
  const { data } = await w.recognize(png);
  return (data.text || '').trim();
}

async function ocrPdfItem(item, log) {
  const bytes = new Uint8Array(await item.blob.arrayBuffer());
  const pdfjs = await loadPdfjs();
  const pdf = await pdfjs.getDocument({ data: bytes.slice() }).promise;
  try {
    if (pdf.numPages > OCR_MAX_PDF_PAGES) {
      log('Read words: ' + item.name + ' has ' + pdf.numPages + ' pages; a chain reads up to ' + OCR_MAX_PDF_PAGES + ' at a time (split it first with the Split step or the Split PDF tool). The file is in the output unchanged.');
      return null;
    }
    const w = await chainOcrWorker();
    const SCALE = 300 / 72; // the bench's fixed reading depth, as on the Read a scan page
    const texts = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      setStatus('Reading page ' + i + ' of ' + pdf.numPages + ' of ' + item.name + '…');
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: SCALE });
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
      const png = await new Promise((r) => canvas.toBlob(r, 'image/png'));
      const { data } = await w.recognize(png);
      texts.push((data.text || '').trim());
      page.cleanup();
    }
    return texts.map((t, i) => (pdf.numPages > 1 ? '--- Page ' + (i + 1) + ' ---\n' : '') + t).join('\n\n');
  } finally {
    try { await pdf.loadingTask.destroy(); } catch (e) { /* already gone */ }
  }
}

async function runOcr(items, step, log) {
  const out = [];
  for (const item of items) {
    if (item.kind !== 'image' && item.kind !== 'pdf') {
      out.push(item);
      log('Read words: ' + item.name + ' is neither a PDF nor a photo; passed through unchanged.');
      continue;
    }
    try {
      const text = item.kind === 'image' ? await ocrImageItem(item, log) : await ocrPdfItem(item, log);
      if (text === null) { out.push(item); continue; } // the refusal is already in the log
      out.push({ name: baseName(item.name) + '-text.txt', kind: 'text', text, from: item.name });
      if (text) {
        log('Read words: ' + item.name + ' (' + fmtBytes(item.blob.size) + ') → ' + text.length + ' characters of text.');
      } else {
        log('Read words: the reader found no words it could read in ' + item.name + '; the text output for it is empty. Nothing was made up to fill it.');
      }
    } catch (err) {
      out.push(item);
      log('Read words: ' + item.name + ' could not be read (' + (err && err.message ? err.message : err) + '); the file is in the output unchanged.');
    }
  }
  return out;
}

const RUNNERS = { merge: runMerge, 'compress-pdf': runCompressPdf, split: runSplit, stamp: runStamp, 'compress-image': runCompressImage, 'remove-bg': runRemoveBg, ocr: runOcr };

// ---------- outputs ----------
// Text outputs (from the reading step) render as boxes, like the
// single reading pages: the visitor checks and fixes the words, and
// Copy and the .txt download use the text exactly as it stands in
// the box. File outputs render as download rows, as before.
function renderOutputs(items, logLines) {
  outputsEl.innerHTML = '';
  const textAreas = [];
  const zipEntries = [];
  for (const item of items) {
    if (item.kind === 'text') {
      const wrap = document.createElement('div');
      wrap.className = 'mt-3';
      const head = document.createElement('div');
      head.className = 'spec-row items-center';
      const left = document.createElement('span');
      left.textContent = item.name + ' — the words read from ' + (item.from || 'the file');
      const right = document.createElement('span');
      right.className = 'flex items-center gap-2';
      const copyBtn = document.createElement('button');
      copyBtn.type = 'button'; copyBtn.className = 'chip'; copyBtn.textContent = 'Copy';
      const dlBtn = document.createElement('button');
      dlBtn.type = 'button'; dlBtn.className = 'chip'; dlBtn.textContent = 'Download .txt';
      right.append(copyBtn, dlBtn);
      head.append(left, right);
      const ta = document.createElement('textarea');
      ta.className = 'w-full border border-ink bg-ticket px-3 py-2 font-mono text-sm mt-2';
      ta.rows = 8;
      ta.value = item.text;
      ta.setAttribute('aria-label', 'Words read from ' + (item.from || item.name));
      copyBtn.addEventListener('click', async () => {
        let copied = false;
        try { await navigator.clipboard.writeText(ta.value); copied = true; }
        catch (e) {
          ta.focus(); ta.select();
          try { copied = document.execCommand('copy'); } catch (e2) { copied = false; }
        }
        setStatus(copied ? 'Copied. The text in the box, exactly as it stands, is on your clipboard.' : 'Copy did not take. Select the text in the box and copy it the usual way; it is all there.');
      });
      dlBtn.addEventListener('click', () => {
        const blob = new Blob([ta.value], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = item.name; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      });
      wrap.append(head, ta);
      outputsEl.appendChild(wrap);
      textAreas.push({ item, ta });
      continue;
    }
    const url = URL.createObjectURL(item.blob);
    zipEntries.push({ name: item.name, data: item.blob });
    const row = document.createElement('div');
    row.className = 'spec-row items-center';
    const left = document.createElement('span');
    left.textContent = item.name;
    const a = document.createElement('a');
    a.className = 'chip no-underline';
    a.href = url; a.download = item.name; a.textContent = 'Download (' + fmtBytes(item.blob.size) + ')';
    row.append(left, a);
    outputsEl.appendChild(row);
  }
  if (ocrNote) ocrNote.classList.toggle('hidden', !textAreas.length);
  const total = items.length;
  if (total > 1) {
    zipLink.classList.remove('hidden');
    if (textAreas.length) {
      // Built on the click, so the words go in as they stand in the
      // boxes, visitor fixes included.
      zipLink.href = '#';
      zipLink.removeAttribute('download');
      zipLink.textContent = 'Download all outputs as one ZIP (texts as they stand in their boxes)';
      zipLink.onclick = async (ev) => {
        ev.preventDefault();
        const entries = [...zipEntries];
        for (const { item, ta } of textAreas) entries.push({ name: item.name, data: new Blob([ta.value], { type: 'text/plain' }) });
        const { blob, name } = await makeZip(entries, 'benchzy-chain-output.zip');
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = name; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      };
    } else {
      zipLink.onclick = null;
      makeZip(zipEntries, 'benchzy-chain-output.zip').then(({ blob, name }) => {
        zipLink.href = URL.createObjectURL(blob);
        zipLink.download = name;
        zipLink.textContent = 'Download all outputs as one ZIP (' + fmtBytes(blob.size) + ')';
      });
    }
  } else {
    zipLink.classList.add('hidden');
    zipLink.onclick = null;
  }
  const logEl = $('wf-log');
  logEl.innerHTML = '';
  for (const line of logLines) {
    const li = document.createElement('li');
    li.textContent = line;
    logEl.appendChild(li);
  }
  result.classList.remove('hidden');
  const stamp = $('wf-stamp');
  stamp.classList.remove('land');
  void stamp.offsetWidth;
  stamp.classList.add('land');
}

$('wf-run').addEventListener('click', async () => {
  if (running || !steps.length || !files.length || ocrMisplaced()) return;
  running = true;
  renderSteps();
  result.classList.add('hidden');
  outputsEl.innerHTML = '';
  zipLink.classList.add('hidden');
  const logLines = [];
  const log = (m) => { logLines.push(m); setStatus(m); };
  let items = files.map((f) => ({ name: f.name, kind: kindOf(f.name, f.type), blob: f }));
  try {
    for (const step of steps) {
      log('Step: ' + describeStep(step) + '…');
      items = await RUNNERS[step.tool](items, step, log);
    }
    renderOutputs(items, logLines);
    recordJob({ tool: 'Workflow chain', name: ($('wf-name').value || 'chain').trim() || 'chain', detail: items.length + ' output' + (items.length === 1 ? '' : 's') });
    setStatus('Chain done. ' + items.length + ' output' + (items.length === 1 ? '' : 's') + ' ready below.');
  } catch (err) {
    if (err && err.cancelled) {
      // The background model's download was cancelled mid-load: the
      // engine keeps the pieces it already fetched, and the outputs
      // of the steps that did finish are shown, as they stand.
      log('Remove background: loading stopped. ' + err.kept + ' of ' + err.total + ' pieces are already here and are kept; run the chain again and the load carries on from there.');
      renderOutputs(items, logLines);
      setStatus('Loading stopped. ' + err.kept + ' of ' + err.total + ' pieces are already here and are kept; run the chain again and the load carries on from there.');
    } else {
      setStatus('The chain stopped: ' + (err && err.message ? err.message : err) + '. Your original files are unchanged.');
    }
  } finally {
    running = false;
    renderSteps();
  }
});

// Populate the step-tool select from the shared definitions.
{
  const sel = $('wf-tool');
  for (const t of STEP_TOOLS) {
    const o = document.createElement('option');
    o.value = t.id;
    o.textContent = t.label;
    sel.appendChild(o);
  }
}
renderSteps();
renderSaved();
