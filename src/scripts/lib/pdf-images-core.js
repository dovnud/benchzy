// Extract the pictures stored inside a PDF (milestone 12). The walk
// and the scope were benched before the page copy was written
// (verify/m12-bench.mjs; numbers in BUILD-STATUS milestone 12):
//
// - A JPEG stored in the file (DCTDecode) comes out as the original
//   JPEG bytes, untouched: the stream contents are the JPEG itself.
// - Every other decodable stored picture is rebuilt from its stored
//   samples and written as a PNG through the shipped image stack.
//   Colour spaces handled: DeviceGray, DeviceRGB, DeviceCMYK,
//   CalGray, CalRGB, ICC-based (by component count) and Indexed on
//   any of those bases. Bit depths 1, 2, 4, 8 and 16. Flate data with
//   a PNG or TIFF predictor is un-predicted here (pdf-lib's flate
//   reader inflates but does not un-predict). A stored soft mask
//   (SMask, or a mask image) is applied as the PNG's transparency;
//   a colour-key mask is applied the same way.
// - Kinds that cannot be pulled are REPORTED, never silently
//   dropped: JPEG 2000 (JPXDecode), fax encodings (CCITTFaxDecode),
//   JBIG2, special-ink colours (Separation / DeviceN), stencil
//   masks (an image whose job is to mask another picture), and
//   anything whose filter chain this program does not know.
// - Pictures drawn as vector shapes, and pictures painted inline in
//   a page's drawing instructions, are not stored pictures; the walk
//   finds only stored image objects (page resources, including the
//   ones nested inside placed form groups).
//
// The core is DOM-free: the PNG writer is injected by the caller
// (the island passes the shipped jSquash encoder; the bench passes
// its own), as encodePng({ data, width, height }) -> bytes, where
// data is a Uint8ClampedArray of RGBA samples.
import {
  PDFName, PDFDict, PDFArray, PDFRawStream, PDFNumber, PDFString, PDFHexString,
  decodePDFRawStream,
} from '@cantoo/pdf-lib';

const nameOf = (obj) => (obj && typeof obj.toString === 'function' ? obj.toString() : '');

function num(dict, key, fallback) {
  const v = dict.lookup(PDFName.of(key));
  return v instanceof PDFNumber ? v.asNumber() : fallback;
}

