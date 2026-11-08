// Shared core for the Compress PDF engine, extracted from the measured
// compress-pdf island (milestone 1) so the batch bench, the strong mode
// and the workflow chains run the SAME pipeline: @cantoo/pdf-lib plus
// jSquash mozjpeg recompression of the photos inside the PDF, probe-first
// per build ticket T1 (bench/pdfnums). The island on /compress-pdf/ keeps
// its own copy; the numbers below (ladder, probe, build budget) are the
// bench's and are not to be tuned casually.
import { PDFDocument, PDFName, PDFDict, PDFRawStream, PDFNumber } from '@cantoo/pdf-lib';
import jpegDecode, { init as initJpegDec } from '@jsquash/jpeg/decode.js';
import jpegEncode, { init as initJpegEnc } from '@jsquash/jpeg/encode.js';
import resize, { initResize } from '@jsquash/resize';

let inited = false;

export async function initPdfCodecs() {
  if (inited) return;
  const compile = async (p) => {
    const res = await fetch(p);
    return WebAssembly.compile(await res.arrayBuffer());
  };
  await initJpegDec(await compile('/codecs/mozjpeg_dec.wasm'));
  await initJpegEnc(await compile('/codecs/mozjpeg_enc.wasm'));
  initResize(await (await fetch('/codecs/squoosh_resize_bg.wasm')).arrayBuffer());
  inited = true;
}

