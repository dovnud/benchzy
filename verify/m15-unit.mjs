// Milestone 15 unit test: runs the PRODUCTION heif-core decode code in
// Node against the committed fixtures (verify/fixtures/m15, made by
// verify/m15-make-fixtures.py). Asserts pixel truth, not impressions:
// pattern corners and centre, all seven EXIF orientation pairs upright,
// the container-transform fixtures (irot/imir box surgery) upright per
// libheif's own property getters, the 10-bit file converted, the photo's
// centre region matching the maker's measurement.
// Run: node verify/m15-unit.mjs  (exit 1 on any failure)
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIX = path.join(ROOT, 'verify', 'fixtures', 'm15');
const manifest = JSON.parse(fs.readFileSync(path.join(FIX, 'fixtures.json'), 'utf8'));

// libheif-js's Node entry resolves its wasm relative to the CWD.
process.chdir(path.join(ROOT, 'node_modules', 'libheif-js'));
const require = createRequire(import.meta.url);
const L = await require(path.join(ROOT, 'node_modules', 'libheif-js', 'wasm.js'));

const { createHeifDecoder, isHeifBytes } = await import(path.join(ROOT, 'src', 'scripts', 'lib', 'heif-core.js'));
const decoder = createHeifDecoder(L);

let failures = 0;
function check(name, ok, detail = '') {
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '  [' + detail + ']' : ''));
  if (!ok) failures++;
}
function close(a, b, tol) { return a.every((v, i) => Math.abs(v - b[i]) <= tol); }
function px(r, x, y) { const i = (y * r.width + x) * 4; return [r.data[i], r.data[i + 1], r.data[i + 2]]; }
function corners(r) {
  return {
    TL: px(r, 30, 30), TR: px(r, r.width - 31, 30),
    BL: px(r, 30, r.height - 31), BR: px(r, r.width - 31, r.height - 31),
  };
}
function load(name) { return fs.readFileSync(path.join(FIX, name)); }
const WANT = manifest.pattern.corners;

// Brand sniffing
for (const f of ['pattern.heic', 'photo.heic', 'tenbit.heic', 'rotated-irot.heic']) {
  check('sniff ' + f, isHeifBytes(load(f)));
}
check('sniff rejects PNG', !isHeifBytes(load('pattern.png')));
check('sniff rejects JPG', !isHeifBytes(load('photo-source.jpg')));

// Pattern: exact decode, no orientation
{
  const r = decoder.decode(load('pattern.heic'));
  check('pattern dims', r.width === 400 && r.height === 300, r.width + 'x' + r.height);
  check('pattern stored == ispe', r.storedWidth === r.ispeWidth && r.storedHeight === r.ispeHeight);
  check('pattern no orientation applied', r.orientationApplied === null);
  const c = corners(r);
  for (const k of ['TL', 'TR', 'BL', 'BR']) check('pattern corner ' + k, close(c[k], WANT[k], 12), c[k].join(','));
  check('pattern centre', close(px(r, 200, 150), manifest.pattern.centre, 14), px(r, 200, 150).join(','));
}

// EXIF orientations 2..8: every one must come out as the upright pattern
for (let tag = 2; tag <= 8; tag++) {
  const r = decoder.decode(load('orient-' + tag + '.heic'));
  const c = corners(r);
  const okDims = r.width === 400 && r.height === 300;
  const okCorners = ['TL', 'TR', 'BL', 'BR'].every((k) => close(c[k], WANT[k], 14));
  check('orient-' + tag + ' upright', okDims && okCorners && r.orientationApplied === 'exif',
    r.width + 'x' + r.height + ' via ' + r.orientationApplied + ' TL=' + c.TL.join(','));
}

// Container transformation properties (box-surgery fixtures)
{
  const r = decoder.decode(load('rotated-irot.heic'));
  const c = corners(r);
  const want = manifest.irotExpected;
  const okDims = r.width === want.size[0] && r.height === want.size[1];
  const okCorners = ['TL', 'TR', 'BL', 'BR'].every((k) => close(c[k], want.corners[k], 14));
  check('irot fixture upright via container props', okDims && okCorners && r.orientationApplied === 'container',
    r.width + 'x' + r.height + ' via ' + r.orientationApplied + ' TL=' + c.TL.join(','));
}
{
  const r = decoder.decode(load('mirrored-imir.heic'));
  const c = corners(r);
  const want = manifest.imirExpected;
  const okDims = r.width === want.size[0] && r.height === want.size[1];
  const okCorners = ['TL', 'TR', 'BL', 'BR'].every((k) => close(c[k], want.corners[k], 14));
  check('imir fixture mirrored by the decoder itself, not twice', okDims && okCorners && r.orientationApplied === 'container',
    r.width + 'x' + r.height + ' via ' + r.orientationApplied + ' TL=' + c.TL.join(','));
}
{
  const r = decoder.decode(load('rotated-irot180.heic'));
  const c = corners(r);
  const want = manifest.irot180Expected;
  const okDims = r.width === want.size[0] && r.height === want.size[1];
  const okCorners = ['TL', 'TR', 'BL', 'BR'].every((k) => close(c[k], want.corners[k], 14));
  check('irot-180 fixture turned by the decoder itself, not twice', okDims && okCorners && r.orientationApplied === 'container',
    r.width + 'x' + r.height + ' via ' + r.orientationApplied + ' TL=' + c.TL.join(','));
}

// 10-bit converts down correctly
{
  const r = decoder.decode(load('tenbit.heic'));
  const left = px(r, 8, 32)[0];
  const right = px(r, 247, 32)[0];
  check('tenbit dims + gradient', r.width === 256 && r.height === 64 && left < 40 && right > 215, 'left ' + left + ' right ' + right);
  check('tenbit reports 10-bit source', r.lumaBits === 10, 'lumaBits=' + r.lumaBits);
}

// Photo: dims + centre region against the maker's measurement
{
  const r = decoder.decode(load('photo.heic'));
  let sr = 0, sg = 0, sb = 0, n = 0;
  for (let y = 350; y < 550; y += 2) for (let x = 500; x < 700; x += 2) {
    const i = (y * r.width + x) * 4;
    sr += r.data[i]; sg += r.data[i + 1]; sb += r.data[i + 2]; n++;
  }
  const mean = [Math.round(sr / n), Math.round(sg / n), Math.round(sb / n)];
  check('photo dims', r.width === 1200 && r.height === 900);
  check('photo centre mean', close(mean, manifest.photo.heicCentreMean, 6), mean.join(',') + ' vs ' + manifest.photo.heicCentreMean.join(','));
}

// Text fixture decodes (OCR gate drives the page separately)
{
  const r = decoder.decode(load('text.heic'));
  check('text fixture decodes', r.width === 1400 && r.height === 360, r.width + 'x' + r.height);
}

console.log(failures ? ('\n' + failures + ' FAILURES') : '\nALL M15 UNIT CHECKS PASSED');
process.exit(failures ? 1 : 0);
