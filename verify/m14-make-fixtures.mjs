// Milestone 14 fixtures: the files the JPG-to-PDF and PDF-to-JPG
// gates are proved against.
// - img-red.jpg (300x200), img-green.png (200x300), img-blue.webp
//   (400x400): three solid-colour pictures of distinct sizes, so the
//   gate can prove page order, page size and picture identity in the
//   built PDF three independent ways.
// - pages5.pdf: five 612x792 pages, each carrying a marker line
//   (PAGE ONE .. PAGE FIVE) and a filled band in a distinct colour,
//   so a render can be checked for size, content and colour.
// - pages1.pdf: the same first page alone, for the single-page
//   direct-download path.
// - pages50.pdf: fifty 612x792 text pages, the stress document the
//   page copy's tested number comes from.
// Regenerate with: node verify/m14-make-fixtures.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, StandardFonts, rgb } from '@cantoo/pdf-lib';
import sharp from 'sharp';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'fixtures', 'm14');
fs.mkdirSync(OUT, { recursive: true });

const RED = { r: 200, g: 40, b: 30 };
const GREEN = { r: 30, g: 160, b: 60 };
const BLUE = { r: 40, g: 80, b: 200 };

await sharp({ create: { width: 300, height: 200, channels: 3, background: RED } }).jpeg({ quality: 95 }).toFile(path.join(OUT, 'img-red.jpg'));
await sharp({ create: { width: 200, height: 300, channels: 3, background: GREEN } }).png().toFile(path.join(OUT, 'img-green.png'));
await sharp({ create: { width: 400, height: 400, channels: 3, background: BLUE } }).webp({ lossless: true }).toFile(path.join(OUT, 'img-blue.webp'));

const WORDS = ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE'];
const BANDS = [RED, GREEN, BLUE, { r: 230, g: 140, b: 20 }, { r: 130, g: 60, b: 180 }];
const toRgb = (c) => rgb(c.r / 255, c.g / 255, c.b / 255);

async function markerDoc(count) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  for (let i = 0; i < count; i++) {
    const page = doc.addPage([612, 792]);
    const band = BANDS[i % BANDS.length];
    page.drawRectangle({ x: 72, y: 600, width: 468, height: 80, color: toRgb(band) });
    page.drawText('PAGE ' + WORDS[i % WORDS.length], { x: 72, y: 500, size: 36, font, color: rgb(0.1, 0.1, 0.1) });
    page.drawText('Benchzy milestone 14 render fixture', { x: 72, y: 450, size: 14, font, color: rgb(0.3, 0.3, 0.3) });
  }
  return doc;
}

fs.writeFileSync(path.join(OUT, 'pages5.pdf'), await (await markerDoc(5)).save());
fs.writeFileSync(path.join(OUT, 'pages1.pdf'), await (await markerDoc(1)).save());

{
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < 50; i++) {
    const page = doc.addPage([612, 792]);
    page.drawText('Stress page ' + (i + 1) + ' of 50', { x: 72, y: 700, size: 18, font, color: rgb(0.1, 0.1, 0.1) });
    page.drawText('A plain text page for the render stress run.', { x: 72, y: 660, size: 12, font, color: rgb(0.3, 0.3, 0.3) });
  }
  fs.writeFileSync(path.join(OUT, 'pages50.pdf'), await doc.save());
}
console.log('m14 fixtures written to', OUT);
