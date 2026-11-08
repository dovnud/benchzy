// Shared core for the image engines, extracted from the measured
// compress-image island (milestone 1) so the batch bench and the workflow
// chains run the SAME code: jSquash codecs (mozjpeg, libwebp, oxipng) plus
// jSquash resize, and the bench's COMBINED quality-and-size search
// (bench/imgnums/combined.mjs). The settings sequence is the bench's; on
// the corpus photo it reproduces the bench byte for byte. AVIF encoding
// is not here on purpose: the bench measured 49.7 s a photo.
import jpegDecode, { init as initJpegDec } from '@jsquash/jpeg/decode.js';
import jpegEncode, { init as initJpegEnc } from '@jsquash/jpeg/encode.js';
import pngDecode, { init as initPngDec } from '@jsquash/png/decode.js';
import pngEncode, { init as initPngEnc } from '@jsquash/png/encode.js';
import webpDecode, { init as initWebpDec } from '@jsquash/webp/decode.js';
import webpEncode, { init as initWebpEnc } from '@jsquash/webp/encode.js';
import resize, { initResize } from '@jsquash/resize';

let inited = false;

export async function initImageCodecs() {
  if (inited) return;
  const compile = async (p) => {
    const res = await fetch(p);
    return WebAssembly.compile(await res.arrayBuffer());
  };
  await initJpegDec(await compile('/codecs/mozjpeg_dec.wasm'));
  await initJpegEnc(await compile('/codecs/mozjpeg_enc.wasm'));
  await initWebpDec(await compile('/codecs/webp_dec.wasm'));
  await initWebpEnc(await compile('/codecs/webp_enc.wasm'));
  await initPngDec('/codecs/squoosh_png_bg.wasm');
  await initPngEnc('/codecs/squoosh_png_bg.wasm');
  initResize(await (await fetch('/codecs/squoosh_resize_bg.wasm')).arrayBuffer());
  inited = true;
}

export async function decodeImageFile(f, buf) {
  if (f.type === 'image/jpeg') return jpegDecode(buf);
  if (f.type === 'image/png') return pngDecode(buf);
  if (f.type === 'image/webp') return webpDecode(buf);
  // Anything the browser itself can read (GIF, BMP, AVIF in some browsers):
  const bmp = await createImageBitmap(f);
  const c = document.createElement('canvas');
  c.width = bmp.width; c.height = bmp.height;
  const ctx = c.getContext('2d');
  ctx.drawImage(bmp, 0, 0);
  return ctx.getImageData(0, 0, c.width, c.height);
}

export async function resizeImageData(img, width, height) {
  return resize(img, { width, height });
}

const ENCODERS = {
  jpeg: { ext: 'jpg', mime: 'image/jpeg', run: (im, q) => jpegEncode(im, { quality: q }) },
  webp: { ext: 'webp', mime: 'image/webp', run: (im, q) => webpEncode(im, { quality: q }) },
  png: { ext: 'png', mime: 'image/png', run: (im) => pngEncode(im) },
};
export const FORMAT_INFO = ENCODERS;

// Encode a decoded image in one format at one quality (PNG is lossless
// and ignores quality). Optionally scale to a max width first.
export async function encodeImage(img, format, quality, maxWidth) {
  let im = img;
  if (maxWidth && img.width > maxWidth) {
    const h = Math.max(1, Math.round(img.height * (maxWidth / img.width)));
    im = await resize(img, { width: maxWidth, height: h });
  }
  const enc = ENCODERS[format] || ENCODERS.jpeg;
  const buf = await enc.run(im, quality);
  return { buf, bytes: buf.byteLength, width: im.width, height: im.height, ext: enc.ext, mime: enc.mime };
}

// The bench's combined search, verbatim logic: quality binary search
// first; if nothing lands within tolerance, a low anchor quality is fixed
// and dimensions are binary-searched too. Attempts are kept, not
// re-encoded. Output is always JPEG, as on the measured island.
export async function compressImageToTarget(img, targetBytes, onProgress) {
  const say = onProgress || (() => {});
  const resizeCache = new Map([[1, img]]);
  async function atScale(s) {
    if (!resizeCache.has(s)) {
      const w = Math.max(1, Math.round(img.width * s));
      const h = Math.max(1, Math.round(img.height * s));
      resizeCache.set(s, await resize(img, { width: w, height: h }));
    }
    return resizeCache.get(s);
  }
  const tried = [];
  let attempts = 0;
  async function attempt(s, q) {
    attempts++;
    const im = await atScale(s);
    const out = await jpegEncode(im, { quality: q });
    const rec = { bytes: out.byteLength, buf: out, q, s, w: im.width, h: im.height };
    tried.push(rec);
    say(rec, attempts);
    return rec;
  }
  const bestUnder = () => tried.filter((r) => r.bytes <= targetBytes).sort((a, b) => b.bytes - a.bytes)[0];
  const closest = () => [...tried].sort((a, b) => Math.abs(a.bytes - targetBytes) - Math.abs(b.bytes - targetBytes))[0];
  const closeEnough = (r) => r && Math.abs(r.bytes - targetBytes) / targetBytes <= 0.01;

  const r50 = await attempt(1, 50);
  if (r50.bytes > targetBytes) {
    let lo = 2, hi = 50;
    for (let i = 0; i < 5; i++) {
      const q = Math.round((lo + hi) / 2);
      const r = await attempt(1, q);
      if (r.bytes <= targetBytes) lo = q; else hi = q;
      if (closeEnough(bestUnder())) break;
    }
  } else {
    let lo = 50, hi = 98;
    for (let i = 0; i < 5; i++) {
      const q = Math.round((lo + hi) / 2);
      const r = await attempt(1, q);
      if (r.bytes <= targetBytes) lo = q; else hi = q;
      if (closeEnough(bestUnder())) break;
    }
  }
  let best = bestUnder() || closest();
  if (!best || best.bytes > targetBytes * 1.005) {
    const qAnchor = Math.max(4, Math.min(...tried.map((r) => r.q)));
    let lo = 0.15, hi = 1.0;
    for (let i = 0; i < 6; i++) {
      const s = (lo + hi) / 2;
      const r = await attempt(s, qAnchor);
      if (r.bytes <= targetBytes) lo = s; else hi = s;
      if (closeEnough(bestUnder())) break;
    }
    best = bestUnder() || closest();
  }
  return { ...best, attempts };
}
