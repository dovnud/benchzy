// Compress PDF to a target size.
// Engine: @cantoo/pdf-lib + jSquash (mozjpeg) recompression of the photos
// inside the PDF, the measured bench pipeline (bench/pdfnums/compress.mjs),
// made probe-first per build ticket T1: decode the photos once, probe the
// largest one, pick a ladder setting, rebuild, verify the bytes, adjust at
// most a few rungs. A PDF with nothing compressible gets its original back
// with the honest line, per FINE-PRINT.
import { PDFDocument, PDFName, PDFDict, PDFRawStream, PDFNumber } from '@cantoo/pdf-lib';
import jpegDecode, { init as initJpegDec } from '@jsquash/jpeg/decode.js';
import jpegEncode, { init as initJpegEnc } from '@jsquash/jpeg/encode.js';
import resize, { initResize } from '@jsquash/resize';
import { fmtBytes, recordJob, savePreset, getPreset, wireTray } from './workbench.js';
import { compressPdfStrong } from './lib/pdf-compress-core.js';

const $ = (id) => document.getElementById(id);

// Strong mode (milestone 6): the /compress-pdf-strong/ page sets
// data-mode="strong" on #cp-tool. No target: the core walks the deep end
// of the same measured ladder and keeps the smallest honest result.
const strongMode = !!$('cp-tool') && $('cp-tool').dataset.mode === 'strong';
const tray = $('cp-tray'), input = $('cp-file'), spec = $('cp-spec');
const runBtn = $('cp-run'), status = $('cp-status'), result = $('cp-result');
const customInput = $('cp-custom');
let file = null, fileBytes = null, scanInfo = null, targetKB = 500, inited = false, running = false;

// Preset pages (e.g. /compress-pdf-to-200kb/) set data-preset-kb and
// data-lock-target on #cp-tool: the target is fixed by the page, and the
// visitor's saved general preset does not override it.
const toolEl = $('cp-tool');
const presetKB = toolEl && toolEl.dataset.presetKb ? parseInt(toolEl.dataset.presetKb, 10) : null;
// The 1 MB door presets 1024 KB; its label reads "1 MB", not "1024 KB".
const targetLabel = (kb) => kb === 1024 ? '1 MB' : kb + ' KB';
const lockTarget = !!toolEl && toolEl.dataset.lockTarget === '1';
if (presetKB) targetKB = presetKB;
if (!lockTarget) {
  const saved = getPreset('compress-pdf');
  if (saved && saved.targetKB) targetKB = saved.targetKB;
}
if (customInput) customInput.value = targetKB;

function setStatus(msg) { status.textContent = msg; }
function setSpec(rows) {
  spec.innerHTML = rows.map(([k, v]) => `<div class="spec-row"><dt>${k}</dt><dd>${v}</dd></div>`).join('');
}

async function initCodecs() {
  if (inited) return;
  setStatus('Loading the PDF program (about 3 MB, one time only). It runs in your browser; your file is never uploaded…');
  const compile = async (p) => {
    const res = await fetch(p);
    return WebAssembly.compile(await res.arrayBuffer());
  };
  await initJpegDec(await compile('/codecs/mozjpeg_dec.wasm'));
  await initJpegEnc(await compile('/codecs/mozjpeg_enc.wasm'));
  initResize(await (await fetch('/codecs/squoosh_resize_bg.wasm')).arrayBuffer());
  inited = true;
}

function nameOf(obj) { return obj && obj.toString ? obj.toString() : ''; }