// Walk every page's image XObjects; keep the unique JPEG (DCTDecode) streams.
export async function scanPdf(bytes) {
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

// Ladder of (scale, quality), biggest output first. The bench's own.
const LADDER = [
  [1, 80], [1, 65], [1, 50], [1, 38],
  [0.75, 50], [0.75, 38],
  [0.5, 50], [0.5, 38],
  [0.35, 38], [0.25, 38], [0.18, 30], [0.12, 24], [0.12, 16],
];

// A decode that comes back flat (every sampled pixel the same) is a
// failed decode wearing a success's clothes: re-encoding it would hand
// the visitor a blank photo and call it compression. Sampled variance
// check, cheap and deterministic.
function looksBlank(imgData) {
  const d = imgData.data;
  if (!d || d.length < 16) return true;
  let n = 0, mean = 0, m2 = 0;
  const step = Math.max(4, Math.floor(d.length / 16000 / 4) * 4);
  for (let i = 0; i < d.length; i += step) {
    const v = d[i];
    n++;
    const delta = v - mean;
    mean += delta / n;
    m2 += delta * (v - mean);
  }
  return n > 0 && (m2 / n) < 1;
}

async function prepare(bytes) {
  const scanInfo = await scanPdf(bytes);
  const decoded = new Map();
  const skipped = [];
  for (const img of scanInfo.images) {
    try {
      const ab = img.bytes.buffer.slice(img.bytes.byteOffset, img.bytes.byteOffset + img.bytes.byteLength);
      let imgData = await jpegDecode(ab);
      if (looksBlank(imgData)) imgData = await jpegDecode(ab); // one retry
      if (looksBlank(imgData)) { skipped.push(img); continue; }
      decoded.set(img.ref.toString(), imgData);
    } catch (e) { skipped.push(img); }
  }
  const usable = scanInfo.images.filter((i) => decoded.has(i.ref.toString()));
  return { scanInfo, decoded, skipped, usable };
}

function makeBuilder(bytes, prep) {
  const { decoded, usable } = prep;
  const resizeCache = new Map();
  async function atScale(imgData, s, ow, oh) {
    const key = ow + 'x' + oh + '@' + s;
    if (!resizeCache.has(key)) {
      if (s === 1) resizeCache.set(key, imgData);
      else resizeCache.set(key, await resize(imgData, { width: Math.max(1, Math.round(ow * s)), height: Math.max(1, Math.round(oh * s)) }));
    }
    return resizeCache.get(key);
  }
  return async function build(s, q) {
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
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
  };
}

// Compress toward a target byte count. Returns one of:
// { changed:true, out, setting:[s,q], skipped } or
// { changed:false, reason:'already-under'|'no-photos'|'unreadable-photos'|'no-smaller', skipped }
export async function compressPdfToTarget(bytes, targetBytes, onProgress) {
  const say = onProgress || (() => {});
  if (bytes.length <= targetBytes) return { changed: false, reason: 'already-under', skipped: [] };
  await initPdfCodecs();
  const prep = await prepare(bytes);
  const { scanInfo, decoded, skipped, usable } = prep;
  if (scanInfo.images.length === 0) return { changed: false, reason: 'no-photos', skipped };
  if (usable.length === 0) return { changed: false, reason: 'unreadable-photos', skipped };

  const overhead = bytes.length - scanInfo.imageBytes;
  const largest = usable.reduce((a, b) => (a.bytes.length > b.bytes.length ? a : b));
  const probe = await jpegEncode(decoded.get(largest.ref.toString()), { quality: 50 });
  const ratio = probe.byteLength / largest.bytes.length;
  const estAt = (s, q) => overhead + scanInfo.imageBytes * ratio * s * s * Math.pow(q / 50, 0.9);
  let idx = LADDER.findIndex(([s, q]) => estAt(s, q) <= targetBytes);
  if (idx < 0) idx = LADDER.length - 1;

  const build = makeBuilder(bytes, prep);
  let bestUnder = null, bestOver = null, builds = 0;
  while (builds < 6) {
    const [s, q] = LADDER[idx];
    say(s, q, builds + 1);
    const out = await build(s, q);
    builds++;
    if (out.length <= targetBytes) {
      if (!bestUnder || out.length > bestUnder.bytes.length) bestUnder = { bytes: out, setting: [s, q] };
      if (out.length < targetBytes * 0.85 && idx > 0) { idx = Math.max(0, idx - 2); continue; }
      break;
    }
    if (!bestOver || out.length < bestOver.bytes.length) bestOver = { bytes: out, setting: [s, q] };
    if (idx >= LADDER.length - 1) break;
    idx++;
  }
  const best = bestUnder ? bestUnder.bytes : bestOver.bytes;
  const bestSetting = bestUnder ? bestUnder.setting : bestOver.setting;
  if (best.length >= bytes.length) return { changed: false, reason: 'no-smaller', skipped };
  return { changed: true, out: best, setting: bestSetting, underTarget: !!bestUnder, skipped };
}

// Strong mode: the aggressive end of the same ladder, no target. Builds
// walk down the deep rungs and keep the smallest result; the walk stops
// when a rung stops buying real shrinkage (under 1%), so a file is never
// ground down past the point of sense. Same honest exits as target mode.
const STRONG_RUNGS = [[0.75, 50], [0.5, 38], [0.35, 30], [0.25, 24], [0.18, 20], [0.12, 16]];

export async function compressPdfStrong(bytes, onProgress) {
  const say = onProgress || (() => {});
  await initPdfCodecs();
  const prep = await prepare(bytes);
  const { scanInfo, skipped, usable } = prep;
  if (scanInfo.images.length === 0) return { changed: false, reason: 'no-photos', skipped };
  if (usable.length === 0) return { changed: false, reason: 'unreadable-photos', skipped };
  const build = makeBuilder(bytes, prep);
  let best = null;
  for (const [s, q] of STRONG_RUNGS) {
    say(s, q);
    const out = await build(s, q);
    if (!best || out.length < best.bytes.length) {
      const gain = best ? 1 - out.length / best.bytes.length : 1;
      best = { bytes: out, setting: [s, q] };
      if (gain < 0.01) break;
    } else break;
  }
  if (!best || best.bytes.length >= bytes.length) return { changed: false, reason: 'no-smaller', skipped };
  return { changed: true, out: best.bytes, setting: best.setting, skipped };
}