function filtersOf(dict) {
  const f = dict.lookup(PDFName.of('Filter'));
  if (!f) return [];
  if (f instanceof PDFArray) {
    const out = [];
    for (let i = 0; i < f.size(); i++) out.push(nameOf(f.lookup(i)).replace(/^\//, ''));
    return out;
  }
  return [nameOf(f).replace(/^\//, '')];
}

// --- the three wrap filters that can sit OUTSIDE a stored JPEG ----
// decodePDFRawStream refuses any chain containing DCTDecode, so the
// plain wrap layers are peeled here by hand before the JPEG bytes
// are read. Each returns the unwrapped bytes.
function peelAscii85(bytes) {
  const out = [];
  let group = [];
  const flush = (g, count) => {
    let v = 0;
    for (let i = 0; i < 5; i++) v = v * 85 + (i < g.length ? g[i] : 84);
    const b = [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
    for (let i = 0; i < count; i++) out.push(b[i]);
  };
  for (let i = 0; i < bytes.length; i++) {
    const c = bytes[i];
    if (c === 0x7e) break; // '~' starts the end marker
    if (c === 0x7a && group.length === 0) { out.push(0, 0, 0, 0); continue; } // 'z'
    if (c < 0x21 || c > 0x75) continue; // whitespace and strays
    group.push(c - 0x21);
    if (group.length === 5) { flush(group, 4); group = []; }
  }
  if (group.length > 1) flush(group, group.length - 1);
  return new Uint8Array(out);
}
function peelAsciiHex(bytes) {
  const out = [];
  let hi = -1;
  for (let i = 0; i < bytes.length; i++) {
    const c = bytes[i];
    if (c === 0x3e) break; // '>'
    const d = c >= 0x30 && c <= 0x39 ? c - 0x30 : c >= 0x41 && c <= 0x46 ? c - 0x37 : c >= 0x61 && c <= 0x66 ? c - 0x57 : -1;
    if (d < 0) continue;
    if (hi < 0) hi = d; else { out.push((hi << 4) | d); hi = -1; }
  }
  if (hi >= 0) out.push(hi << 4);
  return new Uint8Array(out);
}
function peelRunLength(bytes) {
  const out = [];
  for (let i = 0; i < bytes.length;) {
    const len = bytes[i++];
    if (len === 128) break;
    if (len < 128) { const n = len + 1; for (let k = 0; k < n && i < bytes.length; k++) out.push(bytes[i++]); }
    else { const v = bytes[i++]; const n = 257 - len; for (let k = 0; k < n; k++) out.push(v); }
  }
  return new Uint8Array(out);
}
const PEELERS = { ASCII85Decode: peelAscii85, ASCIIHexDecode: peelAsciiHex, RunLengthDecode: peelRunLength };

// --- predictor removal (DecodeParms on a flate/LZW stream) --------
function decodeParmsOf(dict) {
  let dp = dict.lookup(PDFName.of('DecodeParms')) || dict.lookup(PDFName.of('DP'));
  if (dp instanceof PDFArray) dp = dp.lookup(0);
  return dp instanceof PDFDict ? dp : null;
}
function unpredict(data, parms, rowBytes, height, bpp) {
  const predictor = parms ? num(parms, 'Predictor', 1) : 1;
  if (predictor === 1) return data;
  if (predictor === 2) return data; // handled by the caller (needs comps)
  if (predictor >= 10) {
    const stride = rowBytes + 1;
    const out = new Uint8Array(rowBytes * height);
    let prev = new Uint8Array(rowBytes);
    for (let y = 0; y < height; y++) {
      const rowStart = y * stride;
      const filter = data[rowStart];
      const row = out.subarray(y * rowBytes, (y + 1) * rowBytes);
      for (let i = 0; i < rowBytes; i++) {
        const raw = data[rowStart + 1 + i] || 0;
        const left = i >= bpp ? row[i - bpp] : 0;
        const up = prev[i] || 0;
        const upLeft = i >= bpp ? (prev[i - bpp] || 0) : 0;
        let v;
        switch (filter) {
          case 0: v = raw; break;
          case 1: v = raw + left; break;
          case 2: v = raw + up; break;
          case 3: v = raw + Math.floor((left + up) / 2); break;
          case 4: {
            const p = left + up - upLeft;
            const pa = Math.abs(p - left), pb = Math.abs(p - up), pc = Math.abs(p - upLeft);
            v = raw + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft);
            break;
          }
          default: v = raw;
        }
        row[i] = v & 255;
      }
      prev = row;
    }
    return out;
  }
  return data;
}

// --- sample unpacking: stored samples -> one byte per component ---
// With rawValues set (palette indices), values come out unscaled:
// an index is a number, not a shade.
function unpackSamples(data, width, height, comps, bpc, rawValues = false) {
  const pixels = width * height;
  if (bpc === 8) return data;
  const out = new Uint8Array(pixels * comps);
  if (bpc === 16) {
    for (let i = 0; i < pixels * comps; i++) out[i] = data[i * 2] || 0;
    return out;
  }
  // 1, 2 or 4 bits per component, rows padded to whole bytes.
  const rowBits = width * comps * bpc;
  const rowBytes = Math.ceil(rowBits / 8);
  const max = (1 << bpc) - 1;
  let srcRow = 0;
  let dst = 0;
  for (let y = 0; y < height; y++) {
    let bitPos = 0;
    for (let s = 0; s < width * comps; s++) {
      const byteIdx = srcRow + (bitPos >> 3);
      const shift = 8 - bpc - (bitPos & 7);
      const v = ((data[byteIdx] || 0) >> shift) & max;
      out[dst++] = rawValues ? v : Math.round((v * 255) / max);
      bitPos += bpc;
    }
    srcRow += rowBytes;
  }
  return out;
}

// --- colour spaces -------------------------------------------------
// Returns { comps } for a space this core can turn into RGB, or
// { skip: 'reason' }. Indexed returns { indexed: {base, hi, lookup} }.
function resolveColorSpace(doc, csObj, depth = 0) {
  if (!csObj) return { skip: 'it names no colour space' };
  if (!(csObj instanceof PDFArray)) {
    const n = nameOf(csObj);
    if (n === '/DeviceGray' || n === '/CalGray') return { comps: 1, kind: 'gray' };
    if (n === '/DeviceRGB' || n === '/CalRGB') return { comps: 3, kind: 'rgb' };
    if (n === '/DeviceCMYK') return { comps: 4, kind: 'cmyk' };
    if (n === '/Pattern') return { skip: 'it is a pattern fill, not a picture' };
    return { skip: 'its colour space (' + (n || 'unnamed') + ') is not one this program can rebuild' };
  }
  const head = nameOf(csObj.lookup(0));
  if (head === '/ICCBased') {
    const stream = csObj.lookup(1);
    const n = stream && stream.dict ? num(stream.dict, 'N', 0) : 0;
    if (n === 1) return { comps: 1, kind: 'gray' };
    if (n === 3) return { comps: 3, kind: 'rgb' };
    if (n === 4) return { comps: 4, kind: 'cmyk' };
    return { skip: 'its ICC colour profile names ' + n + ' inks, which this program cannot rebuild' };
  }
  if (head === '/Indexed' || head === '/I') {
    if (depth > 0) return { skip: 'its palette points at another palette' };
    const base = resolveColorSpace(doc, csObj.lookup(1), depth + 1);
    if (base.skip || base.indexed) return { skip: 'its palette base is not a plain colour space' };
    const hi = csObj.lookup(2);
    const hiN = hi instanceof PDFNumber ? hi.asNumber() : 255;
    const look = csObj.lookup(3);
    let table = null;
    if (look instanceof PDFRawStream) table = look.getContents();
    else if (look instanceof PDFHexString) table = look.asBytes();
    else if (look instanceof PDFString) table = look.asBytes();
    if (!table) return { skip: 'its colour palette could not be read' };
    return { indexed: { base, hi: hiN, table } };
  }
  if (head === '/Separation' || head === '/DeviceN') {
    return { skip: 'it is printed in a special ink colour, which this program cannot rebuild faithfully' };
  }
  if (head === '/CalRGB') return { comps: 3, kind: 'rgb' };
  if (head === '/CalGray') return { comps: 1, kind: 'gray' };
  if (head === '/Lab') return { skip: 'it uses Lab colour, which this program does not convert' };
  return { skip: 'its colour space (' + head + ') is not one this program can rebuild' };
}

function samplesToRgba(samples, width, height, space) {
  const pixels = width * height;
  const out = new Uint8ClampedArray(pixels * 4);
  if (space.indexed) {
    const { base, table } = space.indexed;
    for (let p = 0; p < pixels; p++) {
      const idx = samples[p] * base.comps;
      writePixel(out, p, table, idx, base.kind);
    }
    return out;
  }
  for (let p = 0; p < pixels; p++) writePixel(out, p, samples, p * space.comps, space.kind);
  return out;
}
function writePixel(out, p, src, i, kind) {
  const o = p * 4;
  if (kind === 'gray') {
    out[o] = out[o + 1] = out[o + 2] = src[i] || 0;
  } else if (kind === 'rgb') {
    out[o] = src[i] || 0; out[o + 1] = src[i + 1] || 0; out[o + 2] = src[i + 2] || 0;
  } else { // cmyk, the plain press conversion every reader falls back to
    const c = (src[i] || 0) / 255, m = (src[i + 1] || 0) / 255, y = (src[i + 2] || 0) / 255, k = (src[i + 3] || 0) / 255;
    out[o] = Math.round(255 * (1 - Math.min(1, c + k)));
    out[o + 1] = Math.round(255 * (1 - Math.min(1, m + k)));
    out[o + 2] = Math.round(255 * (1 - Math.min(1, y + k)));
  }
  out[o + 3] = 255;
}

// Decode one image stream's stored samples (no colour conversion).
// Returns { samples (one byte per component), space } or { skip }.
function decodeSamples(doc, stream) {
  const dict = stream.dict;
  const width = num(dict, 'Width', 0), height = num(dict, 'Height', 0);
  if (!width || !height) return { skip: 'its size could not be read' };
  const bpc = num(dict, 'BitsPerComponent', 1);
  const space = resolveColorSpace(doc, dict.lookup(PDFName.of('ColorSpace')));
  if (space.skip) return { skip: space.skip };
  const comps = space.indexed ? 1 : space.comps;
  let decoded;
  try {
    decoded = decodePDFRawStream(stream).decode();
  } catch (e) {
    return { skip: 'its data could not be unpacked (' + (e && e.message ? e.message : e) + ')' };
  }
  const parms = decodeParmsOf(dict);
  const predictor = parms ? num(parms, 'Predictor', 1) : 1;
  let data = decoded;
  if (predictor >= 10 && bpc === 8) {
    const rowBytes = Math.ceil((width * comps * bpc) / 8);
    const bpp = Math.max(1, Math.ceil((comps * bpc) / 8));
    data = unpredict(decoded, parms, rowBytes, height, bpp);
  } else if (predictor === 2 && bpc === 8) {
    // TIFF predictor: every sample after the first in a row is the
    // difference from the sample one pixel to its left.
    const rowSamples = width * comps;
    const out = new Uint8Array(data.length);
    out.set(data);
    for (let y = 0; y < height; y++) {
      const row = y * rowSamples;
      for (let s = comps; s < rowSamples; s++) {
        out[row + s] = (out[row + s] + out[row + s - comps]) & 255;
      }
    }
    data = out;
  } else if (predictor !== 1) {
    return { skip: 'its data uses a predictor this program does not undo' };
  }
  const samples = unpackSamples(data, width, height, comps, bpc, !!space.indexed);
  return { samples, space, width, height, bpc };
}

// The transparency a stored picture carries: an SMask (or a mask
// image) decoded to one alpha byte per pixel, or a colour-key range.
function readMask(doc, stream) {
  const dict = stream.dict;
  const smask = dict.lookup(PDFName.of('SMask'));
  const maskRef = smask || dict.lookup(PDFName.of('Mask'));
  if (maskRef instanceof PDFRawStream) {
    const m = decodeSamples(doc, maskRef);
    if (m.skip || !m.samples) return { note: 'its separate transparency layer could not be rebuilt, so the picture comes out opaque' };
    const gray = m.space.indexed ? null : m.samples;
    if (!gray) return { note: 'its separate transparency layer could not be rebuilt, so the picture comes out opaque' };
    // A mask with more than one component per pixel: use its first.
    const comps = m.space.comps || 1;
    const alpha = new Uint8Array(m.width * m.height);
    for (let p = 0; p < alpha.length; p++) alpha[p] = gray[p * comps] || 0;
    return { alpha, width: m.width, height: m.height };
  }
  const maskArr = dict.lookup(PDFName.of('Mask'));
  if (maskArr instanceof PDFArray) {
    const ranges = [];
    for (let i = 0; i + 1 < maskArr.size(); i += 2) {
      const lo = maskArr.lookup(i), hi = maskArr.lookup(i + 1);
      if (lo instanceof PDFNumber && hi instanceof PDFNumber) ranges.push([lo.asNumber(), hi.asNumber()]);
    }
    if (ranges.length) return { colorKey: ranges };
  }
  return null;
}

function applyColorKey(rgba, samples, comps, ranges) {
  const pixels = rgba.length / 4;
  for (let p = 0; p < pixels; p++) {
    let keyed = ranges.length > 0;
    for (let c = 0; c < ranges.length; c++) {
      const v = samples[p * comps + c];
      if (v === undefined || v < ranges[c][0] || v > ranges[c][1]) { keyed = false; break; }
    }
    if (keyed) rgba[p * 4 + 3] = 0;
  }
}

// --- the walk -------------------------------------------------------
// Find every stored image object reachable from the pages, including
// images nested inside placed form groups. Deduped by object, with
// every page each picture is used on.
export function walkPdfImages(doc) {
  const found = new Map(); // ref string -> { stream, pages: Set }
  const visitedForms = new Set();
  const pages = doc.getPages();
  pages.forEach((page, pi) => {
    let resources = null;
    try { resources = page.node.Resources(); } catch (e) { resources = null; }
    if (resources) walkResources(doc, resources, pi + 1, found, visitedForms);
  });
  return [...found.values()].map((e) => ({ stream: e.stream, pages: [...e.pages].sort((a, b) => a - b) }));
}
function walkResources(doc, resources, pageNo, found, visitedForms) {
  let xo = null;
  try { xo = resources.lookup(PDFName.of('XObject'), PDFDict); } catch (e) { xo = null; }
  if (!xo) return;
  for (const [key, ref] of xo.entries()) {
    let obj = null;
    try { obj = doc.context.lookup(ref); } catch (e) { obj = null; }
    if (!(obj instanceof PDFRawStream)) continue;
    const subtype = nameOf(obj.dict.lookup(PDFName.of('Subtype')));
    if (subtype === '/Image') {
      const id = ref.toString();
      if (!found.has(id)) found.set(id, { stream: obj, pages: new Set() });
      found.get(id).pages.add(pageNo);
    } else if (subtype === '/Form') {
      const id = ref.toString();
      if (visitedForms.has(id)) continue;
      visitedForms.add(id);
      let sub = null;
      try { sub = obj.dict.lookup(PDFName.of('Resources'), PDFDict); } catch (e) { sub = null; }
      if (sub) walkResources(doc, sub, pageNo, found, visitedForms);
    }
  }
}

// Count only (the pre-run spec): stored pictures and where they sit.
export function scanPdfImages(doc) {
  const entries = walkPdfImages(doc);
  const perPage = new Map();
  for (const e of entries) for (const p of e.pages) perPage.set(p, (perPage.get(p) || 0) + 1);
  return { total: entries.length, perPage };
}

// Extract. Returns {
//   files: [{ name, data, ext, page, width, height, origin, note }],
//   entries: [{ pages, outcome: 'pulled'|'skipped', what, why, fileIndex }],
//   pulledCount, skippedCount
// }
export async function extractPdfImages(doc, { encodePng }) {
  const entries = walkPdfImages(doc);
  const files = [];
  const report = [];
  for (const entry of entries) {
    const { stream, pages } = entry;
    const dict = stream.dict;
    const width = num(dict, 'Width', 0), height = num(dict, 'Height', 0);
    const filters = filtersOf(dict);
    const head = (width || '?') + ' x ' + (height || '?');
    const skip = (why) => report.push({ pages, outcome: 'skipped', what: head, why });

    if (nameOf(dict.lookup(PDFName.of('ImageMask'))) === 'true') {
      skip('it is a stencil mask, a shape used to mask another picture, not a picture on its own');
      continue;
    }
    // The stored-JPEG path: the stream contents ARE the JPEG.
    const lastFilter = filters[filters.length - 1];
    if (lastFilter === 'DCTDecode') {
      const wraps = filters.slice(0, -1);
      if (!wraps.every((f) => PEELERS[f])) { skip('its data is wrapped in a layer this program does not peel (' + wraps.join(', ') + ')'); continue; }
      try {
        let bytes = stream.getContents();
        for (let i = wraps.length - 1; i >= 0; i--) bytes = PEELERS[wraps[i]](bytes);
        if (!(bytes[0] === 0xff && bytes[1] === 0xd8)) { skip('its stored data did not read back as a JPEG'); continue; }
        const name = 'page-' + pages[0] + '-image-' + (files.length + 1) + '.jpg';
        files.push({ name, data: bytes, ext: 'jpg', page: pages[0], width, height, origin: 'stored JPEG, byte for byte' });
        report.push({ pages, outcome: 'pulled', what: head, why: 'the stored JPEG, byte for byte', fileIndex: files.length - 1 });
      } catch (e) {
        skip('its stored JPEG could not be read (' + (e && e.message ? e.message : e) + ')');
      }
      continue;
    }
    if (filters.includes('JPXDecode')) { skip('it is a JPEG 2000 picture, and no opener for that kind runs in this page'); continue; }
    if (filters.includes('CCITTFaxDecode')) { skip('it is a fax-encoded picture (CCITT), a scan encoding this program does not unpack'); continue; }
    if (filters.includes('JBIG2Decode')) { skip('it is a JBIG2 picture, an encoding this program does not unpack'); continue; }
    const known = filters.every((f) => ['FlateDecode', 'LZWDecode', 'ASCII85Decode', 'ASCIIHexDecode', 'RunLengthDecode'].includes(f));
    if (!known) { skip('its data is packed with a filter this program does not open (' + (filters.join(', ') || 'unnamed') + ')'); continue; }

    const dec = decodeSamples(doc, stream);
    if (dec.skip) { skip(dec.skip); continue; }
    const rgba = samplesToRgba(dec.samples, dec.width, dec.height, dec.space);
    let note = 'rebuilt from the stored picture data as a PNG';
    const mask = readMask(doc, stream);
    if (mask && mask.alpha) {
      if (mask.width === dec.width && mask.height === dec.height) {
        for (let p = 0; p < mask.alpha.length; p++) rgba[p * 4 + 3] = mask.alpha[p];
        note = 'rebuilt as a PNG, with its stored transparency put back';
      } else if (mask.note) note += '; ' + mask.note;
    } else if (mask && mask.colorKey) {
      // Colour-key ranges are written in the file's own sample
      // units; they only line up with the rebuilt samples at 8 bits
      // per component, so finer-grained pictures keep their key
      // unapplied and the result says so.
      if (dec.bpc === 8) {
        applyColorKey(rgba, dec.samples, dec.space.indexed ? 1 : dec.space.comps, mask.colorKey);
        note += ', with its keyed colour made transparent';
      } else {
        note += '; its colour-key mask was not applied (it is written for finer colour steps than this rebuild keeps)';
      }
    } else if (mask && mask.note) {
      note += '; ' + mask.note;
    }
    try {
      const png = await encodePng({ data: rgba, width: dec.width, height: dec.height });
      const name = 'page-' + pages[0] + '-image-' + (files.length + 1) + '.png';
      files.push({ name, data: new Uint8Array(png), ext: 'png', page: pages[0], width: dec.width, height: dec.height, origin: note });
      report.push({ pages, outcome: 'pulled', what: head, why: note, fileIndex: files.length - 1 });
    } catch (e) {
      skip('the PNG writer failed on it (' + (e && e.message ? e.message : e) + ')');
    }
  }
  return {
    files,
    report,
    pulledCount: files.length,
    skippedCount: report.filter((r) => r.outcome === 'skipped').length,
    storedCount: entries.length,
  };
}
