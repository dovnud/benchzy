// Milestone 12 bench: run the SHIPPED extraction core
// (src/scripts/lib/pdf-images-core.js) over the known fixtures and
// check every pulled picture against the truth, byte for byte or
// pixel for pixel. The page copy's scope lines were written from
// what passes here. Run: node verify/m12-make-fixtures.mjs first,
// then node verify/m12-bench.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument } from '@cantoo/pdf-lib';
import sharp from 'sharp';
import { extractPdfImages, scanPdfImages } from '../src/scripts/lib/pdf-images-core.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(HERE, 'fixtures', 'm12');
const M11 = path.join(HERE, 'fixtures', 'm11');
const failures = [];
const ok = (cond, label, extra = '') => {
  console.log((cond ? 'PASS' : 'FAIL') + ' ' + label + (extra ? ' — ' + extra : ''));
  if (!cond) failures.push(label);
};

async function encodePng({ data, width, height }) {
  return sharp(Buffer.from(data.buffer, data.byteOffset, data.byteLength), { raw: { width, height, channels: 4 } }).png().toBuffer();
}
async function rawPixels(buf) {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

// --- images.pdf -----------------------------------------------------
{
  const bytes = fs.readFileSync(path.join(FIX, 'images.pdf'));
  const doc = await PDFDocument.load(bytes);
  const scan = scanPdfImages(doc);
  ok(scan.total === 3, 'images.pdf stores 3 unique pictures', 'scan total ' + scan.total);
  const t0 = Date.now();
  const res = await extractPdfImages(doc, { encodePng });
  console.log('  extract took ' + (Date.now() - t0) + ' ms; report:');
  for (const r of res.report) console.log('   ', r.outcome, '|', r.what, '|', r.why);
  ok(res.pulledCount === 3 && res.skippedCount === 0, 'images.pdf pulls 3, skips 0', 'pulled ' + res.pulledCount + ' skipped ' + res.skippedCount);

  const jpgIn = fs.readFileSync(path.join(M11, 'photo.jpg'));
  const jpgFile = res.files.find((f) => f.ext === 'jpg');
  ok(!!jpgFile, 'a JPEG came out');
  ok(jpgFile && Buffer.from(jpgFile.data).equals(jpgIn), 'the JPEG is byte-identical to the one that went in');
  const jpgReport = res.report.find((r) => r.fileIndex !== undefined && res.files[r.fileIndex] === jpgFile);
  ok(!!jpgReport && JSON.stringify(jpgReport.pages) === '[1,5]', 'the shared JPEG is reported on pages 1 and 5', JSON.stringify(jpgReport && jpgReport.pages));

  for (const [file, srcName] of [[res.files.find((f) => f.page === 2), 'alpha.png'], [res.files.find((f) => f.page === 3), 'opaque.png']]) {
    ok(!!file, srcName + ': a PNG came out');
    if (!file) continue;
    const got = await rawPixels(Buffer.from(file.data));
    const want = await rawPixels(fs.readFileSync(path.join(M11, srcName)));
    ok(got.width === want.width && got.height === want.height, srcName + ': dimensions match', got.width + 'x' + got.height);
    ok(Buffer.from(got.data).equals(Buffer.from(want.data)), srcName + ': every pixel equal, alpha included');
  }
}

// --- weird.pdf ------------------------------------------------------
{
  const expected = JSON.parse(fs.readFileSync(path.join(FIX, 'expected.json'), 'utf8'));
  const doc = await PDFDocument.load(fs.readFileSync(path.join(FIX, 'weird.pdf')));
  const res = await extractPdfImages(doc, { encodePng });
  console.log('weird.pdf report:');
  for (const r of res.report) console.log('   ', r.outcome, '|', r.what, '|', r.why);
  ok(res.storedCount === 6, 'weird.pdf stores 6 pictures', 'got ' + res.storedCount);
  ok(res.pulledCount === 4 && res.skippedCount === 2, 'weird.pdf pulls 4, reports 2', 'pulled ' + res.pulledCount + ' skipped ' + res.skippedCount);
  const skips = res.report.filter((r) => r.outcome === 'skipped').map((r) => r.why).join(' | ');
  ok(/JPEG 2000/.test(skips), 'the JPEG 2000 picture is named in the skips');
  ok(/fax-encoded/.test(skips), 'the CCITT picture is named in the skips');

  const bySize = (w, h) => res.files.find((f) => f.width === w && f.height === h);
  const gray = await rawPixels(Buffer.from(bySize(4, 3).data));
  ok([...gray.data].filter((_, i) => i % 4 === 0).join(',') === expected.gray.join(','), 'gray + PNG predictor: every sample right');
  const idx = await rawPixels(Buffer.from(bySize(3, 2).data));
  const idxRgb = [];
  for (let i = 0; i < idx.data.length; i += 4) idxRgb.push([idx.data[i], idx.data[i + 1], idx.data[i + 2]]);
  ok(JSON.stringify(idxRgb) === JSON.stringify(expected.indexedRgb), 'indexed palette: every pixel the palette colour');
  const cmyk = await rawPixels(Buffer.from(bySize(2, 1).data));
  const cmykRgb = [];
  for (let i = 0; i < cmyk.data.length; i += 4) cmykRgb.push([cmyk.data[i], cmyk.data[i + 1], cmyk.data[i + 2]]);
  ok(JSON.stringify(cmykRgb) === JSON.stringify(expected.cmykRgb), 'CMYK: white and red land right');
  const bits = await rawPixels(Buffer.from(bySize(8, 2).data));
  ok([...bits.data].filter((_, i) => i % 4 === 0).join(',') === expected.bits.join(','), '1-bit gray: every sample right');
}

console.log(failures.length ? 'M12 BENCH: ' + failures.length + ' FAILURES' : 'M12 BENCH: ALL PASS');
process.exit(failures.length ? 1 : 0);