// Walk every page's image XObjects; keep the unique JPEG (DCTDecode) streams.
async function scanPdf(bytes) {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const pages = doc.getPages();
  const byRef = new Map();
  for (const page of pages) {
    const resources = page.node.Resources();
    if (!resources) continue;
    let xo = null;
    try { xo = resources.lookup(PDFName.of('XObject'), PDFDict); } catch (e) { continue; }
    if (!xo) continue;
    for (const [key, ref] of xo.entries()) {
      if (byRef.has(ref.toString())) continue;
      const obj = doc.context.lookup(ref);
      if (!(obj instanceof PDFRawStream)) continue;
      const dict = obj.dict;
      const subtype = dict.lookup(PDFName.of('Subtype'));
      if (!subtype || subtype.toString() !== '/Image') continue;
      const filter = dict.lookup(PDFName.of('Filter'));
      const filterStr = filter ? filter.toString() : '';
      if (!filterStr.includes('DCTDecode')) continue;
      const w = dict.lookup(PDFName.of('Width'));
      const h = dict.lookup(PDFName.of('Height'));
      const cs = dict.lookup(PDFName.of('ColorSpace'));
      byRef.set(ref.toString(), {
        ref,
        bytes: obj.getContents(),
        width: w && w.asNumber ? w.asNumber() : 0,
        height: h && h.asNumber ? h.asNumber() : 0,
        colorSpace: cs || null,
      });
    }
  }
  const images = [...byRef.values()];
  return { pageCount: pages.length, images, imageBytes: images.reduce((a, i) => a + i.bytes.length, 0) };
}

wireTray(tray, input, async (f) => {
  result.classList.add('hidden');
  runBtn.disabled = true;
  file = f;
  setStatus('Reading the PDF…');
  try {
    fileBytes = new Uint8Array(await f.arrayBuffer());
    scanInfo = await scanPdf(fileBytes);
    setSpec([
      ['file', f.name],
      ['size now', fmtBytes(f.size)],
      ['pages', String(scanInfo.pageCount)],
      ['photos inside', scanInfo.images.length + ' (' + fmtBytes(scanInfo.imageBytes) + ')'],
      strongMode ? ['mode', 'strong: smallest this tool can reach'] : ['target', targetLabel(targetKB)],
    ]);
    if (scanInfo.images.length === 0) {
      setStatus('This PDF has no photos inside to recompress. Run it anyway: you will get your original back with an honest note.');
    } else {
      setStatus('Ready. Shrinking works by recompressing the photos inside, here in the page.');
    }
    runBtn.disabled = false;
  } catch (err) {
    setStatus('That file could not be read as a PDF: ' + (err && err.message ? err.message : err));
  }
});

document.querySelectorAll('#cp-targets .chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('#cp-targets .chip').forEach((c) => c.setAttribute('aria-pressed', 'false'));
    chip.setAttribute('aria-pressed', 'true');
    targetKB = parseInt(chip.dataset.kb, 10);
    if (customInput) customInput.value = targetKB;
  });
});
if (customInput) customInput.addEventListener('change', () => {
  const v = parseInt(customInput.value, 10);
  if (v >= 20 && v <= 50000) targetKB = v;
});
{
  const match = document.querySelector(`#cp-targets .chip[data-kb="${targetKB}"]`);
  if (match) match.setAttribute('aria-pressed', 'true');
}

// Ladder of (scale, quality), biggest output first.
const LADDER = [
  [1, 80], [1, 65], [1, 50], [1, 38],
  [0.75, 50], [0.75, 38],
  [0.5, 50], [0.5, 38],
  [0.35, 38], [0.25, 38], [0.18, 30], [0.12, 24], [0.12, 16],
];

