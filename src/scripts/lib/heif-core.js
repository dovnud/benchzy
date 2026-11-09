// HEIC/HEIF decoding for the image stack (milestone 15).
//
// Engine: libheif 1.23.5 with the libde265 HEVC decoder, via the
// libheif-js 1.23.5 WebAssembly build, used UNMODIFIED and served as
// its own files from /heif/ (LGPL-3.0; the credits page carries the
// notice, the licence texts and the source links - see
// ~/workspace/file-toolkit/HEIC-AUDIT.md). The decoder loads only when
// a HEIC file actually arrives; nothing here runs for other formats.
//
// Two facts the audit probes established and this code is built on:
//  1. The pinned decoder applies the CONTAINER's transformation
//     properties (irot/imir) itself during decode: a file carrying
//     them comes out of heif_decode_image already turned (probe-
//     verified with hand-patched fixtures for a quarter turn, a half
//     turn and a mirror). So for those files we must NOT apply them
//     again; we only detect and report them.
//  2. The decoder does NOT apply the EXIF orientation tag (probe: an
//     EXIF-8 fixture decodes in stored orientation). When a file has
//     no container transformation properties, the EXIF orientation is
//     applied here. Never both: files that carry both (iPhone photos)
//     carry them consistently, and the container properties are the
//     ones already applied.
// The container is read through libheif's low-level API because the
// packaged high-level display() sizes its output from the display
// dimensions while walking stored-orientation planes, which scrambles
// EXIF-rotated files.
//
// The pixel remaps below are pure functions (no DOM), unit-tested in
// verify/m15-unit.mjs against fixtures whose stored/tag pairs were
// verified against Pillow's correction table.

const BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevs', 'heif', 'mif1', 'mif2', 'msf1', 'mif3']);

function asciiAt(b, off, len) {
  let s = '';
  for (let i = 0; i < len; i++) s += String.fromCharCode(b[off + i]);
  return s;
}

export function isHeifBytes(b) {
  if (!b || b.length < 12) return false;
  const u8 = b instanceof Uint8Array ? b : new Uint8Array(b);
  if (asciiAt(u8, 4, 4) !== 'ftyp') return false;
  if (BRANDS.has(asciiAt(u8, 8, 4))) return true;
  const n = Math.min(u8.length, 112);
  for (let i = 16; i + 4 <= n; i += 4) {
    if (BRANDS.has(asciiAt(u8, i, 4))) return true;
  }
  return false;
}

export function isHeifFile(file, buf) {
  if (file) {
    if (file.type === 'image/heic' || file.type === 'image/heif') return true;
    if (/\.(heic|heif)$/i.test(file.name || '')) return true;
  }
  return buf ? isHeifBytes(buf) : false;
}

// --- EXIF orientation, parsed from the Exif item bytes libheif returns.
// Layout (probe-verified byte by byte): a big-endian uint32 offset, then
// that many bytes of preamble (usually "Exif\0\0"), then the TIFF
// header. Returns the orientation (1-8) or null on anything unexpected.
export function parseExifOrientation(bytes) {
  try {
    if (!bytes || bytes.length < 8) return null;
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const tiff = 4 + dv.getUint32(0, false);
    if (tiff + 8 > bytes.length) return null;
    const le = bytes[tiff] === 0x49 && bytes[tiff + 1] === 0x49;
    const be = bytes[tiff] === 0x4d && bytes[tiff + 1] === 0x4d;
    if (!le && !be) return null;
    if (dv.getUint16(tiff + 2, le) !== 42) return null;
    const ifd0 = tiff + dv.getUint32(tiff + 4, le);
    if (ifd0 + 2 > bytes.length) return null;
    const count = dv.getUint16(ifd0, le);
    for (let i = 0; i < count; i++) {
      const e = ifd0 + 2 + i * 12;
      if (e + 12 > bytes.length) return null;
      if (dv.getUint16(e, le) === 0x0112) {
        const v = dv.getUint16(e + 8, le);
        return v >= 1 && v <= 8 ? v : null;
      }
    }
    return null;
  } catch (err) {
    return null;
  }
}

// --- Orientation remaps. Each op maps output pixels to input pixels:
// out(x, y) reads in(f(x, y)). Applied in sequence.
function remap(img, outW, outH, f) {
  const { data, width: W } = img;
  const out = new Uint8ClampedArray(outW * outH * 4);
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const [sx, sy] = f(x, y);
      const si = (sy * W + sx) * 4;
      const di = (y * outW + x) * 4;
      out[di] = data[si]; out[di + 1] = data[si + 1]; out[di + 2] = data[si + 2]; out[di + 3] = data[si + 3];
    }
  }
  return { data: out, width: outW, height: outH };
}

