// Milestone 12 fixtures: PDFs whose stored pictures are known to the
// byte, so extraction can be checked against the truth.
// - images.pdf (built with the shipped pdf-lib): a stored JPEG used
//   on two pages, an alpha PNG (stored as colour + soft mask), an
//   opaque PNG, and one page of pure vector drawing (no pictures).
// - weird.pdf (hand-built, byte by byte): the kinds pdf-lib will not
//   make for us — a grayscale picture with a PNG predictor on its
//   data, an Indexed palette picture, a CMYK picture, a 1-bit
//   picture, and two kinds that must be reported, not pulled
//   (JPEG 2000 and CCITT fax).
// Regenerate with: node verify/m12-make-fixtures.mjs
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { PDFDocument, rgb } from '@cantoo/pdf-lib';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'fixtures', 'm12');
fs.mkdirSync(OUT, { recursive: true });
const M11 = path.join(HERE, 'fixtures', 'm11');

{
  const doc = await PDFDocument.create();
  const jpgBytes = fs.readFileSync(path.join(M11, 'photo.jpg'));
  const alphaBytes = fs.readFileSync(path.join(M11, 'alpha.png'));
  const opaqueBytes = fs.readFileSync(path.join(M11, 'opaque.png'));
  const jpg = await doc.embedJpg(jpgBytes);
  const alpha = await doc.embedPng(alphaBytes);
  const opaque = await doc.embedPng(opaqueBytes);
  const p1 = doc.addPage([640, 480]);
  p1.drawImage(jpg, { x: 0, y: 0, width: 640, height: 480 });
  const p2 = doc.addPage([300, 300]);
  p2.drawImage(alpha, { x: 90, y: 105, width: 120, height: 90 });
  const p3 = doc.addPage([640, 480]);
  p3.drawImage(opaque, { x: 0, y: 0, width: 640, height: 480 });
  const p4 = doc.addPage([400, 300]);
  p4.drawRectangle({ x: 40, y: 40, width: 200, height: 120, color: rgb(0.85, 0.3, 0.2) });
  p4.drawCircle({ x: 300, y: 200, size: 45, color: rgb(0.2, 0.4, 0.8) });
  p4.drawLine({ start: { x: 20, y: 280 }, end: { x: 380, y: 20 }, thickness: 3, color: rgb(0.1, 0.1, 0.1) });
  const p5 = doc.addPage([640, 480]);
  p5.drawImage(jpg, { x: 0, y: 0, width: 640, height: 480 });
  fs.writeFileSync(path.join(OUT, 'images.pdf'), await doc.save());
  console.log('images.pdf ready (5 pages: jpg, alpha png, opaque png, vector, jpg again)');
}

// --- weird.pdf, hand-built -----------------------------------------
// Tiny PDF writer: plain objects, exact xref offsets.
function buildPdf(objects) {
  const parts = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
  const offsets = [0];
  let pos = parts[0].length;
  objects.forEach((body, i) => {
    const head = Buffer.from((i + 1) + ' 0 obj\n', 'latin1');
    const tail = Buffer.from('\nendobj\n', 'latin1');
    offsets.push(pos);
    parts.push(head, body, tail);
    pos += head.length + body.length + tail.length;
  });
  const xrefPos = pos;
  let xref = 'xref\n0 ' + (objects.length + 1) + '\n0000000000 65535 f \n';
  for (let i = 1; i <= objects.length; i++) xref += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  const trailer = 'trailer\n<< /Size ' + (objects.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + xrefPos + '\n%%EOF\n';
  return Buffer.concat([...parts, Buffer.from(xref + trailer, 'latin1')]);
}
function streamObj(dict, data) {
  return Buffer.concat([
    Buffer.from('<< ' + dict + ' /Length ' + data.length + ' >>\nstream\n', 'latin1'),
    data,
    Buffer.from('\nendstream', 'latin1'),
  ]);
}

// The known pictures.
const GRAY = { w: 4, h: 3, rows: [[0, 90, 180, 255], [255, 180, 90, 0], [30, 60, 120, 240]] };
// PNG-predictor (filter 2, Up) encoded rows for the gray picture.
const grayStored = [];
for (let y = 0; y < GRAY.h; y++) {
  grayStored.push(2);
  for (let x = 0; x < GRAY.w; x++) {
    const up = y === 0 ? 0 : GRAY.rows[y - 1][x];
    grayStored.push((GRAY.rows[y][x] - up) & 255);
  }
}
const PALETTE = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 0]];
const IDX = { w: 3, h: 2, rows: [[0, 1, 2], [3, 2, 1]] };
const idxHex = PALETTE.flat().map((v) => v.toString(16).padStart(2, '0')).join('');
const CMYK = { w: 2, h: 1, pixels: [[0, 0, 0, 0], [0, 255, 255, 0]] }; // no ink (paper white), then red (M+Y)
const BITS = { w: 8, h: 2, rows: [[1, 0, 1, 0, 1, 0, 1, 0], [0, 1, 0, 1, 0, 1, 0, 1]] };
const bitsPacked = BITS.rows.map((r) => r.reduce((a, b, i) => a | (b << (7 - i)), 0));