runBtn.addEventListener('click', async () => {
  if (!file || !scanInfo || running) return;
  running = true;
  runBtn.disabled = true;
  result.classList.add('hidden');
  const target = targetKB * 1024;
  try {
    if (strongMode) {
      if (scanInfo.images.length === 0) {
        showResult(new Blob([fileBytes], { type: 'application/pdf' }), file.size,
          'We could not make this PDF smaller. It has no photos inside to recompress, and re-saving alone does not shrink a text PDF (in our tests a re-save moved a text PDF from 7,203 bytes to 7,231). Here is your original back, unchanged.');
        recordJob({ tool: 'Compress PDF (strong)', name: file.name, detail: 'no change possible' });
        return;
      }
      const r = await compressPdfStrong(fileBytes, (s, q) => {
        setStatus('Building strong at ' + Math.round(s * 100) + '% photo size, quality ' + q + '…');
      });
      if (!r.changed) {
        showResult(new Blob([fileBytes], { type: 'application/pdf' }), file.size,
          'We could not make this PDF smaller than it already is, even at the strongest setting. Here is your original back, unchanged.');
        recordJob({ tool: 'Compress PDF (strong)', name: file.name, detail: 'no change possible' });
        return;
      }
      const [ss, sq] = r.setting;
      showResult(new Blob([r.out], { type: 'application/pdf' }), r.out.length,
        'Strong result: ' + fmtBytes(r.out.length) + ', down from ' + fmtBytes(file.size) + ' (photos at ' + Math.round(ss * 100) + '% size, quality ' + sq + ').' +
        (r.skipped.length ? ' ' + r.skipped.length + ' photo(s) inside use a format we could not re-encode and were left as they were.' : ''));
      recordJob({ tool: 'Compress PDF (strong)', name: file.name, detail: fmtBytes(file.size) + ' to ' + fmtBytes(r.out.length) });
      return;
    }
    if (file.size <= target) {
      showResult(new Blob([fileBytes], { type: 'application/pdf' }), file.size,
        `Already under your target at ${fmtBytes(file.size)}. Here is your file back, unchanged.`);
      return;
    }
    await initCodecs();

    if (scanInfo.images.length === 0) {
      showResult(new Blob([fileBytes], { type: 'application/pdf' }), file.size,
        'We could not make this PDF smaller. It has no photos inside to recompress, and re-saving alone does not shrink a text PDF. Here is your original back, unchanged.');
      recordJob({ tool: 'Compress PDF', name: file.name, detail: 'no change possible' });
      return;
    }

    // Decode every photo once.
    setStatus('Reading the photos inside…');
    const decoded = new Map();
    const skipped = [];
    for (const img of scanInfo.images) {
      try {
        const ab = img.bytes.buffer.slice(img.bytes.byteOffset, img.bytes.byteOffset + img.bytes.byteLength);
        decoded.set(img.ref.toString(), await jpegDecode(ab));
      } catch (e) { skipped.push(img); }
    }
    const usable = scanInfo.images.filter((i) => decoded.has(i.ref.toString()));
    if (usable.length === 0) {
      showResult(new Blob([fileBytes], { type: 'application/pdf' }), file.size,
        'We could not make this PDF smaller. Its photos use a format this page cannot re-encode yet. Here is your original back, unchanged.');
      return;
    }

    const overhead = file.size - scanInfo.imageBytes;
    // Probe: encode the largest photo at full size, quality 50.
    const largest = usable.reduce((a, b) => (a.bytes.length > b.bytes.length ? a : b));
    const probe = await jpegEncode(decoded.get(largest.ref.toString()), { quality: 50 });
    const ratio = probe.byteLength / largest.bytes.length;
    const estAt = (s, q) => overhead + scanInfo.imageBytes * ratio * s * s * Math.pow(q / 50, 0.9);
    let idx = LADDER.findIndex(([s, q]) => estAt(s, q) <= target);
    if (idx < 0) idx = LADDER.length - 1;

    const resizeCache = new Map();
    async function atScale(imgData, s, ow, oh) {
      const key = ow + 'x' + oh + '@' + s;
      if (!resizeCache.has(key)) {
        if (s === 1) resizeCache.set(key, imgData);
        else resizeCache.set(key, await resize(imgData, { width: Math.max(1, Math.round(ow * s)), height: Math.max(1, Math.round(oh * s)) }));
      }
      return resizeCache.get(key);
    }

    async function build(s, q) {
      const doc = await PDFDocument.load(fileBytes, { updateMetadata: false });
      for (const img of usable) {
        const src = decoded.get(img.ref.toString());
        const im = await atScale(src, s, src.width, src.height);
        const jpg = await jpegEncode(im, { quality: q });
        const dict = {
          Type: PDFName.of('XObject'),
          Subtype: PDFName.of('Image'),
          Width: PDFNumber.of(im.width),
          Height: PDFNumber.of(im.height),
          ColorSpace: img.colorSpace || PDFName.of('DeviceRGB'),
          BitsPerComponent: PDFNumber.of(8),
          Filter: PDFName.of('DCTDecode'),
        };
        const stream = doc.context.stream(new Uint8Array(jpg), dict);
        doc.context.assign(img.ref, stream);
      }
      return doc.save();
    }

    // Keep the largest result under the target (best quality that fits) and
    // the smallest result over it (the honest fallback). When a build lands
    // far under the target, jump two rungs up at once: one-rung steps waste
    // builds on the worst-case photos that start deep in the ladder.
    let bestUnder = null, bestOver = null, builds = 0;
    while (builds < 6) {
      const [s, q] = LADDER[idx];
      setStatus(`Building at ${Math.round(s * 100)}% photo size, quality ${q} (try ${builds + 1})…`);
      const out = await build(s, q);
      builds++;
      if (out.length <= target) {
        if (!bestUnder || out.length > bestUnder.bytes.length) bestUnder = { bytes: out, setting: [s, q] };
        if (out.length < target * 0.85 && idx > 0) { idx = Math.max(0, idx - 2); continue; }
        break;
      }
      if (!bestOver || out.length < bestOver.bytes.length) bestOver = { bytes: out, setting: [s, q] };
      if (idx >= LADDER.length - 1) break;
      idx++;
    }
    const best = bestUnder ? bestUnder.bytes : bestOver.bytes;
    const bestSetting = bestUnder ? bestUnder.setting : bestOver.setting;

    if (best.length >= file.size) {
      showResult(new Blob([fileBytes], { type: 'application/pdf' }), file.size,
        'We could not make this PDF smaller than it already is. Here is your original back, unchanged.');
      recordJob({ tool: 'Compress PDF', name: file.name, detail: 'no change possible' });
      return;
    }
    const [bs, bq] = bestSetting;
    const note = best.length <= target
      ? `Landed at ${fmtBytes(best.length)}, under your ${targetLabel(targetKB)} target (was ${fmtBytes(file.size)}). Photos at ${Math.round(bs * 100)}% size, quality ${bq}.${skipped.length ? ' ' + skipped.length + ' photo(s) inside use a format we could not re-encode and were left as they were.' : ''}`
      : `Smallest we could reach is ${fmtBytes(best.length)}, still above your ${targetLabel(targetKB)} target (was ${fmtBytes(file.size)}). We show that plainly rather than pretend. Photos at ${Math.round(bs * 100)}% size, quality ${bq}.`;
    showResult(new Blob([best], { type: 'application/pdf' }), best.length, note);
    if (!lockTarget) savePreset('compress-pdf', { targetKB });
    recordJob({ tool: 'Compress PDF', name: file.name, detail: fmtBytes(file.size) + ' to ' + fmtBytes(best.length) });
  } catch (err) {
    setStatus('Something went wrong with this file: ' + (err && err.message ? err.message : err));
  } finally {
    running = false;
    runBtn.disabled = false;
  }
});

function showResult(blob, bytes, note) {
  const url = URL.createObjectURL(blob);
  const dl = $('cp-download');
  dl.href = url;
  dl.download = file.name.replace(/\.pdf$/i, '') + '-smaller.pdf';
  $('cp-achieved').textContent = note;
  result.classList.remove('hidden');
  const stamp = $('cp-stamp');
  stamp.classList.remove('land');
  void stamp.offsetWidth;
  stamp.classList.add('land');
  setStatus('Done.');
}