export const ORIENTATION_OPS = {
  flipH: (img) => remap(img, img.width, img.height, (x, y) => [img.width - 1 - x, y]),
  flipV: (img) => remap(img, img.width, img.height, (x, y) => [x, img.height - 1 - y]),
  rot180: (img) => remap(img, img.width, img.height, (x, y) => [img.width - 1 - x, img.height - 1 - y]),
  // Visual counter-clockwise quarter turn (Pillow's ROTATE_90).
  rotCcw: (img) => remap(img, img.height, img.width, (x, y) => [img.width - 1 - y, x]),
  // Visual clockwise quarter turn (Pillow's ROTATE_270).
  rotCw: (img) => remap(img, img.height, img.width, (x, y) => [y, img.height - 1 - x]),
  transpose: (img) => remap(img, img.height, img.width, (x, y) => [y, x]),
  transverse: (img) => remap(img, img.height, img.width, (x, y) => [img.width - 1 - y, img.height - 1 - x]),
};

// The correction to apply for each EXIF orientation value (the same
// table Pillow's exif_transpose implements; fixture-verified).
export const EXIF_CORRECTION = {
  1: [], 2: ['flipH'], 3: ['rot180'], 4: ['flipV'],
  5: ['transpose'], 6: ['rotCw'], 7: ['transverse'], 8: ['rotCcw'],
};

export function applyOps(img, ops) {
  let cur = img;
  for (const op of ops) cur = ORIENTATION_OPS[op](cur);
  return cur;
}

