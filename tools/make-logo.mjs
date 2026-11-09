// Generates the bench-block logo assets: the bold lowercase "b" of IBM
// Plex Sans (the site's own typeface) set as a real vector path inside
// a hard square, logo concept B from the design mock, approved by the
// owner. The glyph path is extracted from the official IBM Plex Sans
// Bold with fontkitten at build time.
//   node tools/make-logo.mjs <path-to-IBMPlexSans-Bold.woff2>
// Outputs: public/favicon.svg, public/favicon-16.png,
// public/favicon-32.png, public/apple-touch-icon.png (180),
// public/icon-192.png, public/icon-512.png, and prints the inline
// path used by src/components/LogoMark.astro (keep them in step).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import sharp from 'sharp';

const require = createRequire(import.meta.url);
const fontkit = require('fontkitten');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUB = path.join(HERE, '..', 'public');

const boldPath = process.argv[2];
if (!boldPath) { console.error('usage: node tools/make-logo.mjs <IBMPlexSans-Bold.woff2>'); process.exit(1); }
const font = fontkit.create(fs.readFileSync(boldPath));
const glyph = font.glyphsForString('b')[0];
const bb = glyph.path.bbox;
// Place the glyph in a 32-unit grid: 19.5 units tall, top at y=6.2,
// centred horizontally. Font coords are y-up; SVG is y-down.
const s = 19.5 / (bb.maxY - bb.minY);
const tx = (32 - (bb.maxX - bb.minX) * s) / 2 - bb.minX * s;
const ty = 6.2 + bb.maxY * s;
const d = glyph.path.scale(s, -s).translate(tx, ty).toSVG().replace(/^<path d="/, '').replace(/"\/>$/, '');
console.log('GLYPH_PATH=' + d);

const INK = '#1b2634';
const PAPER = '#faf6ee';
// Favicon version: paper ground so the mark reads on any tab strip.
// (The in-page mark is src/components/LogoMark.astro, same path data.)
const faviconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="${PAPER}"/><rect x="1.75" y="1.75" width="28.5" height="28.5" fill="none" stroke="${INK}" stroke-width="3.5"/><path d="${d}" fill="${INK}"/></svg>`;
fs.writeFileSync(path.join(PUB, 'favicon.svg'), faviconSvg + '\n');
for (const [name, size] of [['favicon-16.png', 16], ['favicon-32.png', 32], ['apple-touch-icon.png', 180], ['icon-192.png', 192], ['icon-512.png', 512]]) {
  await sharp(Buffer.from(faviconSvg)).resize(size, size).png().toFile(path.join(PUB, name));
  console.log('wrote', name, size + 'px');
}
console.log('wrote favicon.svg');
