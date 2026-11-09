// Milestone 8 batch fixtures: the real files behind the printed
// "tested with N files" claims. 100 distinct JPEGs (varied crops and
// qualities of the corpus photo, so decode work is real), 50 one-page
// PDFs, and one 12-page PDF for the split-every-page ZIP gate.
// Regenerate with: node verify/make-batch-fixtures.mjs
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import sharp from 'sharp';
import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';

const SRC = new URL('../../file-toolkit/corpus/test-large-photo.jpg', import.meta.url).pathname;
const imgDir = new URL('./fixtures/batch100/', import.meta.url).pathname;
const pdfDir = new URL('./fixtures/batch50pdf/', import.meta.url).pathname;
mkdirSync(imgDir, { recursive: true });
mkdirSync(pdfDir, { recursive: true });

const meta = await sharp(SRC).metadata();
console.log('source photo', meta.width + 'x' + meta.height);
for (let i = 0; i < 100; i++) {
  const out = imgDir + 'photo-' + String(i + 1).padStart(3, '0') + '.jpg';
  if (existsSync(out)) continue;
  const w = 900 + (i % 10) * 40;
  const h = 675 + (i % 7) * 30;
  const left = Math.min(60, Math.max(0, meta.width - w - 10));
  const top = Math.min(45, Math.max(0, meta.height - h - 10));
  await sharp(SRC)
    .extract({ left: (i * 13) % Math.max(1, left + 1), top: (i * 7) % Math.max(1, top + 1), width: Math.min(w, meta.width), height: Math.min(h, meta.height) })
    .jpeg({ quality: 78 + (i % 18) })
    .toFile(out);
}
console.log('100 JPEGs ready');

for (let i = 0; i < 50; i++) {
  const out = pdfDir + 'doc-' + String(i + 1).padStart(2, '0') + '.pdf';
  if (existsSync(out)) continue;
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([612, 792]);
  page.drawText('Batch fixture document ' + (i + 1) + ' of 50. One page, made for the milestone-8 batch test.', { x: 48, y: 700, size: 11, font });
  writeFileSync(out, await doc.save());
}
console.log('50 PDFs ready');

const splitPath = new URL('./fixtures/split12.pdf', import.meta.url).pathname;
if (!existsSync(splitPath)) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < 12; i++) {
    const page = doc.addPage([612, 792]);
    page.drawText('Split fixture page ' + (i + 1) + ' of 12.', { x: 48, y: 700, size: 12, font });
  }
  writeFileSync(splitPath, await doc.save());
}
console.log('12-page split fixture ready');
