// Milestone 24 fixtures: the files the wave-1 gates are proved
// against.
// - text2.pdf: two 612x792 pages carrying known stored text lines,
//   so the PDF-to-text gate can assert the exact strings come out,
//   in order, page by page. The lines are also exported below as
//   TEXT2_LINES for the gate (kept in this one place).
// - scanonly.pdf: one page whose only content is a drawn picture
//   (the m14 green PNG): a file with no text layer, so the gate
//   can prove the no-text answer names the OCR tool.
// - cropme.png: 400x300, left half red, right half blue, so a crop
//   rectangle can be proved by exact dimensions and by which side
//   of the picture its pixels came from.
// - noise.png: 800x600 of seeded random noise, the hard case for
//   the compress-PNG gate: a PNG that barely shrinks losslessly.
// Regenerate with: node verify/m24-make-fixtures.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, StandardFonts, rgb } from '@cantoo/pdf-lib';
import sharp from 'sharp';
import { TEXT2_LINES } from './m24-texts.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'fixtures', 'm24');
fs.mkdirSync(OUT, { recursive: true });

{
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const p1 = doc.addPage([612, 792]);
  p1.drawText(TEXT2_LINES[0], { x: 72, y: 700, size: 14, font, color: rgb(0, 0, 0) });
  p1.drawText(TEXT2_LINES[1], { x: 72, y: 672, size: 14, font, color: rgb(0, 0, 0) });
  p1.drawText(TEXT2_LINES[2], { x: 72, y: 644, size: 14, font, color: rgb(0, 0, 0) });
  const p2 = doc.addPage([612, 792]);
  p2.drawText(TEXT2_LINES[3], { x: 72, y: 700, size: 14, font, color: rgb(0, 0, 0) });
  p2.drawText(TEXT2_LINES[4], { x: 72, y: 672, size: 14, font, color: rgb(0, 0, 0) });
  fs.writeFileSync(path.join(OUT, 'text2.pdf'), await doc.save());
}

{
  const doc = await PDFDocument.create();
  const png = await doc.embedPng(fs.readFileSync(path.join(HERE, 'fixtures', 'm14', 'img-green.png')));
  const page = doc.addPage([612, 792]);
  page.drawImage(png, { x: 72, y: 200, width: 468, height: 400 });
  fs.writeFileSync(path.join(OUT, 'scanonly.pdf'), await doc.save());
}

{
  const w = 400, h = 300;
  const data = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const c = x < 200 ? [200, 40, 30] : [40, 80, 200];
      data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; data[i + 3] = 255;
    }
  }
  await sharp(data, { raw: { width: w, height: h, channels: 4 } }).png().toFile(path.join(OUT, 'cropme.png'));
}

{
  const w = 800, h = 600;
  const data = Buffer.alloc(w * h * 3);
  let s = 123456789;
  const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s % 256; };
  for (let i = 0; i < data.length; i++) data[i] = rnd();
  await sharp(data, { raw: { width: w, height: h, channels: 3 } }).png().toFile(path.join(OUT, 'noise.png'));
}

console.log('m24 fixtures written to', OUT);
