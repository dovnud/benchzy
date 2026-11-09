// Milestone 11 fixtures: the known pictures behind the resize and
// convert-door gates. A transparent PNG whose corners are empty (the
// flatten gate reads a corner pixel after conversion to JPG), and one
// small opaque picture in each of the three formats (the pair-door
// gates check the output's format signature). Regenerate with:
// node verify/m11-make-fixtures.mjs
import { mkdirSync, existsSync } from 'node:fs';
import sharp from 'sharp';

const dir = new URL('./fixtures/m11/', import.meta.url).pathname;
mkdirSync(dir, { recursive: true });

// alpha.png: 120x90, fully transparent except an opaque red block in
// the middle (x 30..89, y 25..64). Corners are transparent by design.
{
  const w = 120, h = 90;
  const data = Buffer.alloc(w * h * 4, 0);
  for (let y = 25; y < 65; y++) {
    for (let x = 30; x < 90; x++) {
      const i = (y * w + x) * 4;
      data[i] = 224; data[i + 1] = 49; data[i + 2] = 49; data[i + 3] = 255;
    }
  }
  const out = dir + 'alpha.png';
  if (!existsSync(out)) await sharp(data, { raw: { width: w, height: h, channels: 4 } }).png().toFile(out);
  console.log('alpha.png ready (120x90, transparent corners, red block)');
}

// One opaque 640x480 picture (a two-tone split with a disc, so the
// encoders do real work) written as PNG, JPG and WebP.
{
  const w = 640, h = 480;
  const data = Buffer.alloc(w * h * 3, 0);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      const inDisc = (x - 420) ** 2 + (y - 150) ** 2 < 90 ** 2;
      if (inDisc) { data[i] = 240; data[i + 1] = 200; data[i + 2] = 60; }
      else if (x < w / 2) { data[i] = 40; data[i + 1] = 90; data[i + 2] = 160; }
      else { data[i] = 200; data[i + 1] = 220; data[i + 2] = 235; }
    }
  }
  const base = sharp(data, { raw: { width: w, height: h, channels: 3 } });
  if (!existsSync(dir + 'opaque.png')) await base.clone().png().toFile(dir + 'opaque.png');
  if (!existsSync(dir + 'photo.jpg')) await base.clone().jpeg({ quality: 88 }).toFile(dir + 'photo.jpg');
  if (!existsSync(dir + 'photo.webp')) await base.clone().webp({ quality: 85 }).toFile(dir + 'photo.webp');
  console.log('opaque.png, photo.jpg, photo.webp ready (640x480)');
}