const content = [
  'q 40 0 0 30 10 240 cm /ImGray Do Q',
  'q 30 0 0 20 60 240 cm /ImIdx Do Q',
  'q 20 0 0 10 110 240 cm /ImCmyk Do Q',
  'q 80 0 0 20 160 240 cm /ImBits Do Q',
  'q 40 0 0 40 220 240 cm /ImJpx Do Q',
  'q 40 0 0 40 280 240 cm /ImFax Do Q',
].join('\n');

const objects = [
  Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
  Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
  Buffer.from('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 300] /Resources << /XObject << /ImGray 4 0 R /ImIdx 5 0 R /ImCmyk 6 0 R /ImBits 7 0 R /ImJpx 8 0 R /ImFax 9 0 R >> >> /Contents 10 0 R >>'),
  streamObj('/Type /XObject /Subtype /Image /Width 4 /Height 3 /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode /DecodeParms << /Predictor 12 /Columns 4 /Colors 1 /BitsPerComponent 8 >>',
    zlib.deflateSync(Buffer.from(grayStored))),
  streamObj('/Type /XObject /Subtype /Image /Width 3 /Height 2 /ColorSpace [/Indexed /DeviceRGB 3 <' + idxHex + '>] /BitsPerComponent 8 /Filter /FlateDecode',
    zlib.deflateSync(Buffer.from(IDX.rows.flat()))),
  streamObj('/Type /XObject /Subtype /Image /Width 2 /Height 1 /ColorSpace /DeviceCMYK /BitsPerComponent 8 /Filter /FlateDecode',
    zlib.deflateSync(Buffer.from(CMYK.pixels.flat()))),
  streamObj('/Type /XObject /Subtype /Image /Width 8 /Height 2 /ColorSpace /DeviceGray /BitsPerComponent 1 /Filter /FlateDecode',
    zlib.deflateSync(Buffer.from(bitsPacked))),
  streamObj('/Type /XObject /Subtype /Image /Width 4 /Height 4 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /JPXDecode',
    Buffer.from([0, 0, 0, 12, 0x6a, 0x50, 0x20, 0x20, 1, 2, 3, 4])),
  streamObj('/Type /XObject /Subtype /Image /Width 4 /Height 4 /ColorSpace /DeviceGray /BitsPerComponent 1 /Filter /CCITTFaxDecode /DecodeParms << /K -1 /Columns 4 >>',
    Buffer.from([0xff, 0xff, 0xff, 0xff])),
  streamObj('', Buffer.from(content, 'latin1')),
];
fs.writeFileSync(path.join(OUT, 'weird.pdf'), buildPdf(objects));

const expected = {
  gray: GRAY.rows.flat(),
  indexedRgb: IDX.rows.flat().map((i) => PALETTE[i]),
  cmykRgb: [[255, 255, 255], [255, 0, 0]],
  bits: BITS.rows.flat().map((b) => b * 255),
};
fs.writeFileSync(path.join(OUT, 'expected.json'), JSON.stringify(expected, null, 2));
console.log('weird.pdf ready (gray+predictor, indexed, cmyk, 1-bit, JPX, CCITT on one page)');
