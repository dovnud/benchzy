// Workflows: chained jobs and saved presets (ticket T7). Build a chain
// out of the measured tools, save it in your browser under your own
// name, drop files on the tray, and the chain runs end to end: each
// step's output feeds the next. The engines are the same ones the
// single-tool benches run (pdf-lib page copying, the compress cores,
// the image cores); a step that cannot use a file passes it through
// and says so, per file, in the run log. Chains hold settings only;
// files are never stored or sent.
import { PDFDocument, StandardFonts, rgb } from '@cantoo/pdf-lib';
import { fmtBytes, recordJob, wireTrayMulti, getChains, saveChains, addChain, normalizeChain, normalizeStep } from './workbench.js';
import { compressPdfToTarget } from './lib/pdf-compress-core.js';
import { initImageCodecs, decodeImageFile, compressImageToTarget } from './lib/image-core.js';
import { STEP_TOOLS, describeStep, STARTER_CHAINS } from './lib/chains.js';
import { makeZip } from './lib/zip.js';

const $ = (id) => document.getElementById(id);
const stepsEl = $('wf-steps'), savedEl = $('wf-saved'), status = $('wf-status');
const outputsEl = $('wf-outputs'), zipLink = $('wf-zip'), result = $('wf-result');
let steps = [];
let currentId = null;
let files = [];
let running = false;

function setStatus(msg) { status.textContent = msg; }

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
  $('wf-run').disabled = running || !steps.length || !files.length;
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
  if ((type && type.startsWith('image/')) || /\.(jpe?g|png|webp)$/i.test(name)) return 'image';
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
    log('Split: ' + item.name + ' gave pages ' + a + ' to ' + b + ' of ' + count + '.');
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
    log('Stamp: "' + text + '" placed on every page of ' + item.name + '.');
  }
  return out;
}

async function runCompressImage(items, step, log) {
  const target = (step.targetKB || 200) * 1024;
  const out = [];
  let codecsReady = false;
  for (const item of items) {
    if (item.kind !== 'image') { out.push(item); continue; }
    if (!codecsReady) { await initImageCodecs(); codecsReady = true; }
    const buf = await item.blob.arrayBuffer();
    if (item.blob.size <= target && item.blob.type === 'image/jpeg') {
      out.push(item);
      log('Compress image: ' + item.name + ' already under the target; kept as it is.');
      continue;
    }
    const img = await decodeImageFile({ type: item.blob.type || 'image/jpeg' }, buf);
    const best = await compressImageToTarget(img, target);
    out.push({ name: baseName(item.name) + '.jpg', kind: 'image', blob: new Blob([best.buf], { type: 'image/jpeg' }) });
    log('Compress image: ' + item.name + ' to ' + fmtBytes(best.bytes) + ' at quality ' + best.q + '.');
  }
  return out;
}

const RUNNERS = { merge: runMerge, 'compress-pdf': runCompressPdf, split: runSplit, stamp: runStamp, 'compress-image': runCompressImage };

$('wf-run').addEventListener('click', async () => {
  if (running || !steps.length || !files.length) return;
  running = true;
  renderSteps();
  result.classList.add('hidden');
  outputsEl.innerHTML = '';
  zipLink.classList.add('hidden');
  const logLines = [];
  const log = (m) => { logLines.push(m); setStatus(m); };
  try {
    let items = files.map((f) => ({ name: f.name, kind: kindOf(f.name, f.type), blob: f }));
    for (const step of steps) {
      log('Step: ' + describeStep(step) + '…');
      items = await RUNNERS[step.tool](items, step, log);
    }
    const zipEntries = [];
    for (const item of items) {
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
    if (zipEntries.length > 1) {
      const { blob, name } = await makeZip(zipEntries, 'benchzy-chain-output.zip');
      zipLink.href = URL.createObjectURL(blob);
      zipLink.download = name;
      zipLink.textContent = 'Download all outputs as one ZIP (' + fmtBytes(blob.size) + ')';
      zipLink.classList.remove('hidden');
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
    recordJob({ tool: 'Workflow chain', name: ($('wf-name').value || 'chain').trim() || 'chain', detail: items.length + ' output' + (items.length === 1 ? '' : 's') });
    setStatus('Chain done. ' + items.length + ' output' + (items.length === 1 ? '' : 's') + ' ready below.');
  } catch (err) {
    setStatus('The chain stopped: ' + (err && err.message ? err.message : err) + '. Your original files are unchanged.');
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