// --- The decoder, driven through libheif's low-level API on a loaded
// module object. Kept module-injected so verify/m15-unit.mjs can run
// the identical code in Node against the same pinned build.
export function createHeifDecoder(L) {
  const CS_RGB = L.heif_colorspace_RGB.value;
  const CH_RGBA = L.heif_chroma_interleaved_RGBA.value;
  const CHAN = L.heif_channel_interleaved.value;

  function readExifOrientation(handle, err) {
    const filter = L._malloc(5);
    try {
      L.HEAPU8.set([0x45, 0x78, 0x69, 0x66, 0], filter); // "Exif\0"
      const n = L._heif_image_handle_get_number_of_metadata_blocks(handle, filter);
      if (!n) return null;
      const idsPtr = L._malloc(4 * n);
      try {
        L._heif_image_handle_get_list_of_metadata_block_IDs(handle, filter, idsPtr, n);
        const id = new Uint32Array(L.HEAPU8.buffer, idsPtr, 1)[0];
        const size = L._heif_image_handle_get_metadata_size(handle, id);
        if (!size || size > 16 * 1024 * 1024) return null;
        const mPtr = L._malloc(size);
        try {
          L._heif_image_handle_get_metadata(err, handle, id, mPtr);
          const bytes = new Uint8Array(L.HEAPU8.buffer, mPtr, size).slice();
          return parseExifOrientation(bytes);
        } finally { L._free(mPtr); }
      } finally { L._free(idsPtr); }
    } finally { L._free(filter); }
  }

  function decode(buf) {
    const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    const err = L._malloc(24);
    const code = () => new Int32Array(L.HEAPU8.buffer, err, 1)[0];
    const msg = () => {
      const p = new Uint32Array(L.HEAPU8.buffer, err + 8, 1)[0];
      if (!p) return '';
      let e = p;
      while (L.HEAPU8[e]) e++;
      return new TextDecoder().decode(L.HEAPU8.subarray(p, e));
    };
    let ctx = 0, dataPtr = 0, handle = 0, img = 0;
    try {
      ctx = L._heif_context_alloc();
      dataPtr = L._malloc(bytes.length);
      L.HEAPU8.set(bytes, dataPtr);
      L._heif_context_read_from_memory(err, ctx, dataPtr, bytes.length, 0);
      if (code() !== 0) throw new Error('the file could not be read as a HEIC photo (' + msg() + ')');
      const outPtr = L._malloc(4);
      L._heif_context_get_primary_image_handle(err, ctx, outPtr);
      handle = new Uint32Array(L.HEAPU8.buffer, outPtr, 1)[0];
      L._free(outPtr);
      if (code() !== 0 || !handle) throw new Error('the file holds no still photo this page can read');
      const ispeW = L._heif_image_handle_get_ispe_width(handle);
      const ispeH = L._heif_image_handle_get_ispe_height(handle);
      const itemId = L._heif_image_handle_get_item_id(handle);
      const hadSequence = L._heif_context_has_sequence(ctx) === 1;
      let lumaBits = 8;
      try { lumaBits = L._heif_image_handle_get_luma_bits_per_pixel(handle) || 8; } catch (e) { /* older builds */ }

      // Orientation: if the file carries container transformation
      // properties, the pinned decoder has already applied them in
      // the decode below (fact 1 above); count them for the report
      // and apply nothing. Otherwise the EXIF orientation, if any,
      // is applied by us after the decode (fact 2).
      let orientationSource = null;
      const nProps = L._heif_item_get_transformation_properties(ctx, itemId, 0, 0);
      if (nProps > 0) orientationSource = 'container';
      let exifOps = [];
      if (!nProps) {
        const exif = readExifOrientation(handle, err);
        if (exif && exif !== 1) {
          exifOps = EXIF_CORRECTION[exif] || [];
          if (exifOps.length) orientationSource = 'exif';
        }
      }

      const imgOut = L._malloc(4);
      L._heif_decode_image(err, handle, imgOut, CS_RGB, CH_RGBA, 0);
      img = new Uint32Array(L.HEAPU8.buffer, imgOut, 1)[0];
      L._free(imgOut);
      if (code() !== 0 || !img) throw new Error('the photo inside this file could not be decoded (' + msg() + ')');
      const w = L._heif_image_get_width(img, CHAN);
      const h = L._heif_image_get_height(img, CHAN);
      const stridePtr = L._malloc(4);
      const plane = L._heif_image_get_plane_readonly(img, CHAN, stridePtr);
      const stride = new Int32Array(L.HEAPU8.buffer, stridePtr, 1)[0];
      L._free(stridePtr);
      const data = new Uint8ClampedArray(w * h * 4);
      for (let y = 0; y < h; y++) {
        data.set(L.HEAPU8.subarray(plane + y * stride, plane + y * stride + w * 4), y * w * 4);
      }
      let out = { data, width: w, height: h };
      if (exifOps.length) out = applyOps(out, exifOps);
      return {
        data: out.data, width: out.width, height: out.height,
        storedWidth: ispeW, storedHeight: ispeH, ispeWidth: ispeW, ispeHeight: ispeH,
        orientationApplied: orientationSource, hadSequence, lumaBits,
      };
    } finally {
      if (img) L._heif_image_release(img);
      if (handle) L._heif_image_handle_release(handle);
      if (ctx) L._heif_context_free(ctx);
      if (dataPtr) L._free(dataPtr);
      L._free(err);
    }
  }

  return { decode };
}

// --- Browser loading: the glue script is a classic script that sets a
// window.libheif factory (probe-verified: it reads
// document.currentScript, so the wasm resolves beside it at /heif/).
let decoderPromise = null;

function loadFactory() {
  if (window.libheif) return Promise.resolve(window.libheif);
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = '/heif/libheif.js';
    s.onload = () => (window.libheif ? resolve(window.libheif) : reject(new Error('the HEIC reader did not start')));
    s.onerror = () => reject(new Error('the HEIC reader program could not be loaded'));
    document.head.appendChild(s);
  });
}

export function ensureHeifDecoder() {
  if (!decoderPromise) {
    decoderPromise = (async () => {
      // The wasm bytes are passed to the factory explicitly: loaded
      // through the classic script tag, the glue's own attempt to
      // fetch the wasm falls back to a synchronous fetch that fails
      // (its error says to preload Module.wasmBinary, which is what
      // the package's own Node entry does too). Both library files
      // stay byte-identical and are still served from their own URLs.
      const [factory, wasmBinary] = await Promise.all([
        loadFactory(),
        fetch('/heif/libheif.wasm').then((r) => {
          if (!r.ok) throw new Error('the HEIC reader program could not be loaded');
          return r.arrayBuffer();
        }),
      ]);
      return createHeifDecoder(await factory({ wasmBinary }));
    })();
  }
  return decoderPromise;
}

export async function decodeHeicToImageData(buf) {
  const decoder = await ensureHeifDecoder();
  const r = decoder.decode(buf);
  return { ...r, imageData: new ImageData(r.data, r.width, r.height) };
}
